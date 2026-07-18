import { debugLog, debugWarn } from "./debugFlightRecorder";
import { MULTIPLAYER_NET_CONFIG } from "./multiplayerNetConfig";
import type { NetInputMessage, NetWorldSnapshot } from "./multiplayerProtocol";
import type { PlayerId } from "./playerSlots";

export type AuthorityMode = "host" | "solo-authority" | "client-mirror";

export type AuthorityClock = {
  mode: AuthorityMode;
  tick: number;
  snapshotAccumulatorSec: number;
  heartbeatAccumulatorSec: number;
  lastSnapshotTick: number;
  nextInputSeqByPlayer: Record<PlayerId, number>;
  lastInputSeqByPlayer: Record<PlayerId, number>;
  lastReceivedInputSeqByPlayer: Record<PlayerId, number>;
  lastSnapshotReceivedTick: number;
};

export type EntityIdCounters = {
  projectile: number;
  shrapnel: number;
  event: number;
};

export function createAuthorityClock(mode: AuthorityMode = "solo-authority"): AuthorityClock {
  return {
    mode,
    tick: 0,
    snapshotAccumulatorSec: 0,
    heartbeatAccumulatorSec: 0,
    lastSnapshotTick: 0,
    nextInputSeqByPlayer: {},
    lastInputSeqByPlayer: {},
    lastReceivedInputSeqByPlayer: {},
    lastSnapshotReceivedTick: 0,
  };
}

export function createEntityIdCounters(): EntityIdCounters {
  return { projectile: 1, shrapnel: 1, event: 1 };
}

export function resetAuthorityClock(clock: AuthorityClock, mode: AuthorityMode = clock.mode) {
  clock.mode = mode;
  clock.tick = 0;
  clock.snapshotAccumulatorSec = 0;
  clock.heartbeatAccumulatorSec = 0;
  clock.lastSnapshotTick = 0;
  clock.lastSnapshotReceivedTick = 0;
  clock.nextInputSeqByPlayer = {};
  clock.lastInputSeqByPlayer = {};
  clock.lastReceivedInputSeqByPlayer = {};
}

export function resetEntityIdCounters(counters: EntityIdCounters) {
  counters.projectile = 1;
  counters.shrapnel = 1;
  counters.event = 1;
}

export function advanceAuthorityTick(clock: AuthorityClock) {
  clock.tick += 1;
  return clock.tick;
}

export function makeAuthorityEntityId(prefix: "projectile" | "shrapnel" | "event", counters: EntityIdCounters, tick: number, ownerId?: PlayerId) {
  const seq = counters[prefix]++;
  const owner = ownerId ? `-${ownerId.replace(/[^a-zA-Z0-9_-]/g, "_")}` : "";
  return `${prefix}${owner}-t${tick}-${seq}`;
}

export function nextInputSequence(clock: AuthorityClock, playerId: PlayerId) {
  const next = (clock.nextInputSeqByPlayer[playerId] ?? 0) + 1;
  clock.nextInputSeqByPlayer[playerId] = next;
  return next;
}

export function acceptInputSequence(clock: AuthorityClock, input: Pick<NetInputMessage, "playerId" | "seq">) {
  const last = clock.lastReceivedInputSeqByPlayer[input.playerId] ?? 0;
  if (input.seq <= last) {
    debugWarn("network", "stale-input-ignored", { playerId: input.playerId, seq: input.seq, lastSeq: last, tick: clock.tick });
    return false;
  }
  clock.lastReceivedInputSeqByPlayer[input.playerId] = input.seq;
  return true;
}

export function markInputSequenceApplied(clock: AuthorityClock, playerId: PlayerId, seq: number) {
  if (seq <= (clock.lastInputSeqByPlayer[playerId] ?? 0)) return false;
  clock.lastInputSeqByPlayer[playerId] = seq;
  return true;
}

export function ackInputSeqByPlayer(clock: AuthorityClock) {
  return { ...clock.lastInputSeqByPlayer };
}

export function shouldPublishSnapshot(clock: AuthorityClock, dtSec: number, snapshotHz = MULTIPLAYER_NET_CONFIG.snapshotHz) {
  if (snapshotHz <= 0) return false;
  clock.snapshotAccumulatorSec += dtSec;
  const interval = 1 / snapshotHz;
  if (clock.snapshotAccumulatorSec < interval) return false;
  clock.snapshotAccumulatorSec = Math.max(0, clock.snapshotAccumulatorSec - interval);
  clock.lastSnapshotTick = clock.tick;
  return true;
}

export function shouldLogSnapshotHeartbeat(clock: AuthorityClock, dtSec: number) {
  const hz = MULTIPLAYER_NET_CONFIG.snapshotHeartbeatLogHz;
  if (hz <= 0) return false;
  clock.heartbeatAccumulatorSec += dtSec;
  const interval = 1 / hz;
  if (clock.heartbeatAccumulatorSec < interval) return false;
  clock.heartbeatAccumulatorSec = Math.max(0, clock.heartbeatAccumulatorSec - interval);
  return true;
}

export function acceptWorldSnapshot(clock: AuthorityClock, snapshot: Pick<NetWorldSnapshot, "tick">) {
  if (snapshot.tick <= clock.lastSnapshotReceivedTick) {
    debugWarn("snapshot", "stale-snapshot-ignored", {
      tick: snapshot.tick,
      lastSnapshotReceivedTick: clock.lastSnapshotReceivedTick,
    });
    return false;
  }
  const jump = snapshot.tick - clock.lastSnapshotReceivedTick;
  clock.lastSnapshotReceivedTick = snapshot.tick;
  if (jump > MULTIPLAYER_NET_CONFIG.largeSnapshotTickJumpWarn) {
    debugWarn("snapshot", "snapshot-tick-jump", { tick: snapshot.tick, jump });
  }
  return true;
}

export function logSnapshotHeartbeat(snapshot: NetWorldSnapshot, mode: AuthorityMode) {
  debugLog("snapshot", "authority-snapshot-heartbeat", {
    mode,
    tick: snapshot.tick,
    players: snapshot.players.length,
    enemies: snapshot.enemies.length,
    projectiles: snapshot.projectiles.length,
    shrapnel: snapshot.shrapnel.length,
    wave: snapshot.wave,
    score: snapshot.score,
  }, "debug");
}
