import { debugLog, debugWarn } from "./debugFlightRecorder";
import { MULTIPLAYER_NET_CONFIG } from "./multiplayerNetConfig";
import type { NetInputMessage, NetWorldSnapshot } from "./multiplayerProtocol";
import type { PlayerId } from "./playerSlots";

export type PendingInputQueue = {
  playerId: PlayerId;
  items: NetInputMessage[];
  lastAckSeq: number;
};

export type PredictionMetrics = {
  snapshotCount: number;
  snapshotSpacingMs: number;
  snapshotAgeMs: number;
  bufferDepth: number;
  lastAckSeq: number;
  pendingInputs: number;
  replayedInputs: number;
  correctionDistance: number;
  angularCorrection: number;
  staleSnapshots: number;
};

export type RenderCorrection = {
  x: number;
  y: number;
  angle: number;
};

export type SnapshotSample = {
  older: NetWorldSnapshot;
  newer: NetWorldSnapshot;
  alpha: number;
  targetServerTimeMs: number;
};

export function createPendingInputQueue(playerId: PlayerId): PendingInputQueue {
  return { playerId, items: [], lastAckSeq: 0 };
}

export function queuePredictedInput(queue: PendingInputQueue, input: NetInputMessage) {
  if (input.playerId !== queue.playerId) return;
  queue.items.push(input);
  const overflow = queue.items.length - MULTIPLAYER_NET_CONFIG.maxPendingPredictedInputs;
  if (overflow > 0) {
    queue.items.splice(0, overflow);
    debugWarn("prediction", "pending-input-queue-trimmed", { playerId: queue.playerId, overflow });
  }
}

export function acknowledgePredictedInputs(queue: PendingInputQueue, ackSeq: number) {
  if (!Number.isFinite(ackSeq) || ackSeq <= queue.lastAckSeq) return 0;
  queue.lastAckSeq = ackSeq;
  const before = queue.items.length;
  queue.items = queue.items.filter((item) => item.seq > ackSeq);
  return before - queue.items.length;
}

export function recentInputsForRedundancy(queue: PendingInputQueue, newest: NetInputMessage) {
  const count = Math.max(1, MULTIPLAYER_NET_CONFIG.inputRedundancyFrames);
  const recent = queue.items.slice(Math.max(0, queue.items.length - count));
  if (!recent.some((item) => item.seq === newest.seq)) recent.push(newest);
  return recent.map((item) => ({
    seq: item.seq,
    clientTick: item.clientTick,
    clientTimeMs: item.clientTimeMs,
    simulationDtMs: item.simulationDtMs,
    rotate: item.rotate,
    thrust: item.thrust,
    brake: item.brake,
    fireHeld: item.fireHeld,
    firePressed: item.firePressed,
    clientShotId: item.clientShotId,
  }));
}

export class SnapshotTimeline {
  private snapshots: NetWorldSnapshot[] = [];
  private lastArrivalMs = 0;
  private clockOffsetMs = 0;
  private clockOffsetReady = false;
  private metrics: PredictionMetrics = {
    snapshotCount: 0,
    snapshotSpacingMs: 0,
    snapshotAgeMs: 0,
    bufferDepth: 0,
    lastAckSeq: 0,
    pendingInputs: 0,
    replayedInputs: 0,
    correctionDistance: 0,
    angularCorrection: 0,
    staleSnapshots: 0,
  };

  push(snapshot: NetWorldSnapshot, arrivalMs = Date.now()) {
    const last = this.snapshots[this.snapshots.length - 1];
    if (last && snapshot.tick <= last.tick) {
      this.metrics.staleSnapshots += 1;
      return false;
    }
    if (this.lastArrivalMs > 0) {
      const spacing = Math.max(0, arrivalMs - this.lastArrivalMs);
      this.metrics.snapshotSpacingMs = this.metrics.snapshotSpacingMs <= 0
        ? spacing
        : this.metrics.snapshotSpacingMs * 0.85 + spacing * 0.15;
    }
    this.lastArrivalMs = arrivalMs;
    const observedClockOffset = arrivalMs - snapshot.serverTimeMs;
    if (!this.clockOffsetReady) {
      this.clockOffsetMs = observedClockOffset;
      this.clockOffsetReady = true;
    } else {
      // Track the host/client clock relationship without letting queueing spikes
      // abruptly move the interpolation target.
      const bounded = Math.max(this.clockOffsetMs - 50, Math.min(this.clockOffsetMs + 50, observedClockOffset));
      this.clockOffsetMs = this.clockOffsetMs * 0.95 + bounded * 0.05;
    }
    this.snapshots.push(snapshot);
    const max = Math.max(3, MULTIPLAYER_NET_CONFIG.maxBufferedSnapshots);
    if (this.snapshots.length > max) this.snapshots.splice(0, this.snapshots.length - max);
    this.metrics.snapshotCount += 1;
    this.metrics.snapshotAgeMs = Math.max(0, arrivalMs - this.clockOffsetMs - snapshot.serverTimeMs);
    this.metrics.bufferDepth = this.snapshots.length;
    return true;
  }

  sample(localNowMs = Date.now(), interpolationDelayMs = MULTIPLAYER_NET_CONFIG.interpolationDelayMs): SnapshotSample | null {
    if (this.snapshots.length <= 0) return null;
    const target = localNowMs - this.clockOffsetMs - interpolationDelayMs;
    let older = this.snapshots[0];
    let newer = this.snapshots[this.snapshots.length - 1];

    if (target <= older.serverTimeMs) return { older, newer: older, alpha: 0, targetServerTimeMs: target };

    for (let i = 1; i < this.snapshots.length; i += 1) {
      const candidate = this.snapshots[i];
      if (candidate.serverTimeMs >= target) {
        newer = candidate;
        older = this.snapshots[i - 1];
        const span = Math.max(1, newer.serverTimeMs - older.serverTimeMs);
        return { older, newer, alpha: Math.max(0, Math.min(1, (target - older.serverTimeMs) / span)), targetServerTimeMs: target };
      }
    }

    older = this.snapshots[Math.max(0, this.snapshots.length - 2)] ?? newer;
    const span = Math.max(1, newer.serverTimeMs - older.serverTimeMs);
    const maxExtra = MULTIPLAYER_NET_CONFIG.maxSnapshotExtrapolationMs;
    const extrapolatedTarget = Math.min(target, newer.serverTimeMs + maxExtra);
    return {
      older,
      newer,
      alpha: Math.max(0, Math.min(1 + maxExtra / span, (extrapolatedTarget - older.serverTimeMs) / span)),
      targetServerTimeMs: target,
    };
  }

  latest() {
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  clear() {
    this.snapshots.length = 0;
    this.lastArrivalMs = 0;
    this.clockOffsetMs = 0;
    this.clockOffsetReady = false;
  }

  updateMetrics(patch: Partial<PredictionMetrics>) {
    this.metrics = { ...this.metrics, ...patch, bufferDepth: this.snapshots.length };
  }

  getMetrics() {
    return { ...this.metrics, bufferDepth: this.snapshots.length };
  }

  logHeartbeat(playerId: PlayerId) {
    debugLog("prediction", "prediction-heartbeat", { playerId, ...this.getMetrics() }, "debug");
  }
}

export function lerpNumber(a: number, b: number, alpha: number) {
  return a + (b - a) * alpha;
}

export function lerpAngle(a: number, b: number, alpha: number) {
  const delta = shortestAngleDelta(a, b);
  return a + delta * alpha;
}

export function shortestAngleDelta(from: number, to: number) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function addRenderCorrection(
  correction: RenderCorrection,
  previousDisplayed: { x: number; y: number; angle: number },
  correctedSimulation: { x: number; y: number; angle: number },
) {
  correction.x += previousDisplayed.x - correctedSimulation.x;
  correction.y += previousDisplayed.y - correctedSimulation.y;
  correction.angle += shortestAngleDelta(correctedSimulation.angle, previousDisplayed.angle);
}

export function decayRenderCorrection(correction: RenderCorrection, dtSec: number) {
  const decay = Math.exp(-MULTIPLAYER_NET_CONFIG.correctionSmoothingRate * Math.max(0, dtSec));
  correction.x *= decay;
  correction.y *= decay;
  correction.angle *= decay;
  if (Math.abs(correction.x) < 0.001) correction.x = 0;
  if (Math.abs(correction.y) < 0.001) correction.y = 0;
  if (Math.abs(correction.angle) < 0.0001) correction.angle = 0;
}
