import { debugLog, debugWarn } from "./debugFlightRecorder";
import { MULTIPLAYER_NET_CONFIG } from "./multiplayerNetConfig";
import {
  isPlayerInputMessage,
  isRealtimeMultiplayerMessage,
  isWorldSnapshotMessage,
  type ClientToHostMessage,
  type HostToClientMessage,
  type MultiplayerMessage,
  type PeerLifecycleMessage,
} from "./multiplayerProtocol";
import type { MultiplayerRole, PlayerId, PlayerSlotIndex } from "./playerSlots";
import { normalizePlayerSlotIndex } from "./playerSlots";

export type TransportRole = MultiplayerRole;
export type TransportChannelKind = "control" | "state" | "legacy";

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
  via: "data-channel-control" | "data-channel-state" | "data-channel-legacy" | "broadcast-channel" | "manual";
};

export type TransportLaunchConfig = {
  role: TransportRole;
  roomId: string;
  localPlayerId: PlayerId;
  enableBroadcastChannel: boolean;
  requestedSlot: PlayerSlotIndex | null;
  showRoster: boolean;
  localPlayerCount: 1 | 2 | 3 | 4;
};

export type TransportPeerSummary = {
  playerId: PlayerId;
  label: string;
  readyState: RTCDataChannelState | "manual" | "broadcast-channel";
  kind: TransportChannelKind | "broadcast";
  sent: number;
  received: number;
};

type PeerChannel = {
  playerId: PlayerId;
  label: string;
  kind: TransportChannelKind;
  channel: RTCDataChannel;
  sent: number;
  received: number;
};

type PeerBundle = {
  playerId: PlayerId;
  control?: PeerChannel;
  state?: PeerChannel;
  legacy?: PeerChannel;
};

type TransportStats = {
  sent: number;
  received: number;
  dropped: number;
  stale: number;
  sentBytes: number;
  receivedBytes: number;
  lastInboundAtMs: number;
  lastOutboundAtMs: number;
};

type WebRtcSignalType = "offer" | "answer" | "ice";

type WebRtcSignalMessage = {
  seq: number;
  roomId: string;
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  signalType: WebRtcSignalType;
  payload: Record<string, unknown>;
  createdAt: string;
};

const WEBRTC_SIGNAL_URL = "/api/multiplayer/transport-signal";
const WEBRTC_POLL_MS = 650;
const WEBRTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function remoteGuestPlayerIds(): PlayerId[] {
  return ["guest-1", "guest-2", "guest-3"] as PlayerId[];
}

function rtcSupported() {
  return typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined";
}

const URL_ROLE_PARAM = "mvfRole";
const URL_ROOM_PARAM = "mvfRoom";
const URL_PLAYER_PARAM = "mvfPlayerId";
const URL_BROADCAST_PARAM = "mvfBroadcast";
const URL_SLOT_PARAM = "mvfSlot";
const URL_ROSTER_PARAM = "mvfRoster";
const URL_LOCAL_PLAYERS_PARAM = "mvfLocalPlayers";

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

function parseLocalPlayerCount(raw: string | null, role: TransportRole): 1 | 2 | 3 | 4 {
  const value = Number(raw);
  if (role === "guest") return 1;
  if (value === 2 || value === 3 || value === 4) return value;
  return 1;
}

function channelKindFromLabel(label: string): TransportChannelKind {
  if (label === "metatron-state") return "state";
  if (label === "metatron-control") return "control";
  return "legacy";
}

function viaForChannel(kind: TransportChannelKind): InboundTransportMessage["via"] {
  if (kind === "state") return "data-channel-state";
  if (kind === "control") return "data-channel-control";
  return "data-channel-legacy";
}

export function detectMultiplayerTransportLaunch(): TransportLaunchConfig {
  if (typeof window === "undefined") {
    return { role: "solo", roomId: "local", localPlayerId: "solo-0", enableBroadcastChannel: false, requestedSlot: null, showRoster: false, localPlayerCount: 1 };
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
  const localPlayerCount = parseLocalPlayerCount(params.get(URL_LOCAL_PLAYERS_PARAM), role);
  const showRoster = role !== "solo" || localPlayerCount > 1 || rosterParam === "1" || rosterParam === "true";
  return { role, roomId, localPlayerId, enableBroadcastChannel, requestedSlot, showRoster, localPlayerCount };
}

export class MultiplayerTransportHub {
  readonly instanceId = randomSuffix();
  private role: TransportRole;
  private localPlayerId: PlayerId;
  private roomId: string;
  private requestedSlot: PlayerSlotIndex | null;
  private showRoster: boolean;
  private localPlayerCount: 1 | 2 | 3 | 4;
  private broadcastChannel: BroadcastChannel | null = null;
  private peerConnections = new Map<PlayerId, RTCPeerConnection>();
  private queuedRemoteIce = new Map<PlayerId, RTCIceCandidateInit[]>();
  private signalPollTimer: number | null = null;
  private signalLastSeq = 0;
  private signalPollActive = false;
  private hostOffersStarted = false;
  private peers = new Map<PlayerId, PeerBundle>();
  private inbound: InboundTransportMessage[] = [];
  private stats: TransportStats = { sent: 0, received: 0, dropped: 0, stale: 0, sentBytes: 0, receivedBytes: 0, lastInboundAtMs: 0, lastOutboundAtMs: 0 };

  constructor(config: TransportLaunchConfig) {
    this.role = config.role;
    this.localPlayerId = config.localPlayerId;
    this.roomId = config.roomId;
    this.requestedSlot = config.requestedSlot;
    this.showRoster = config.showRoster;
    this.localPlayerCount = config.localPlayerCount;
    if (config.enableBroadcastChannel) this.openBroadcastChannel();
    if (this.role !== "solo") this.startWebRtcSignaling();
    this.installGlobalBridge();
    debugLog("network", "transport-initialized", {
      role: this.role,
      localPlayerId: this.localPlayerId,
      roomId: this.roomId,
      requestedSlot: this.requestedSlot,
      showRoster: this.showRoster,
      localPlayerCount: this.localPlayerCount,
      broadcastChannel: Boolean(this.broadcastChannel),
      instanceId: this.instanceId,
    });
  }

  dispose() {
    for (const bundle of this.peers.values()) {
      for (const peer of [bundle.control, bundle.state, bundle.legacy]) {
        if (!peer) continue;
        this.removeChannelListeners(peer);
        try { peer.channel.close(); } catch { /* no-op */ }
      }
    }
    this.peers.clear();
    if (this.signalPollTimer !== null && typeof window !== "undefined") {
      window.clearInterval(this.signalPollTimer);
      this.signalPollTimer = null;
    }
    for (const pc of this.peerConnections.values()) pc.close();
    this.peerConnections.clear();
    this.queuedRemoteIce.clear();
    this.broadcastChannel?.close();
    this.broadcastChannel = null;
    if (typeof window !== "undefined" && window.MetatronMultiplayerTransport?.instanceId === this.instanceId) delete window.MetatronMultiplayerTransport;
    debugLog("network", "transport-disposed", { role: this.role, localPlayerId: this.localPlayerId, roomId: this.roomId });
  }

  getRole() { return this.role; }
  getLocalPlayerId() { return this.localPlayerId; }
  getRoomId() { return this.roomId; }
  getRequestedSlot() { return this.requestedSlot; }
  shouldShowRoster() { return this.showRoster; }
  getLocalPlayerCount() { return this.localPlayerCount; }

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
    const kind = channelKindFromLabel(label);
    const peer: PeerChannel = { playerId: id, label, kind, channel, sent: 0, received: 0 };
    const bundle = this.peers.get(id) ?? { playerId: id };
    const existing = bundle[kind];
    if (existing) this.removeChannelListeners(existing);
    bundle[kind] = peer;
    this.peers.set(id, bundle);
    channel.addEventListener("message", this.onDataChannelMessage as EventListener);
    channel.addEventListener("open", this.onDataChannelOpen as EventListener);
    channel.addEventListener("close", this.onDataChannelClose as EventListener);
    channel.addEventListener("error", this.onDataChannelError as EventListener);
    debugLog("network", "data-channel-attached", { playerId: id, label, kind, readyState: channel.readyState, ordered: channel.ordered, maxRetransmits: channel.maxRetransmits });
  }

  detachPeer(playerId: PlayerId) {
    const bundle = this.peers.get(playerId);
    if (!bundle) return;
    for (const peer of [bundle.control, bundle.state, bundle.legacy]) if (peer) this.removeChannelListeners(peer);
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
      localPlayerCount: this.localPlayerCount,
      broadcastChannel: Boolean(this.broadcastChannel),
      queuedInbound: this.inbound.length,
      stats: { ...this.stats },
    };
  }

  getPeers(): TransportPeerSummary[] {
    const peers: TransportPeerSummary[] = [];
    for (const bundle of this.peers.values()) {
      for (const peer of [bundle.control, bundle.state, bundle.legacy]) {
        if (!peer) continue;
        peers.push({ playerId: peer.playerId, label: peer.label, kind: peer.kind, readyState: peer.channel.readyState, sent: peer.sent, received: peer.received });
      }
    }
    if (this.broadcastChannel) peers.push({ playerId: "broadcast", label: `BroadcastChannel:${this.roomId}`, kind: "broadcast", readyState: "broadcast-channel", sent: this.stats.sent, received: this.stats.received });
    return peers;
  }

  private removeChannelListeners(peer: PeerChannel) {
    peer.channel.removeEventListener("message", this.onDataChannelMessage as EventListener);
    peer.channel.removeEventListener("open", this.onDataChannelOpen as EventListener);
    peer.channel.removeEventListener("close", this.onDataChannelClose as EventListener);
    peer.channel.removeEventListener("error", this.onDataChannelError as EventListener);
  }

  private startWebRtcSignaling() {
    if (!rtcSupported()) {
      debugWarn("network", "webrtc-not-supported", { role: this.role, roomId: this.roomId });
      return;
    }
    if (typeof window === "undefined" || this.signalPollTimer !== null) return;
    this.signalPollTimer = window.setInterval(() => void this.pollWebRtcSignals(), WEBRTC_POLL_MS);
    void this.pollWebRtcSignals();
    if (this.role === "host") void this.startHostOffers();
  }

  private async startHostOffers() {
    if (this.hostOffersStarted || this.role !== "host") return;
    this.hostOffersStarted = true;
    for (const playerId of remoteGuestPlayerIds()) await this.createHostOffer(playerId);
  }

  private createPeerConnection(peerId: PlayerId) {
    const existing = this.peerConnections.get(peerId);
    if (existing && existing.connectionState !== "closed") return existing;
    const pc = new RTCPeerConnection({ iceServers: WEBRTC_ICE_SERVERS });
    this.peerConnections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) void this.sendWebRtcSignal(peerId, "ice", event.candidate.toJSON() as unknown as Record<string, unknown>);
    };
    pc.ondatachannel = (event) => this.attachPeerDataChannel(peerId, event.channel, event.channel.label || "metatron-carrier");
    pc.onconnectionstatechange = () => {
      debugLog("network", "webrtc-connection-state", { peerId, state: pc.connectionState, role: this.role, roomId: this.roomId });
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this.peerConnections.delete(peerId);
    };
    pc.oniceconnectionstatechange = () => debugLog("network", "webrtc-ice-state", { peerId, state: pc.iceConnectionState, role: this.role, roomId: this.roomId });
    return pc;
  }

  private async createHostOffer(peerId: PlayerId) {
    try {
      const pc = this.createPeerConnection(peerId);
      const control = pc.createDataChannel("metatron-control", { ordered: true });
      const state = pc.createDataChannel("metatron-state", { ordered: false, maxRetransmits: 0 });
      this.attachPeerDataChannel(peerId, control, "metatron-control");
      this.attachPeerDataChannel(peerId, state, "metatron-state");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (pc.localDescription) await this.sendWebRtcSignal(peerId, "offer", pc.localDescription.toJSON() as unknown as Record<string, unknown>);
      debugLog("network", "webrtc-offer-sent", { peerId, roomId: this.roomId, channels: ["control", "state"] });
    } catch (err) {
      debugWarn("network", "webrtc-offer-failed", { peerId, roomId: this.roomId, error: err instanceof Error ? err.message : "unknown" });
    }
  }

  private async sendWebRtcSignal(toPlayerId: PlayerId, signalType: WebRtcSignalType, payload: Record<string, unknown>) {
    try {
      const res = await fetch(WEBRTC_SIGNAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ roomId: this.roomId, fromPlayerId: this.localPlayerId, toPlayerId, signalType, payload }),
      });
      if (!res.ok) throw new Error(`signal ${signalType} failed: ${res.status}`);
    } catch (err) {
      this.stats.dropped += 1;
      debugWarn("network", "webrtc-signal-send-failed", { signalType, toPlayerId, roomId: this.roomId, error: err instanceof Error ? err.message : "unknown" });
    }
  }

  private async pollWebRtcSignals() {
    if (this.signalPollActive || this.role === "solo") return;
    this.signalPollActive = true;
    try {
      const url = `${WEBRTC_SIGNAL_URL}?roomId=${encodeURIComponent(this.roomId)}&playerId=${encodeURIComponent(this.localPlayerId)}&since=${this.signalLastSeq}`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`poll failed: ${res.status}`);
      const payload = await res.json() as { signals?: WebRtcSignalMessage[]; latestSeq?: number };
      for (const signal of payload.signals ?? []) {
        this.signalLastSeq = Math.max(this.signalLastSeq, Number(signal.seq) || 0);
        await this.handleWebRtcSignal(signal);
      }
      this.signalLastSeq = Math.max(this.signalLastSeq, Number(payload.latestSeq) || 0);
    } catch (err) {
      debugWarn("network", "webrtc-signal-poll-failed", { roomId: this.roomId, role: this.role, error: err instanceof Error ? err.message : "unknown" });
    } finally {
      this.signalPollActive = false;
    }
  }

  private async handleWebRtcSignal(signal: WebRtcSignalMessage) {
    if (signal.roomId !== this.roomId || signal.toPlayerId !== this.localPlayerId) return;
    const peerId = signal.fromPlayerId;
    try {
      const pc = this.createPeerConnection(peerId);
      if (signal.signalType === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload as unknown as RTCSessionDescriptionInit));
        await this.flushQueuedRemoteIce(peerId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) await this.sendWebRtcSignal(peerId, "answer", pc.localDescription.toJSON() as unknown as Record<string, unknown>);
        debugLog("network", "webrtc-answer-sent", { peerId, roomId: this.roomId });
        return;
      }
      if (signal.signalType === "answer") {
        if (pc.signalingState !== "stable") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.payload as unknown as RTCSessionDescriptionInit));
          await this.flushQueuedRemoteIce(peerId, pc);
          debugLog("network", "webrtc-answer-applied", { peerId, roomId: this.roomId });
        }
        return;
      }
      if (signal.signalType === "ice") {
        const candidate = signal.payload as RTCIceCandidateInit;
        if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(candidate));
        else {
          const queued = this.queuedRemoteIce.get(peerId) ?? [];
          queued.push(candidate);
          this.queuedRemoteIce.set(peerId, queued);
        }
      }
    } catch (err) {
      this.stats.dropped += 1;
      debugWarn("network", "webrtc-signal-handle-failed", { signalType: signal.signalType, peerId, roomId: this.roomId, error: err instanceof Error ? err.message : "unknown" });
    }
  }

  private async flushQueuedRemoteIce(peerId: PlayerId, pc: RTCPeerConnection) {
    const queued = this.queuedRemoteIce.get(peerId) ?? [];
    this.queuedRemoteIce.delete(peerId);
    for (const candidate of queued) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  private openBroadcastChannel() {
    const channelName = `metatron-vector-foil:${this.roomId}`;
    this.broadcastChannel = new BroadcastChannel(channelName);
    this.broadcastChannel.onmessage = (event: MessageEvent) => this.onBroadcastMessage(event.data);
    debugLog("network", "broadcast-channel-opened", { channelName, role: this.role, localPlayerId: this.localPlayerId });
  }

  private selectChannel(bundle: PeerBundle, realtime: boolean) {
    const preferred = realtime ? bundle.state : bundle.control;
    if (preferred?.channel.readyState === "open") return preferred;
    const fallback = realtime ? bundle.control : bundle.state;
    if (fallback?.channel.readyState === "open") return fallback;
    if (bundle.legacy?.channel.readyState === "open") return bundle.legacy;
    return null;
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
    const realtime = isRealtimeMultiplayerMessage(message);
    let sent = 0;
    for (const bundle of this.peers.values()) {
      if (target !== "all" && target !== "host" && target !== bundle.playerId) continue;
      const peer = this.selectChannel(bundle, realtime);
      if (!peer) continue;
      try {
        peer.channel.send(encoded);
        peer.sent += 1;
        sent += 1;
        this.stats.sentBytes += encoded.length;
      } catch (err) {
        this.stats.dropped += 1;
        debugWarn("network", "data-channel-send-failed", { playerId: peer.playerId, channel: peer.kind, messageType: message.type, error: err instanceof Error ? err.message : "unknown" });
      }
    }
    if (sent === 0 && this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(envelope);
        sent += 1;
        this.stats.sentBytes += encoded.length;
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
    if (envelope.roomId !== this.roomId || envelope.instanceId === this.instanceId) return false;
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
    if (MULTIPLAYER_NET_CONFIG.debugPacketDropRate > 0 && Math.random() < MULTIPLAYER_NET_CONFIG.debugPacketDropRate) {
      this.stats.dropped += 1;
      return;
    }
    const enqueue = () => {
      this.stats.received += 1;
      this.stats.lastInboundAtMs = nowMs();
      let estimatedBytes = 0;
      try { estimatedBytes = JSON.stringify(message).length; } catch { estimatedBytes = 0; }
      this.stats.receivedBytes += estimatedBytes;
      this.inbound.push({ fromPlayerId, fromRole, receivedAtMs: this.stats.lastInboundAtMs, message: message as MultiplayerMessage, via });
      if (this.inbound.length > MULTIPLAYER_NET_CONFIG.maxQueuedInboundMessages) {
        const dropCount = this.inbound.length - MULTIPLAYER_NET_CONFIG.maxQueuedInboundMessages;
        this.inbound.splice(0, dropCount);
        this.stats.dropped += dropCount;
        debugWarn("network", "transport-inbound-queue-trimmed", { dropCount });
      }
    };
    const jitter = MULTIPLAYER_NET_CONFIG.debugJitterMs > 0 ? (Math.random() * 2 - 1) * MULTIPLAYER_NET_CONFIG.debugJitterMs : 0;
    const delay = Math.max(0, MULTIPLAYER_NET_CONFIG.debugLatencyMs + jitter);
    if (delay > 0 && typeof window !== "undefined") window.setTimeout(enqueue, delay);
    else enqueue();
  }

  private onBroadcastMessage(raw: unknown) {
    const envelope = raw as TransportEnvelope;
    if (!this.shouldReceiveEnvelope(envelope)) return;
    this.receiveParsed(envelope.message, envelope.fromPlayerId, envelope.fromRole, "broadcast-channel");
  }

  private onDataChannelMessage = (event: MessageEvent) => {
    try {
      const channel = event.currentTarget as RTCDataChannel;
      const kind = channelKindFromLabel(channel.label);
      const actualPeer = [...this.peers.values()]
        .flatMap((bundle) => [bundle.control, bundle.state, bundle.legacy])
        .find((peer): peer is PeerChannel => Boolean(peer && peer.channel === channel));
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      const envelope = data as TransportEnvelope;
      if (envelope?.kind === "metatron-multiplayer-envelope") {
        if (!this.shouldReceiveEnvelope(envelope)) return;
        if (actualPeer && envelope.fromPlayerId !== actualPeer.playerId) {
          this.stats.dropped += 1;
          debugWarn("network", "transport-peer-identity-mismatch", {
            channelPeerId: actualPeer.playerId,
            claimedPlayerId: envelope.fromPlayerId,
            channel: kind,
          });
          return;
        }
        if (actualPeer) actualPeer.received += 1;
        this.receiveParsed(envelope.message, actualPeer?.playerId ?? envelope.fromPlayerId, envelope.fromRole, viaForChannel(kind));
        return;
      }
      this.receiveParsed(data, "unknown-peer", "guest", viaForChannel(kind));
    } catch (err) {
      this.stats.dropped += 1;
      debugWarn("network", "data-channel-message-parse-failed", { error: err instanceof Error ? err.message : "unknown" });
    }
  };

  private onDataChannelOpen = (event: Event) => {
    const channel = event.currentTarget as RTCDataChannel;
    debugLog("network", "data-channel-open", { label: channel.label, kind: channelKindFromLabel(channel.label), readyState: channel.readyState });
  };

  private onDataChannelClose = (event: Event) => {
    const channel = event.currentTarget as RTCDataChannel;
    debugWarn("network", "data-channel-closed", { label: channel.label, kind: channelKindFromLabel(channel.label), readyState: channel.readyState });
  };

  private onDataChannelError = (event: Event) => {
    const channel = event.currentTarget as RTCDataChannel;
    debugWarn("network", "data-channel-error", { label: channel.label, kind: channelKindFromLabel(channel.label), readyState: channel.readyState });
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
