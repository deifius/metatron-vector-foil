import { debugLog, debugWarn } from "./debugFlightRecorder";
import { MULTIPLAYER_NET_CONFIG } from "./multiplayerNetConfig";
import {
  isPlayerInputMessage,
  isWorldSnapshotMessage,
  type ClientToHostMessage,
  type HostToClientMessage,
  type MultiplayerMessage,
  type PeerLifecycleMessage,
} from "./multiplayerProtocol";
import type { MultiplayerRole, PlayerId, PlayerSlotIndex } from "./playerSlots";
import { normalizePlayerSlotIndex } from "./playerSlots";

export type TransportRole = MultiplayerRole;

export type TransportEnvelope = {
  kind: "metatron-multiplayer-envelope";
  roomId: string;
  fromPlayerId: PlayerId;
  fromRole: TransportRole;
  target: "host" | "all" | PlayerId;
  sentAtMs: number;
  message: MultiplayerMessage;
  instanceId: string;
};

export type InboundTransportMessage = {
  fromPlayerId: PlayerId;
  fromRole: TransportRole;
  receivedAtMs: number;
  message: MultiplayerMessage;
  via: "data-channel" | "broadcast-channel" | "manual";
};

export type TransportLaunchConfig = {
  role: TransportRole;
  roomId: string;
  localPlayerId: PlayerId;
  enableBroadcastChannel: boolean;
  requestedSlot: PlayerSlotIndex | null;
  showRoster: boolean;
};

export type TransportPeerSummary = {
  playerId: PlayerId;
  label: string;
  readyState: RTCDataChannelState | "manual" | "broadcast-channel";
  sent: number;
  received: number;
};

type PeerChannel = {
  playerId: PlayerId;
  label: string;
  channel: RTCDataChannel;
  sent: number;
  received: number;
};

type TransportStats = {
  sent: number;
  received: number;
  dropped: number;
  lastInboundAtMs: number;
  lastOutboundAtMs: number;
};

const URL_ROLE_PARAM = "mvfRole";
const URL_ROOM_PARAM = "mvfRoom";
const URL_PLAYER_PARAM = "mvfPlayerId";
const URL_BROADCAST_PARAM = "mvfBroadcast";
const URL_SLOT_PARAM = "mvfSlot";
const URL_ROSTER_PARAM = "mvfRoster";

function nowMs() {
  return Date.now();
}

function sanitizeId(raw: string | null | undefined, fallback: string) {
  const cleaned = String(raw ?? "").trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return cleaned || fallback;
}

function randomSuffix() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

function parseRole(raw: string | null): TransportRole {
  if (raw === "host" || raw === "guest" || raw === "solo") return raw;
  return "solo";
}

export function detectMultiplayerTransportLaunch(): TransportLaunchConfig {
  if (typeof window === "undefined") {
    return { role: "solo", roomId: "local", localPlayerId: "solo-0", enableBroadcastChannel: false, requestedSlot: null, showRoster: false };
  }
  const params = new URLSearchParams(window.location.search);
  const role = parseRole(params.get(URL_ROLE_PARAM));
  const roomId = sanitizeId(params.get(URL_ROOM_PARAM), "local");
  const requestedSlotRaw = normalizePlayerSlotIndex(params.get(URL_SLOT_PARAM));
  const requestedSlot = role === "host" ? 0 : role === "guest" && requestedSlotRaw !== null ? requestedSlotRaw : null;
  const defaultPlayerId = role === "host"
    ? "host-0"
    : role === "guest"
      ? (requestedSlot !== null ? `guest-${requestedSlot}` : `guest-${randomSuffix()}`)
      : "solo-0";
  const localPlayerId = sanitizeId(params.get(URL_PLAYER_PARAM), defaultPlayerId);
  const broadcastParam = params.get(URL_BROADCAST_PARAM);
  const enableBroadcastChannel = role !== "solo" && broadcastParam !== "0" && typeof BroadcastChannel !== "undefined";
  const rosterParam = params.get(URL_ROSTER_PARAM);
  const showRoster = role !== "solo" || rosterParam === "1" || rosterParam === "true";
  return { role, roomId, localPlayerId, enableBroadcastChannel, requestedSlot, showRoster };
}

export class MultiplayerTransportHub {
  readonly instanceId = randomSuffix();
  private role: TransportRole;
  private localPlayerId: PlayerId;
  private roomId: string;
  private requestedSlot: PlayerSlotIndex | null;
  private showRoster: boolean;
  private broadcastChannel: BroadcastChannel | null = null;
  private peers = new Map<PlayerId, PeerChannel>();
  private inbound: InboundTransportMessage[] = [];
  private stats: TransportStats = { sent: 0, received: 0, dropped: 0, lastInboundAtMs: 0, lastOutboundAtMs: 0 };

  constructor(config: TransportLaunchConfig) {
    this.role = config.role;
    this.localPlayerId = config.localPlayerId;
    this.roomId = config.roomId;
    this.requestedSlot = config.requestedSlot;
    this.showRoster = config.showRoster;
    if (config.enableBroadcastChannel) this.openBroadcastChannel();
    this.installGlobalBridge();
    debugLog("network", "transport-initialized", {
      role: this.role,
      localPlayerId: this.localPlayerId,
      roomId: this.roomId,
      requestedSlot: this.requestedSlot,
      showRoster: this.showRoster,
      broadcastChannel: Boolean(this.broadcastChannel),
      instanceId: this.instanceId,
    });
  }

  dispose() {
    for (const peer of this.peers.values()) {
      peer.channel.removeEventListener("message", this.onDataChannelMessage as EventListener);
      peer.channel.removeEventListener("open", this.onDataChannelOpen as EventListener);
      peer.channel.removeEventListener("close", this.onDataChannelClose as EventListener);
      peer.channel.removeEventListener("error", this.onDataChannelError as EventListener);
    }
    this.peers.clear();
    this.broadcastChannel?.close();
    this.broadcastChannel = null;
    if (typeof window !== "undefined" && window.MetatronMultiplayerTransport?.instanceId === this.instanceId) {
      delete window.MetatronMultiplayerTransport;
    }
    debugLog("network", "transport-disposed", { role: this.role, localPlayerId: this.localPlayerId, roomId: this.roomId });
  }

  getRole() { return this.role; }
  getLocalPlayerId() { return this.localPlayerId; }
  getRoomId() { return this.roomId; }
  getRequestedSlot() { return this.requestedSlot; }
  shouldShowRoster() { return this.showRoster; }

  setRole(role: TransportRole) {
    if (this.role === role) return;
    debugLog("network", "transport-role-changed", { previousRole: this.role, role });
    this.role = role;
  }

  setLocalPlayerId(playerId: PlayerId) {
    const next = sanitizeId(playerId, this.localPlayerId);
    if (next === this.localPlayerId) return;
    debugLog("network", "transport-player-id-changed", { previousPlayerId: this.localPlayerId, playerId: next });
    this.localPlayerId = next;
  }

  attachPeerDataChannel(playerId: PlayerId, channel: RTCDataChannel, label = channel.label || "metatron-carrier") {
    const id = sanitizeId(playerId, `peer-${this.peers.size + 1}`);
    const peer: PeerChannel = { playerId: id, label, channel, sent: 0, received: 0 };
    this.peers.set(id, peer);
    channel.addEventListener("message", this.onDataChannelMessage as EventListener);
    channel.addEventListener("open", this.onDataChannelOpen as EventListener);
    channel.addEventListener("close", this.onDataChannelClose as EventListener);
    channel.addEventListener("error", this.onDataChannelError as EventListener);
    debugLog("network", "data-channel-attached", { playerId: id, label, readyState: channel.readyState });
  }

  detachPeer(playerId: PlayerId) {
    const peer = this.peers.get(playerId);
    if (!peer) return;
    peer.channel.removeEventListener("message", this.onDataChannelMessage as EventListener);
    peer.channel.removeEventListener("open", this.onDataChannelOpen as EventListener);
    peer.channel.removeEventListener("close", this.onDataChannelClose as EventListener);
    peer.channel.removeEventListener("error", this.onDataChannelError as EventListener);
    this.peers.delete(playerId);
    debugLog("network", "data-channel-detached", { playerId });
  }

  drainInboundMessages() {
    const out = this.inbound;
    this.inbound = [];
    return out;
  }

  injectInboundMessage(message: MultiplayerMessage, fromPlayerId = "manual", fromRole: TransportRole = "guest") {
    this.receiveParsed(message, fromPlayerId, fromRole, "manual");
  }

  sendToHost(message: ClientToHostMessage) {
    if (this.role === "host" || this.role === "solo") return 0;
    return this.sendEnvelope("host", message);
  }

  sendLifecycleToHost(message: PeerLifecycleMessage) {
    if (this.role === "host" || this.role === "solo") return 0;
    return this.sendEnvelope("host", message);
  }

  sendLifecycleToPeer(playerId: PlayerId, message: PeerLifecycleMessage) {
    if (this.role !== "host") return 0;
    return this.sendEnvelope(playerId, message);
  }

  broadcastLifecycleFromHost(message: PeerLifecycleMessage) {
    if (this.role !== "host") return 0;
    return this.sendEnvelope("all", message);
  }

  broadcastFromHost(message: HostToClientMessage) {
    if (this.role !== "host") return 0;
    return this.sendEnvelope("all", message);
  }

  sendToPeer(playerId: PlayerId, message: HostToClientMessage) {
    if (this.role !== "host") return 0;
    return this.sendEnvelope(playerId, message);
  }

  getState() {
    return {
      role: this.role,
      localPlayerId: this.localPlayerId,
      roomId: this.roomId,
      instanceId: this.instanceId,
      peers: this.getPeers(),
      requestedSlot: this.requestedSlot,
      showRoster: this.showRoster,
      broadcastChannel: Boolean(this.broadcastChannel),
      queuedInbound: this.inbound.length,
      stats: { ...this.stats },
    };
  }

  getPeers(): TransportPeerSummary[] {
    const peers: TransportPeerSummary[] = [];
    for (const peer of this.peers.values()) {
      peers.push({ playerId: peer.playerId, label: peer.label, readyState: peer.channel.readyState, sent: peer.sent, received: peer.received });
    }
    if (this.broadcastChannel) {
      peers.push({ playerId: "broadcast", label: `BroadcastChannel:${this.roomId}`, readyState: "broadcast-channel", sent: this.stats.sent, received: this.stats.received });
    }
    return peers;
  }

  private openBroadcastChannel() {
    const channelName = `metatron-vector-foil:${this.roomId}`;
    this.broadcastChannel = new BroadcastChannel(channelName);
    this.broadcastChannel.onmessage = (event: MessageEvent) => this.onBroadcastMessage(event.data);
    debugLog("network", "broadcast-channel-opened", { channelName, role: this.role, localPlayerId: this.localPlayerId });
  }

  private sendEnvelope(target: TransportEnvelope["target"], message: MultiplayerMessage) {
    const envelope: TransportEnvelope = {
      kind: "metatron-multiplayer-envelope",
      roomId: this.roomId,
      fromPlayerId: this.localPlayerId,
      fromRole: this.role,
      target,
      sentAtMs: nowMs(),
      message,
      instanceId: this.instanceId,
    };

    const encoded = JSON.stringify(envelope);
    let sent = 0;
    for (const peer of this.peers.values()) {
      if (target !== "all" && target !== "host" && target !== peer.playerId) continue;
      if (peer.channel.readyState !== "open") continue;
      try {
        peer.channel.send(encoded);
        peer.sent += 1;
        sent += 1;
      } catch (err) {
        this.stats.dropped += 1;
        debugWarn("network", "data-channel-send-failed", { playerId: peer.playerId, messageType: message.type, error: err instanceof Error ? err.message : "unknown" });
      }
    }

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(envelope);
        sent += 1;
      } catch (err) {
        this.stats.dropped += 1;
        debugWarn("network", "broadcast-send-failed", { messageType: message.type, error: err instanceof Error ? err.message : "unknown" });
      }
    }

    if (sent > 0) {
      this.stats.sent += 1;
      this.stats.lastOutboundAtMs = nowMs();
    }
    return sent;
  }

  private shouldReceiveEnvelope(envelope: TransportEnvelope) {
    if (!envelope || envelope.kind !== "metatron-multiplayer-envelope") return false;
    if (envelope.roomId !== this.roomId) return false;
    if (envelope.instanceId === this.instanceId) return false;
    if (envelope.target === "all") return this.role !== "host" || envelope.fromRole !== "host";
    if (envelope.target === "host") return this.role === "host";
    return envelope.target === this.localPlayerId;
  }

  private receiveParsed(message: unknown, fromPlayerId: PlayerId, fromRole: TransportRole, via: InboundTransportMessage["via"]) {
    if (!isPlayerInputMessage(message) && !isWorldSnapshotMessage(message) && !(message && typeof message === "object" && "type" in message)) {
      this.stats.dropped += 1;
      debugWarn("network", "transport-message-rejected", { fromPlayerId, via, reason: "unknown-message-shape" });
      return;
    }
    this.stats.received += 1;
    this.stats.lastInboundAtMs = nowMs();
    this.inbound.push({ fromPlayerId, fromRole, receivedAtMs: this.stats.lastInboundAtMs, message: message as MultiplayerMessage, via });
    if (this.inbound.length > MULTIPLAYER_NET_CONFIG.maxQueuedInboundMessages) {
      const dropCount = this.inbound.length - MULTIPLAYER_NET_CONFIG.maxQueuedInboundMessages;
      this.inbound.splice(0, dropCount);
      this.stats.dropped += dropCount;
      debugWarn("network", "transport-inbound-queue-trimmed", { dropCount });
    }
  }

  private onBroadcastMessage(raw: unknown) {
    const envelope = raw as TransportEnvelope;
    if (!this.shouldReceiveEnvelope(envelope)) return;
    this.receiveParsed(envelope.message, envelope.fromPlayerId, envelope.fromRole, "broadcast-channel");
  }

  private onDataChannelMessage = (event: MessageEvent) => {
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      const envelope = data as TransportEnvelope;
      if (envelope?.kind === "metatron-multiplayer-envelope") {
        if (!this.shouldReceiveEnvelope(envelope)) return;
        const peer = this.peers.get(envelope.fromPlayerId);
        if (peer) peer.received += 1;
        this.receiveParsed(envelope.message, envelope.fromPlayerId, envelope.fromRole, "data-channel");
        return;
      }
      this.receiveParsed(data, "unknown-peer", "guest", "data-channel");
    } catch (err) {
      this.stats.dropped += 1;
      debugWarn("network", "data-channel-message-parse-failed", { error: err instanceof Error ? err.message : "unknown" });
    }
  };

  private onDataChannelOpen = (event: Event) => {
    const channel = event.currentTarget as RTCDataChannel;
    debugLog("network", "data-channel-open", { label: channel.label, readyState: channel.readyState });
  };

  private onDataChannelClose = (event: Event) => {
    const channel = event.currentTarget as RTCDataChannel;
    debugWarn("network", "data-channel-closed", { label: channel.label, readyState: channel.readyState });
  };

  private onDataChannelError = (event: Event) => {
    const channel = event.currentTarget as RTCDataChannel;
    debugWarn("network", "data-channel-error", { label: channel.label, readyState: channel.readyState });
  };

  private installGlobalBridge() {
    if (typeof window === "undefined") return;
    const bridge = {
      instanceId: this.instanceId,
      attachPeerDataChannel: (playerId: PlayerId, channel: RTCDataChannel, label?: string) => this.attachPeerDataChannel(playerId, channel, label),
      detachPeer: (playerId: PlayerId) => this.detachPeer(playerId),
      receive: (message: MultiplayerMessage, fromPlayerId?: PlayerId, fromRole?: TransportRole) => this.injectInboundMessage(message, fromPlayerId, fromRole),
      setRole: (role: TransportRole) => this.setRole(role),
      setLocalPlayerId: (playerId: PlayerId) => this.setLocalPlayerId(playerId),
      getState: () => this.getState(),
    };
    window.MetatronMultiplayerTransport = bridge;
  }
}

export function createMultiplayerTransport(config: TransportLaunchConfig) {
  return new MultiplayerTransportHub(config);
}

declare global {
  interface Window {
    MetatronMultiplayerTransport?: {
      instanceId: string;
      attachPeerDataChannel: (playerId: PlayerId, channel: RTCDataChannel, label?: string) => void;
      detachPeer: (playerId: PlayerId) => void;
      receive: (message: MultiplayerMessage, fromPlayerId?: PlayerId, fromRole?: TransportRole) => void;
      setRole: (role: TransportRole) => void;
      setLocalPlayerId: (playerId: PlayerId) => void;
      getState: () => ReturnType<MultiplayerTransportHub["getState"]>;
    };
  }
}
