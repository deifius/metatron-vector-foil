import type { PlayerId, PlayerSlotIndex } from "./playerSlots";
import type { SolidKind } from "./gameConstants";

export const MULTIPLAYER_PROTOCOL_VERSION = 1 as const;

export type NetInputMessage = {
  type: "player-input";
  protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION;
  playerId: PlayerId;
  seq: number;
  clientTimeMs: number;
  rotate: number;
  thrust: number;
  brake: number;
  fireHeld: boolean;
  firePressed: boolean;
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
  lastInputSeq: number;
};

export type NetProjectileState = {
  id: string;
  ownerId: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  kind: "blaster";
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
  ackInputSeqByPlayer: Record<PlayerId, number>;
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
    | "sol-damaged";
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
