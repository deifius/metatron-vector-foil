import type { PlayerId, PlayerSlotIndex } from "./playerSlots";
import type { SolidKind } from "./gameConstants";

export const MULTIPLAYER_PROTOCOL_VERSION = 3 as const;

export type MultiplayerAuthorityRole = "host" | "guest" | "solo";

export type NetInputFramePayload = {
  seq: number;
  clientTick: number;
  clientTimeMs: number;
  simulationDtMs: number;
  rotate: number;
  thrust: number;
  brake: number;
  fireHeld: boolean;
  firePressed: boolean;
  clientShotId?: string;
};

export type NetInputMessage = NetInputFramePayload & {
  type: "player-input";
  protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION;
  playerId: PlayerId;
  recentInputs?: NetInputFramePayload[];
  // Protocol v3 no longer treats telemetry as authority. These optional fields
  // remain for one-version diagnostics and can be removed after old clients age out.
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  angle?: number;
  angularVelocity?: number;
};

export type NetPlayerState = {
  id: PlayerId;
  slot: PlayerSlotIndex;
  callsign?: string | null;
  alive: boolean;
  respawnPending: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  fuel: number;
  hitsTaken: number;
  thrust?: number;
  brake?: number;
  lastInputSeq: number;
};

export type NetProjectileState = {
  id: string;
  ownerId: PlayerId;
  clientShotId?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  kind: "blaster";
  hostTick?: number;
};

export type NetShrapnelState = {
  id: string;
  sourceEnemyId?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeMs: number;
  size: number;
  hostTick?: number;
  hue?: number;
};

export type NetEnemyState = {
  id: string;
  kind: SolidKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  morphing: boolean;
  nextKind: SolidKind | null;
};

export type NetWorldSnapshot = {
  type: "world-snapshot";
  protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION;
  tick: number;
  serverTimeMs: number;
  players: NetPlayerState[];
  enemies: NetEnemyState[];
  projectiles: NetProjectileState[];
  shrapnel: NetShrapnelState[];
  wave: number;
  score: number;
  solIntegrity: number;
  authorityRole?: MultiplayerAuthorityRole;
  runState?: "playing" | "debrief";
  gameOverCause?: string;
  ackInputSeqByPlayer: Record<PlayerId, number>;
  ackClientTimeMsByPlayer?: Record<PlayerId, number>;
};

export type NetWorldEvent = {
  type: "world-event";
  protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION;
  tick: number;
  serverTimeMs: number;
  event:
    | "player-died"
    | "player-respawned"
    | "enemy-shattered"
    | "projectile-fired"
    | "sphere-awakened"
    | "wave-cleared"
    | "sol-damaged"
    | "player-hit"
    | "projectile-destroyed"
    | "shrapnel-destroyed"
    | "host-authority-heartbeat"
    | "run-ended";
  playerId?: PlayerId;
  entityId?: string;
  data?: Record<string, unknown>;
};

export type ClientToHostMessage = NetInputMessage;
export type HostToClientMessage = NetWorldSnapshot | NetWorldEvent;

export function isStaleSnapshot(snapshot: NetWorldSnapshot, lastSnapshotTick: number) {
  return snapshot.tick <= lastSnapshotTick;
}

export function isStaleInput(input: NetInputMessage, lastInputSeq: number) {
  return input.seq <= lastInputSeq;
}

export type PeerLifecycleMessage = {
  type: "peer-lifecycle";
  protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION;
  event: "join-request" | "join-accepted" | "join-denied" | "peer-left" | "host-migrated" | "roster-sync";
  playerId?: PlayerId;
  slot?: PlayerSlotIndex;
  callsign?: string | null;
  reason?: string;
  serverTimeMs: number;
};

export type MultiplayerMessage = ClientToHostMessage | HostToClientMessage | PeerLifecycleMessage;

export function isProtocolObject(value: unknown): value is { type: string; protocolVersion?: number } {
  return !!value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}

export function hasExpectedProtocolVersion(value: unknown): value is { protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION } {
  return isProtocolObject(value) && (value as { protocolVersion?: unknown }).protocolVersion === MULTIPLAYER_PROTOCOL_VERSION;
}

export function isWorldSnapshotMessage(value: unknown): value is NetWorldSnapshot {
  return hasExpectedProtocolVersion(value) && (value as { type?: unknown }).type === "world-snapshot";
}

export function isPlayerInputMessage(value: unknown): value is NetInputMessage {
  return hasExpectedProtocolVersion(value) && (value as { type?: unknown }).type === "player-input";
}

export function isWorldEventMessage(value: unknown): value is NetWorldEvent {
  return hasExpectedProtocolVersion(value) && (value as { type?: unknown }).type === "world-event";
}

export function isPeerLifecycleMessage(value: unknown): value is PeerLifecycleMessage {
  return hasExpectedProtocolVersion(value) && (value as { type?: unknown }).type === "peer-lifecycle";
}

export function isRealtimeMultiplayerMessage(value: MultiplayerMessage) {
  return value.type === "player-input" || value.type === "world-snapshot";
}
