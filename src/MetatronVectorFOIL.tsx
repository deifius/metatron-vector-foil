import React, { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_HUD_CONFIG, DEFAULT_HUD_STATE, HUD_UPDATE_INTERVAL } from "./ui/hud/hudConfig";
import { HUDRoot } from "./ui/hud/HUDRoot";
import { HUDState } from "./ui/hud/hudTypes";
import { loadJson, loadTextLines } from "./data/textLoader";
import { scoreForCitation, scoreForEnemy, scoreForPerfectWave, scoreForWaveClear } from "./config/scoring";
import { getConnectedGamepadDescriptors, getGamepadControlsHint, readGamepadShipInput, readGamepadShipInputForIndex } from "./config/gamepadControls";
import {
  debugLog,
  debugWarn,
  exportDebugBundle,
  getFlightRecorderSessionId,
  installFlightRecorderErrorCapture,
  setFlightRecorderContext,
} from "./config/debugFlightRecorder";
import {
  assignNextPlayerSlot,
  assignPlayerSlot,
  createPlayerRegistryWithLocal,
  LOCAL_SOLO_PLAYER_ID,
  markPlayerDestroyed,
  markPlayerRespawned,
  playerSlotSummary,
  respawnPendingPlayers,
  shouldEndRunForPlayerLoss,
} from "./config/playerSlots";
import type { MultiplayerRole, PlayerId, PlayerLifeState, PlayerSlotIndex } from "./config/playerSlots";
import { MULTIPLAYER_NET_CONFIG } from "./config/multiplayerNetConfig";
import {
  acceptInputSequence,
  acceptWorldSnapshot,
  ackInputSeqByPlayer,
  advanceAuthorityTick,
  createAuthorityClock,
  createEntityIdCounters,
  logSnapshotHeartbeat,
  makeAuthorityEntityId,
  markInputSequenceApplied,
  nextInputSequence,
  resetAuthorityClock,
  resetEntityIdCounters,
  shouldLogSnapshotHeartbeat,
  shouldPublishSnapshot,
} from "./config/multiplayerAuthority";
import { MULTIPLAYER_PROTOCOL_VERSION, isPeerLifecycleMessage, isPlayerInputMessage, isWorldEventMessage, isWorldSnapshotMessage } from "./config/multiplayerProtocol";
import type { NetInputFramePayload, NetInputMessage, NetPlayerState, NetWorldSnapshot, PeerLifecycleMessage } from "./config/multiplayerProtocol";
import { createMultiplayerTransport, detectMultiplayerTransportLaunch } from "./config/multiplayerTransport";
import {
  SnapshotTimeline,
  acknowledgePredictedInputs,
  addRenderCorrection,
  createPendingInputQueue,
  decayRenderCorrection,
  lerpAngle,
  lerpNumber,
  queuePredictedInput,
  recentInputsForRedundancy,
  shortestAngleDelta,
} from "./config/multiplayerPrediction";
import type { InboundTransportMessage, MultiplayerTransportHub } from "./config/multiplayerTransport";
import { SCORE_THRESHOLDS } from "./config/thresholds";
import type { CitationCategory, CommendationDefinition } from "./types/scoring";
import {
  AUDIO,
  DEBRIEF_SEQUENCE,
  DEFAULT_COMMENDATIONS,
  DEFAULT_DEATH_CAUSE_LINES,
  DEFAULT_FLIGHT_HINTS,
  DEFAULT_GAME_OVER_LINES,
  DEFAULT_INSERT_COIN_LINES,
  DEFAULT_PLAYER,
  DOWNGRADE,
  MET_EDGES,
  T,
  TAU,
} from "./config/gameConstants";
import type { SolidKind } from "./config/gameConstants";

/**
 * Metatron Vector FOIL
 * - Canvas + fixed-timestep physics
 * - Start screen, pause sliders, level progression via "alignment door"
 * - WebAudio wavetable SFX
 */

// ===================== UTILITIES =====================
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

class V2 {
  constructor(public x = 0, public y = 0) {}
  copy() { return new V2(this.x, this.y); }
  add(v: V2) { this.x += v.x; this.y += v.y; return this; }
  sub(v: V2) { this.x -= v.x; this.y -= v.y; return this; }
  mul(s: number) { this.x *= s; this.y *= s; return this; }
  len() { return Math.hypot(this.x, this.y); }
  norm() { const l = this.len() || 1; this.x /= l; this.y /= l; return this; }
  dot(v: V2) { return this.x * v.x + this.y * v.y; }
  rot(a: number) {
    const c = Math.cos(a), s = Math.sin(a);
    const x = this.x * c - this.y * s;
    const y = this.x * s + this.y * c;
    this.x = x; this.y = y;
    return this;
  }
  static fromAngle(a: number, m = 1) { return new V2(Math.cos(a) * m, Math.sin(a) * m); }
}

class V3 { constructor(public x = 0, public y = 0, public z = 0) {} }
function rotX(v: V3, a: number) { const c = Math.cos(a), s = Math.sin(a); return new V3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
function rotY(v: V3, a: number) { const c = Math.cos(a), s = Math.sin(a); return new V3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
function rotZ(v: V3, a: number) { const c = Math.cos(a), s = Math.sin(a); return new V3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
function project(v: V3, scale = 1, perspective = 4) {
  const z = v.z + perspective;
  const denom = Math.max(0.35, z);
  let k = perspective / denom;
  k = Math.min(k, 3.0);
  const x = v.x * k * scale;
  const y = v.y * k * scale;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  return { x, y };
}

function arcSafe(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, start = 0, end = TAU) {
  const R = Number.isFinite(r) ? Math.max(0.001, Math.abs(r)) : 0.001;
  ctx.arc(x, y, R, start, end);
}

function axialToWorld(q: number, r: number, spacing: number) {
  return {
    x: spacing * (q + r / 2),
    y: spacing * (Math.sqrt(3) / 2) * r,
  };
}

function metatronCenters(nodeSpacing: number) {
  const spacing = nodeSpacing;
  const axial = [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
    { q: 2, r: 0 },
    { q: 0, r: 2 },
    { q: -2, r: 2 },
    { q: -2, r: 0 },
    { q: 0, r: -2 },
    { q: 2, r: -2 },
  ];
  return axial.map(({ q, r }) => axialToWorld(q, r, spacing));
}

function metatronAlignmentFor(activeCount: number) {
  return smoothstep(T.META_ALIGN_START_COUNT, T.META_ALIGN_COMPLETE_COUNT, activeCount);
}

function approachScalar(current: number, target: number, maxStep: number) {
  if (current < target) return Math.min(target, current + maxStep);
  if (current > target) return Math.max(target, current - maxStep);
  return current;
}

function isMetaNodeLit(node: MetaNode | undefined) {
  return !!node && (node.kind === "center" || node.awakened);
}


// ===================== POLYHEDRA =====================
type PolyMesh = { verts: V3[]; edges: number[][] };
type Impact = { point: V2; normal: V2; edgeI: number; edgeJ: number; d2: number };

function buildEdgesByNearestDistance(verts: V3[], slack = 1.05) {
  const edges: number[][] = [];
  let min = Infinity;
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) {
    const dx = verts[i].x - verts[j].x, dy = verts[i].y - verts[j].y, dz = verts[i].z - verts[j].z;
    min = Math.min(min, Math.hypot(dx, dy, dz));
  }
  const th = min * slack;
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) {
    const dx = verts[i].x - verts[j].x, dy = verts[i].y - verts[j].y, dz = verts[i].z - verts[j].z;
    const d = Math.hypot(dx, dy, dz);
    if (d <= th) edges.push([i, j]);
  }
  return edges;
}

function makePolyhedron(kind: SolidKind, r: number): PolyMesh {
  const verts: V3[] = [];
  let edges: number[][] = [];
  const phi = (1 + Math.sqrt(5)) / 2;
  const invPhi = 1 / phi;

  if (kind === "tetra") {
    const base = [new V3(1, 1, 1), new V3(-1, -1, 1), new V3(-1, 1, -1), new V3(1, -1, -1)];
    base.forEach((v) => verts.push(v));
    edges = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  }
  if (kind === "cube") {
    const s = [-1, 1];
    for (const x of s) for (const y of s) for (const z of s) verts.push(new V3(x, y, z));
    edges = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
  }
  if (kind === "octa") {
    [new V3(1, 0, 0), new V3(-1, 0, 0), new V3(0, 1, 0), new V3(0, -1, 0), new V3(0, 0, 1), new V3(0, 0, -1)].forEach((v) => verts.push(v));
    edges = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [2, 5], [3, 4], [3, 5]];
  }
  if (kind === "dodeca") {
    const base = [
      new V3(1, 1, 1), new V3(1, 1, -1), new V3(1, -1, 1), new V3(1, -1, -1),
      new V3(-1, 1, 1), new V3(-1, 1, -1), new V3(-1, -1, 1), new V3(-1, -1, -1),
      new V3(0, invPhi, phi), new V3(0, invPhi, -phi), new V3(0, -invPhi, phi), new V3(0, -invPhi, -phi),
      new V3(invPhi, phi, 0), new V3(invPhi, -phi, 0), new V3(-invPhi, phi, 0), new V3(-invPhi, -phi, 0),
      new V3(phi, 0, invPhi), new V3(phi, 0, -invPhi), new V3(-phi, 0, invPhi), new V3(-phi, 0, -invPhi),
    ];
    base.forEach((v) => verts.push(v));
    edges = buildEdgesByNearestDistance(verts);
  }
  if (kind === "icosa") {
    const a = 1, b = phi;
    const base = [
      new V3(0, a, b), new V3(0, -a, b), new V3(0, a, -b), new V3(0, -a, -b),
      new V3(a, b, 0), new V3(-a, b, 0), new V3(a, -b, 0), new V3(-a, -b, 0),
      new V3(b, 0, a), new V3(-b, 0, a), new V3(b, 0, -a), new V3(-b, 0, -a),
    ];
    base.forEach((v) => verts.push(v));
    edges = buildEdgesByNearestDistance(verts);
  }

  for (const v of verts) { v.x *= r; v.y *= r; v.z *= r; }
  return { verts, edges };
}



// ===================== GAME TYPES =====================
type PlayerShipState = {
  pos: V2;
  vel: V2;
  angle: number;
  angularVel: number;
  thrust: number;
  brakeAnim: number;
  thrustGlow: number;
  inActivatedSphere: boolean;
  fuel: number;
  stuckTime: number;
  hitsTaken: number;
  hitInvuln: number;
};

type PlayerControlState = {
  rotate: number;
  thrust: number;
  brake: number;
  fireHeld: boolean;
  firePressed: boolean;
  clientShotId?: string;
  seq: number;
  clientTick: number;
  simulationDtMs: number;
  clientTimeMs: number;
};

type PlayerRuntimeMirror = PlayerShipState & {
  brakeInput: number;
  gunCooldown: number;
  lastInputSeq: number;
  currentInput: PlayerControlState;
  pendingInputs: PlayerControlState[];
  trail: V2[];
  localGamepadIndex: number | null;
  local: boolean;
  renderCorrection: { x: number; y: number; angle: number };
  displayedX: number;
  displayedY: number;
  displayedAngle: number;
  lastAckClientTimeMs: number;
};

type Bullet = { id: string; ownerId: PlayerId; hostTick: number; clientShotId?: string; predicted?: boolean; pos: V2; prevPos: V2; vel: V2; life: number; mass: number; origin: V2; firedAtMs: number; burstId: number };
type FuelBit = { pos: V2; vel: V2; life: number; hue: number; };
type Shard = { id: string; sourceEnemyId?: string; hostTick: number; pos: V2; vel: V2; life: number; life0: number; hue: number; size: number; ang: number; spin: number; };
type OortCluster = {
  orbitRadius: number;
  orbitPhase: number;
  orbitSpeed: number;
  eccentricity: number;
  eccentricPhase: number;
  localSpin: number;
  localSpinSpeed: number;
  glyphRadius: number;
  brightness: number;
  hazard: number;
  hue: number;
  variant: number;
  brokenUntil: number;
  pulseUntil: number;
};

function oortClusterCenter(c: OortCluster, timeSec: number) {
  const theta = c.orbitPhase + timeSec * c.orbitSpeed;
  const wobble = 1 + c.eccentricity * Math.sin(theta * 2.0 + c.eccentricPhase);
  const r = c.orbitRadius * wobble;
  return new V2(Math.cos(theta) * r, Math.sin(theta) * r);
}

function oortClusterNodes(c: OortCluster, timeSec: number) {
  const center = oortClusterCenter(c, timeSec);
  const spin = c.localSpin + timeSec * c.localSpinSpeed;
  const squash = 0.78 + 0.16 * Math.sin(c.orbitPhase * 3.0);
  const pts: V2[] = [];
  for (let i = 0; i < 3; i++) {
    const a = spin + i * TAU / 3;
    const local = new V2(Math.cos(a) * c.glyphRadius, Math.sin(a) * c.glyphRadius * squash);
    local.rot(c.orbitPhase * 0.31);
    pts.push(center.copy().add(local));
  }
  return pts;
}

function oortClusterLinks(c: OortCluster) {
  const v = c.variant % 3;
  if (v === 0) return [[0, 1], [1, 2]];       // twig / two-segment constellation
  if (v === 1) return [[0, 1], [0, 2]];       // fork / treelet
  return [[0, 1], [1, 2], [2, 0]];            // small closed triangle
}

function pointSegmentDistanceSq(p: V2, a: V2, b: V2) {
  const ab = b.copy().sub(a);
  const denom = ab.dot(ab) || 1;
  const t = clamp(p.copy().sub(a).dot(ab) / denom, 0, 1);
  const q = a.copy().add(ab.mul(t));
  return p.copy().sub(q).dot(p.copy().sub(q));
}

type Enemy = {
  id: string;
  pos: V2; vel: V2;
  ax: number; ay: number; az: number;
  r: number; hue: number;
  kind: SolidKind;
  mesh: PolyMesh;
  morphing: boolean;
  morph: number;
  nextKind: SolidKind | null;
};

type MetaNodeKind = "center" | "inner" | "outer";
type MetaNode = {
  index: number;
  kind: MetaNodeKind;
  charge: number;
  awakened: boolean;
  overcharged: boolean;
  activatedAt: number;
};

type Level = {
  name: string;
  wave: number;
  gravityGM: number;
  solarPressure: number;
  enemyCount: number;
  enemyKind: SolidKind;
};


type ScoreAlert = HUDState["alert"] & { duration: number };
type BurstStats = { shots: number; hits: number; active: number; startedAtMs: number; awardedSalvo: boolean; awardedFull: boolean };
type WaveCitationFlags = {
  oortReach: boolean;
  farOortReach: boolean;
  returnToTheBurn: boolean;
  periapsisKiss: boolean;
};

type DebriefPhase = "inactive" | "burn_fade" | "game_over_hold" | "plotting" | "ready";
type DeathCauseKey = "shrapnel" | "enemy" | "well" | "sol" | "fuel" | "collapse" | "oort";

function deathCauseKeyFromUnknown(value: unknown): DeathCauseKey {
  switch (value) {
    case "shrapnel":
    case "enemy":
    case "well":
    case "sol":
    case "fuel":
    case "collapse":
    case "oort":
      return value;
    default:
      return "enemy";
  }
}
type DebriefSnapshot = {
  causeKey: DeathCauseKey;
  causeLabel: string;
  score: number;
  wave: number;
  survivalTimeSec: number;
  bestChain: number;
  citations: number;
  spheresAwakened: number;
  totalSpheresLit: number;
  topCitation: string;
  bestShotDistance: number;
  peakPseudoG: number;
  furthestRadius: number;
};
type DebriefUIState = {
  phase: DebriefPhase;
  phaseElapsedMs: number;
  visibleRows: number;
  snapshot: DebriefSnapshot | null;
};

function buildCommendationMap(items: CommendationDefinition[]) {
  return Object.fromEntries(items.map((item) => [item.id, item])) as Record<string, CommendationDefinition>;
}

function scoreAlertSeverity(tier: 1 | 2 | 3): HUDState["alert"]["severity"] {
  if (tier === 3) return "critical";
  if (tier === 2) return "warning";
  return "info";
}

// ===================== WEB AUDIO (DRONES + SFX) =====================
type GameMode = "menu" | "playing" | "paused" | "transition" | "debrief";
type StartPanelId = "identity" | "multiplayer" | "flight";
type StartPanelFocus = StartPanelId | null;



class DroneVoice {
  source: AudioBufferSourceNode | null = null;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: StereoPannerNode;

  constructor(private ctx: AudioContext, private buffer: AudioBuffer, output: AudioNode) {
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = AUDIO.ENEMY.FILTER_MAX_HZ;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;

    this.panner = this.ctx.createStereoPanner();
    this.panner.pan.value = 0;

    this.filter.connect(this.gain);
    this.gain.connect(this.panner);
    this.panner.connect(output);
  }

  start(playbackRate: number, gain: number, pan: number, filterHz: number) {
    if (this.source) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.playbackRate.value = playbackRate;
    src.connect(this.filter);
    this.filter.frequency.value = filterHz;
    this.gain.gain.value = gain;
    this.panner.pan.value = pan;
    src.start();
    this.source = src;
  }

  setPlaybackRate(rate: number, ramp = AUDIO.ENEMY.RATE_SMOOTH_SEC) {
    if (!this.source) return;
    const now = this.ctx.currentTime;
    const param = this.source.playbackRate;
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(rate, now + Math.max(0.001, ramp));
  }

  setGain(value: number, ramp = AUDIO.ENEMY.GAIN_SMOOTH_SEC) {
    const now = this.ctx.currentTime;
    const param = this.gain.gain;
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(Math.max(0.00001, value), now + Math.max(0.001, ramp));
  }

  setPan(value: number, ramp = AUDIO.ENEMY.PAN_SMOOTH_SEC) {
    const now = this.ctx.currentTime;
    const param = this.panner.pan;
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(clamp(value, -1, 1), now + Math.max(0.001, ramp));
  }

  setFilterHz(value: number, ramp = AUDIO.ENEMY.FILTER_SMOOTH_SEC) {
    const now = this.ctx.currentTime;
    const param = this.filter.frequency;
    const current = Math.max(20, param.value);
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(Math.max(40, value), now + Math.max(0.001, ramp));
  }

  stop(fadeSec = AUDIO.ENEMY.DEATH_FADE_SEC) {
    if (!this.source) return;
    const now = this.ctx.currentTime;
    const src = this.source;
    const param = this.gain.gain;
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(Math.max(0.00001, current), now);
    param.linearRampToValueAtTime(0.00001, now + Math.max(0.01, fadeSec));
    try { src.stop(now + Math.max(0.02, fadeSec + 0.02)); } catch {}
    this.source = null;
  }
}

class EnemyDroneVoice {
  voice: DroneVoice;
  lastKind: SolidKind;

  constructor(ctx: AudioContext, buffer: AudioBuffer, output: AudioNode, kind: SolidKind) {
    this.voice = new DroneVoice(ctx, buffer, output);
    this.lastKind = kind;
    this.voice.start(AUDIO.HARMONICS[kind], 0.00001, 0, AUDIO.ENEMY.FILTER_MIN_HZ);
  }

  update(enemy: Enemy, player: { pos: V2; vel: V2 }, solRadius: number, oortOuter: number) {
    const rel = enemy.pos.copy().sub(player.pos);
    const relDist = Math.max(1, rel.len());
    const relDir = rel.copy().mul(1 / relDist);
    const relVel = enemy.vel.copy().sub(player.vel);
    const radialSpeed = relVel.dot(relDir);
    const doppler = AUDIO.DOPPLER.ENABLED
      ? clamp(1 - radialSpeed * AUDIO.DOPPLER.SCALE, AUDIO.DOPPLER.MIN_FACTOR, AUDIO.DOPPLER.MAX_FACTOR)
      : 1;

    const baseRate = AUDIO.HARMONICS[enemy.kind];
    const rate = baseRate * doppler;
    const rateRamp = this.lastKind === enemy.kind ? AUDIO.ENEMY.RATE_SMOOTH_SEC : AUDIO.ENEMY.DEVOLVE_GLISS_SEC;
    this.voice.setPlaybackRate(rate, rateRamp);
    this.lastKind = enemy.kind;

    const relX = enemy.pos.x - player.pos.x;
    const pan = clamp(relX / AUDIO.ENEMY.PAN_WORLD_WIDTH, -1, 1);
    this.voice.setPan(pan, AUDIO.ENEMY.PAN_SMOOTH_SEC);

    const r = enemy.pos.len();
    const t = 1 - clamp((r - solRadius) / Math.max(1, oortOuter - solRadius), 0, 1);
    const shaped = Math.pow(t, AUDIO.ENEMY.GAIN_CURVE_EXP);
    const gain = lerp(AUDIO.ENEMY.MIN_GAIN, AUDIO.ENEMY.MAX_GAIN, shaped);
    const filterHz = lerp(AUDIO.ENEMY.FILTER_MIN_HZ, AUDIO.ENEMY.FILTER_MAX_HZ, t);
    this.voice.setGain(gain, AUDIO.ENEMY.GAIN_SMOOTH_SEC);
    this.voice.setFilterHz(filterHz, AUDIO.ENEMY.FILTER_SMOOTH_SEC);
  }

  stop() {
    this.voice.stop(AUDIO.ENEMY.DEATH_FADE_SEC);
  }
}

type AudioSampleKey =
  | "thrust"
  | "blaster"
  | "shipDestroyed"
  | "solDestroyed"
  | "nextWave"
  | "oortBreak"
  | "oortStrike"
  | "oortDust"
  | "sphereActivate";

class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  droneBus: GainNode | null = null;
  sfxBus: GainNode | null = null;

  thrustOsc: OscillatorNode | null = null;
  thrustGain: GainNode | null = null;
  thrustFilter: BiquadFilterNode | null = null;

  thrustSampleSrc: AudioBufferSourceNode | null = null;
  thrustSampleGain: GainNode | null = null;
  thrustSampleFilter: BiquadFilterNode | null = null;

  oortDustSrc: AudioBufferSourceNode | null = null;
  oortDustGain: GainNode | null = null;
  oortDustFilter: BiquadFilterNode | null = null;

  sampleBuffers: Record<AudioSampleKey, AudioBuffer | null> = {
    thrust: null,
    blaster: null,
    shipDestroyed: null,
    solDestroyed: null,
    nextWave: null,
    oortBreak: null,
    oortStrike: null,
    oortDust: null,
    sphereActivate: null,
  };
  sampleLoads = new Set<AudioSampleKey>();

  droneBuffer: AudioBuffer | null = null;
  droneLoadPromise: Promise<AudioBuffer> | null = null;
  backgroundVoice: DroneVoice | null = null;
  enemyVoices = new Map<string, EnemyDroneVoice>();

  enabled = false;
  get ready() { return !!this.ctx && this.enabled; }

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = AUDIO.MASTER_GAIN;

    this.droneBus = this.ctx.createGain();
    this.droneBus.gain.value = AUDIO.DRONE_BUS_GAIN * AUDIO.MODE.menu;

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = AUDIO.SFX_BUS_GAIN;

    this.droneBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(this.ctx.destination);

    const real = new Float32Array(16);
    const imag = new Float32Array(16);
    for (let i = 1; i < 16; i++) {
      const amp = 1 / (i * i * 0.9);
      real[i] = 0;
      imag[i] = (i % 2 === 1 ? amp : amp * 0.18);
    }
    const wave = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    this.thrustOsc = this.ctx.createOscillator();
    this.thrustOsc.setPeriodicWave(wave);
    this.thrustOsc.frequency.value = AUDIO.THRUST.BASE_FREQ;

    this.thrustFilter = this.ctx.createBiquadFilter();
    this.thrustFilter.type = "lowpass";
    this.thrustFilter.frequency.value = AUDIO.THRUST.BASE_FILTER;

    this.thrustGain = this.ctx.createGain();
    this.thrustGain.gain.value = 0;

    this.thrustOsc.connect(this.thrustFilter);
    this.thrustFilter.connect(this.thrustGain);
    this.thrustGain.connect(this.sfxBus);
    this.thrustOsc.start();

    this.enabled = true;
    void this.ensureDroneBuffer().then(() => this.ensureBackgroundVoice());

    this.loadSample("thrust", T.AUDIO_THRUST_URL);
    this.loadSample("blaster", T.AUDIO_BLASTER_URL);
    this.loadSample("shipDestroyed", T.AUDIO_SHIP_DESTROYED_URL);
    this.loadSample("solDestroyed", T.AUDIO_SOL_DESTROYED_URL);
    this.loadSample("nextWave", T.AUDIO_NEXT_WAVE_URL);
    this.loadSample("oortBreak", T.AUDIO_OORT_BREAK_URL);
    this.loadSample("oortStrike", T.AUDIO_OORT_STRIKE_URL);
    this.loadSample("oortDust", T.AUDIO_OORT_DUST_URL);
    this.loadSample("sphereActivate", T.AUDIO_SPHERE_ACTIVATE_URL);
  }

  async ensureDroneBuffer() {
    if (this.droneBuffer) return this.droneBuffer;
    if (!this.ctx) throw new Error("Audio context unavailable");
    if (!this.droneLoadPromise) {
      this.droneLoadPromise = this.loadDroneBuffer();
    }
    this.droneBuffer = await this.droneLoadPromise;
    return this.droneBuffer;
  }

  private async loadDroneBuffer(): Promise<AudioBuffer> {
    if (!this.ctx) throw new Error("Audio context unavailable");
    try {
      const res = await fetch(AUDIO.BUFFER_URL);
      if (!res.ok) throw new Error(`Drone fetch failed: ${res.status}`);
      const arr = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(arr.slice(0));
    } catch {
      return this.makeFallbackDroneBuffer();
    }
  }

  private makeFallbackDroneBuffer() {
    if (!this.ctx) throw new Error("Audio context unavailable");
    const len = Math.floor(this.ctx.sampleRate * AUDIO.FALLBACK_BUFFER_SECONDS);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / this.ctx.sampleRate;
      const env = 0.92 + 0.08 * Math.sin(TAU * 0.17 * t);
      const s = (
        Math.sin(TAU * 432 * t) * 0.58 +
        Math.sin(TAU * 864 * t) * 0.17 +
        Math.sin(TAU * 648 * t) * 0.11 +
        Math.sin(TAU * 1080 * t) * 0.06 +
        Math.sin(TAU * 216 * t) * 0.08
      ) * env;
      ch[i] = s * 0.35;
    }
    return buffer;
  }

  private ensureBackgroundVoice() {
    if (!this.ctx || !this.droneBus || !this.droneBuffer || this.backgroundVoice) return;
    this.backgroundVoice = new DroneVoice(this.ctx, this.droneBuffer, this.droneBus);
    this.backgroundVoice.start(
      AUDIO.BACKGROUND.PLAYBACK_RATE,
      AUDIO.BACKGROUND.GAIN,
      AUDIO.BACKGROUND.PAN,
      AUDIO.BACKGROUND.FILTER_HZ,
    );
  }

  private loadSample(key: AudioSampleKey, url: string) {
    if (!this.ctx || this.sampleBuffers[key] || this.sampleLoads.has(key)) return;
    this.sampleLoads.add(key);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`sample ${key} not found`);
        return r.arrayBuffer();
      })
      .then((buf) => this.ctx!.decodeAudioData(buf))
      .then((decoded) => {
        this.sampleBuffers[key] = decoded;
        if (key === "thrust") this.ensureThrustSampleLoop();
        if (key === "oortDust") this.ensureOortDustLoop();
      })
      .catch(() => {})
      .finally(() => this.sampleLoads.delete(key));
  }

  private ensureThrustSampleLoop() {
    if (!this.ctx || !this.sfxBus || this.thrustSampleSrc || !this.sampleBuffers.thrust) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.sampleBuffers.thrust;
    src.loop = true;
    src.playbackRate.value = T.AUDIO_THRUST_RATE_MIN;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = T.AUDIO_THRUST_FILTER_MIN_HZ;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start();

    this.thrustSampleSrc = src;
    this.thrustSampleFilter = filter;
    this.thrustSampleGain = gain;
  }

  private ensureOortDustLoop() {
    if (!this.ctx || !this.sfxBus || this.oortDustSrc || !this.sampleBuffers.oortDust) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.sampleBuffers.oortDust;
    src.loop = true;
    src.playbackRate.value = 1;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = T.AUDIO_OORT_DUST_FILTER_HZ;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start();

    this.oortDustSrc = src;
    this.oortDustFilter = filter;
    this.oortDustGain = gain;
  }

  private playSample(key: AudioSampleKey, gainValue = 0.2, playbackRate = 1): boolean {
    if (!this.ctx || !this.sfxBus) return false;
    const buf = this.sampleBuffers[key];
    if (!buf) return false;

    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = playbackRate;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainValue, t0);

    src.connect(g);
    g.connect(this.sfxBus);
    src.start(t0);
    return true;
  }

  setMaster(v: number) {
    if (!this.master) return;
    this.master.gain.value = clamp(v, 0, 1);
  }

  setMode(mode: GameMode) {
    if (!this.ctx || !this.droneBus) return;
    if (mode !== "playing") this.setOortDust(0);
    const now = this.ctx.currentTime;
    const target = AUDIO.DRONE_BUS_GAIN * AUDIO.MODE[mode];
    const param = this.droneBus.gain;
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(target, now + 0.12);
  }

  updateDrones(mode: GameMode, enemies: Enemy[], player: { pos: V2; vel: V2 }, solRadius: number, oortOuter: number) {
    if (!this.ctx || !this.droneBus || !this.enabled) return;
    this.setMode(mode);
    if (!this.droneBuffer) {
      void this.ensureDroneBuffer().then(() => this.ensureBackgroundVoice());
      return;
    }
    this.ensureBackgroundVoice();

    const liveIds = new Set(enemies.map((e) => e.id));
    for (const enemy of enemies) {
      let voice = this.enemyVoices.get(enemy.id);
      if (!voice) {
        voice = new EnemyDroneVoice(this.ctx, this.droneBuffer, this.droneBus, enemy.kind);
        this.enemyVoices.set(enemy.id, voice);
      }
      voice.update(enemy, player, solRadius, oortOuter);
    }

    for (const [id, voice] of this.enemyVoices.entries()) {
      if (!liveIds.has(id)) {
        voice.stop();
        this.enemyVoices.delete(id);
      }
    }
  }

  clearEnemyDrones() {
    for (const voice of this.enemyVoices.values()) voice.stop();
    this.enemyVoices.clear();
  }

  setThrust(amount01: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const a = clamp(amount01, 0, 1);

    this.ensureThrustSampleLoop();

    if (this.thrustSampleSrc && this.thrustSampleGain && this.thrustSampleFilter) {
      const rate = lerp(T.AUDIO_THRUST_RATE_MIN, T.AUDIO_THRUST_RATE_MAX, a);
      const cutoff = lerp(T.AUDIO_THRUST_FILTER_MIN_HZ, T.AUDIO_THRUST_FILTER_MAX_HZ, a);
      this.thrustSampleSrc.playbackRate.setTargetAtTime(rate, t, 0.03);
      this.thrustSampleFilter.frequency.setTargetAtTime(cutoff, t, 0.03);
      this.thrustSampleGain.gain.setTargetAtTime(a * T.AUDIO_THRUST_SAMPLE_GAIN, t, 0.04);
      if (this.thrustGain) this.thrustGain.gain.setTargetAtTime(0, t, 0.02);
      return;
    }

    if (!this.thrustOsc || !this.thrustGain || !this.thrustFilter) return;
    const freq = AUDIO.THRUST.BASE_FREQ + a * AUDIO.THRUST.FREQ_RANGE;
    const cutoff = AUDIO.THRUST.BASE_FILTER + a * AUDIO.THRUST.FILTER_RANGE;
    this.thrustOsc.frequency.setTargetAtTime(freq, t, 0.02);
    this.thrustFilter.frequency.setTargetAtTime(cutoff, t, 0.02);
    this.thrustGain.gain.setTargetAtTime(a * AUDIO.THRUST.GAIN_MAX, t, 0.03);
  }

  setOortDust(amount01: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const a = clamp(amount01, 0, 1);
    this.ensureOortDustLoop();
    if (!this.oortDustGain) return; // optional WAV absent: preserve the previous silent dust-abrasion behavior
    this.oortDustGain.gain.setTargetAtTime(a * T.AUDIO_OORT_DUST_GAIN, t, 0.12);
  }

  blip(freq: number, dur = 0.06, gain = 0.18) {
    if (!this.ctx || !this.sfxBus) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g); g.connect(this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noiseBurst(dur = 0.12, gain = 0.16, hp = 700) {
    if (!this.ctx || !this.sfxBus) return;
    const t0 = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = hp;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter); filter.connect(g); g.connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  shoot() {
    if (!this.playSample("blaster", T.AUDIO_BLASTER_GAIN)) this.blip(880, 0.05, 0.16);
  }
  hit() { this.noiseBurst(0.14, 0.22, 520); this.blip(220, 0.12, 0.14); }
  oortBreak() {
    if (!this.playSample("oortBreak", T.AUDIO_OORT_BREAK_GAIN, rand(0.96, 1.04))) {
      this.blip(840 + rand(-110, 170), 0.035, 0.10);
    }
  }
  oortStrike() {
    if (!this.playSample("oortStrike", T.AUDIO_OORT_STRIKE_GAIN, rand(0.94, 1.06))) {
      this.hit();
    }
  }
  sphereActivate() {
    if (this.playSample("sphereActivate", T.AUDIO_SPHERE_ACTIVATE_GAIN, rand(0.96, 1.04))) return;
    // Fallback: a small glass-bell chord, so missing optional WAVs do not leave the awakening silent.
    this.blip(432, 0.16, 0.11);
    this.blip(648, 0.18, 0.085);
    this.blip(864, 0.20, 0.065);
  }
  nextWave() {
    if (!this.playSample("nextWave", T.AUDIO_NEXT_WAVE_GAIN)) {
      this.blip(660, 0.08, 0.16);
      this.blip(990, 0.10, 0.14);
    }
  }
  levelUp() { this.nextWave(); }
  shipDestroyed() {
    if (!this.playSample("shipDestroyed", T.AUDIO_SHIP_DESTROYED_GAIN)) {
      this.noiseBurst(0.32, 0.35, 240);
      this.blip(110, 0.25, 0.18);
    }
  }
  solDestroyed() {
    if (!this.playSample("solDestroyed", T.AUDIO_SOL_DESTROYED_GAIN)) {
      this.noiseBurst(0.42, 0.45, 180);
      this.blip(72, 0.35, 0.22);
    }
  }
  explode() { this.shipDestroyed(); }

  cueDebriefPhase(phase: DebriefPhase) {
    // Placeholder hooks for future music / SFX scoring of the death ritual.
    // Keep the phase entry points explicit so a dirge, plot ticks, and leaderboard sting
    // can be layered in later without rewriting the sequence logic.
    if (!this.ctx || !this.sfxBus) return;
    if (phase === "burn_fade") {
      this.setThrust(0);
      return;
    }
    if (phase === "plotting") {
      return;
    }
    if (phase === "ready") {
      return;
    }
  }

  stop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    try { this.thrustGain?.gain.setTargetAtTime(0, t, 0.02); } catch {}
    try { this.thrustSampleGain?.gain.setTargetAtTime(0, t, 0.03); } catch {}
    try { this.thrustSampleSrc?.stop(t + 0.06); } catch {}
    try { this.oortDustGain?.gain.setTargetAtTime(0, t, 0.03); } catch {}
    try { this.oortDustSrc?.stop(t + 0.06); } catch {}
    this.thrustSampleSrc = null;
    this.thrustSampleGain = null;
    this.thrustSampleFilter = null;
    this.oortDustSrc = null;
    this.oortDustGain = null;
    this.oortDustFilter = null;
    this.clearEnemyDrones();
  }
}


// ===================== PLAYER IDENTITY + LEADERBOARD API =====================
type PublicPlayer = { authenticated: boolean; authProvider: string; callsign: string | null; canChooseCallsign: boolean };
type LeaderboardEntry = { rank: number; callsign: string; score: number; wave: number; survivalTimeSec: number; createdAt: string };
type SecurityStatus = { ok: boolean; csrfToken: string; player: PublicPlayer; devAuthEnabled?: boolean; googleAuthEnabled?: boolean; googleLoginUrl?: string | null };
type LeaderboardResponse = { ok: boolean; entries: LeaderboardEntry[] };
type ScoreSubmitStatus = "idle" | "submitting" | "submitted" | "needs_login" | "needs_callsign" | "error";

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", ...init });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `request_failed_${res.status}`;
    throw new Error(message);
  }
  return payload as T;
}

async function logClientEvent(csrfToken: string, eventType: string, severity: "info" | "warning" | "error", details: Record<string, unknown> = {}) {
  if (!csrfToken) return;
  try {
    await fetch("/api/client-events", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ eventType, severity, details }),
    });
  } catch {
    // Logging must never make gameplay worse. The little black box is useful only if it behaves itself.
  }
}

function formatLeaderboardTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  const m = Math.floor((seconds / 60) % 60).toString().padStart(2, "0");
  const h = Math.floor(seconds / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function callsignStatusMessage(player: PublicPlayer) {
  if (!player.authenticated) return "Log in before choosing a callsign.";
  if (player.callsign) return `Pilot ${player.callsign} indexed. Callsigns are account-bound.`;
  return "Choose exactly three letters or digits. This claim is permanent from the arcade UI.";
}

const MENU_HINT_TICK_MS = 50;
const MENU_HINT_TYPE_MS = 42;
const MENU_HINT_DETAIL_TYPE_MS = 18;
const MENU_HINT_DETAIL_DELAY_MS = 260;
const MENU_HINT_STABLE_MS = 8400;
const MENU_HINT_BLINK_MS = 1400;
const MENU_HINT_CYCLE_MS = MENU_HINT_STABLE_MS + MENU_HINT_BLINK_MS;

function flightHintDetail(hint: string) {
  const h = hint.toLowerCase();
  if (h.includes("stable orbit") || h.includes("sideways")) return "Your ship wants to fall. Sideways speed lets the fall miss Sol.";
  if (h.includes("prograde")) return "Burn with your motion to lift the far side of the orbit. Retrograde tightens the dive.";
  if (h.includes("retrograde")) return "Burn against your motion to drop inward. Use it deliberately; Sol collects mistakes.";
  if (h.includes("slingshot") || h.includes("close pass")) return "A near-periapsis pass converts courage into velocity. Always leave an exit vector.";
  if (h.includes("oort")) return "The outer cloud buys breathing room, but dust and ice still remember your hull.";
  if (h.includes("braking") || h.includes("drag")) return "Brake only when you must; drag is a local miracle, not a universal law.";
  if (h.includes("fuel") || h.includes("rocket equation")) return "Every ignition writes a bill. Spend thrust only when the orbit pays you back.";
  if (h.includes("impossible")) return "Goddard was mocked before the equations caught up. Use impossible sparingly.";
  if (h.includes("vacuum") || h.includes("thrust works")) return "The engine pushes against its own exhaust. The void is not a wall.";
  if (h.includes("gravity")) return "Do not overpower the well. Enter a bargain with it, then leave before it collects.";
  return "Read the trace, wait for the burn window, and let geometry do half the fighting.";
}

// ===================== MAIN COMPONENT =====================
export default function MetatronVectorFOIL() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // UI state
  const [mode, setMode] = useState<GameMode>(() => {
    if (typeof window === "undefined") return "menu";
    return new URLSearchParams(window.location.search).get("mvfAutostart") === "1" ? "playing" : "menu";
  });
  const [levelIdx, setLevelIdx] = useState(0);
  const [toggles, setToggles] = useState({ metatron: true, trails: false, debug: T.DEBUG_TEXT });
  const [hudState, setHUDState] = useState<HUDState>(DEFAULT_HUD_STATE);
  const [hudConfig, setHUDConfig] = useState(DEFAULT_HUD_CONFIG);
  const [flightHints, setFlightHints] = useState<string[]>(DEFAULT_FLIGHT_HINTS);
  const [insertCoinLines, setInsertCoinLines] = useState<string[]>(DEFAULT_INSERT_COIN_LINES);
  const [deathCauseLines, setDeathCauseLines] = useState<string[]>(DEFAULT_DEATH_CAUSE_LINES);
  const [gameOverLines, setGameOverLines] = useState<string[]>(DEFAULT_GAME_OVER_LINES);
  const [debriefUI, setDebriefUI] = useState<DebriefUIState>({ phase: "inactive", phaseElapsedMs: 0, visibleRows: 0, snapshot: null });
  const [playerIdentity, setPlayerIdentity] = useState<PublicPlayer>(DEFAULT_PLAYER);
  const [csrfToken, setCsrfToken] = useState("");
  const [callsignInput, setCallsignInput] = useState("");
  const [callsignMessage, setCallsignMessage] = useState("Log in before choosing a callsign.");
  const [devAuthEnabled, setDevAuthEnabled] = useState(false);
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(false);
  const [googleLoginUrl, setGoogleLoginUrl] = useState<string | null>(null);
  const [devHandle, setDevHandle] = useState("dev");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [scoreSubmitStatus, setScoreSubmitStatus] = useState<ScoreSubmitStatus>("idle");
  const [menuHintIdx, setMenuHintIdx] = useState(0);
  const [menuHintTick, setMenuHintTick] = useState(0);
  const [attractIdx, setAttractIdx] = useState(0);
  const [attractPhaseTick, setAttractPhaseTick] = useState(0);
  const [startPanelFocus, setStartPanelFocus] = useState<StartPanelFocus>(null);

  const modeRef = useRef(mode);
  const levelIdxRef = useRef(levelIdx);
  const togglesRef = useRef(toggles);
  const csrfTokenRef = useRef("");
  const playerIdentityRef = useRef<PublicPlayer>(DEFAULT_PLAYER);
  const submitScoreRef = useRef<(snapshot: DebriefSnapshot) => void>(() => undefined);
  const clientStartupLoggedRef = useRef(false);
  const commendationMapRef = useRef<Record<string, CommendationDefinition>>(buildCommendationMap(DEFAULT_COMMENDATIONS));
  const [sliders, setSliders] = useState({
    gravity: T.GRAVITY_GM,
    thrust: T.THRUST_FORCE,
    trail: T.TRAIL_SAMPLES,
    master: AUDIO.MASTER_GAIN,
    solar: T.SOLAR_PRESSURE,
    hudScale: DEFAULT_HUD_CONFIG.scale,
    hudOpacity: DEFAULT_HUD_CONFIG.opacity,
  });

  const audioRef = useRef(new AudioEngine());
  const keysRef = useRef(new Set<string>());
  const resetToMenuRef = useRef<(() => void) | null>(null);
  const multiplayerTransportRef = useRef<MultiplayerTransportHub | null>(null);

  useEffect(() => {
    installFlightRecorderErrorCapture();
    debugLog("lifecycle", "component-mounted", {
      sessionId: getFlightRecorderSessionId(),
      maxPlayers: MULTIPLAYER_NET_CONFIG.maxPlayers,
      snapshotHz: MULTIPLAYER_NET_CONFIG.snapshotHz,
    });
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.get("mvfAutostart") === "1") {
        url.searchParams.delete("mvfAutostart");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }
    return () => debugLog("lifecycle", "component-unmounted");
  }, []);

  useEffect(() => {
    setFlightRecorderContext({
      role: "solo",
      playerId: LOCAL_SOLO_PLAYER_ID,
      callsign: playerIdentity.callsign ?? null,
    });
  }, [playerIdentity.callsign]);

  // Keep slider values available inside the loop without rerenders
  const slidersRef = useRef(sliders);
  useEffect(() => {
    slidersRef.current = sliders;
    audioRef.current.setMaster(sliders.master);
    setHUDConfig((cfg) => ({ ...cfg, scale: sliders.hudScale, opacity: sliders.hudOpacity }));
  }, [sliders]);
  useEffect(() => {
    modeRef.current = mode;
    audioRef.current.setMode(mode);
    if (mode !== "playing") audioRef.current.setThrust(0);
  }, [mode]);
  useEffect(() => { levelIdxRef.current = levelIdx; }, [levelIdx]);
  useEffect(() => { togglesRef.current = toggles; }, [toggles]);
  useEffect(() => { csrfTokenRef.current = csrfToken; }, [csrfToken]);
  useEffect(() => { playerIdentityRef.current = playerIdentity; }, [playerIdentity]);

  const refreshLeaderboard = async () => {
    try {
      const board = await readJson<LeaderboardResponse>("/api/leaderboard?limit=10");
      setLeaderboard(board.entries ?? []);
    } catch (err) {
      setLeaderboard([]);
      debugWarn("network", "leaderboard-refresh-failed", {
        endpoint: "/api/leaderboard",
        message: err instanceof Error ? err.message : "unknown",
      });
      void logClientEvent(csrfTokenRef.current, "client.api_error", "warning", {
        endpoint: "/api/leaderboard",
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  };

  const refreshSecurityStatus = async () => {
    try {
      const status = await readJson<SecurityStatus>("/api/security/status");
      setCsrfToken(status.csrfToken);
      setPlayerIdentity(status.player ?? DEFAULT_PLAYER);
      setDevAuthEnabled(Boolean(status.devAuthEnabled));
      setGoogleAuthEnabled(Boolean(status.googleAuthEnabled));
      setGoogleLoginUrl(status.googleLoginUrl ?? null);
      setCallsignInput(status.player?.callsign ?? "");
      setCallsignMessage(callsignStatusMessage(status.player ?? DEFAULT_PLAYER));
      if (!clientStartupLoggedRef.current) {
        clientStartupLoggedRef.current = true;
        debugLog("lifecycle", "client-startup", {
          authProvider: status.player?.authProvider ?? "none",
          hasCallsign: Boolean(status.player?.callsign),
        });
        void logClientEvent(status.csrfToken, "client.startup", "info", {
          authProvider: status.player?.authProvider ?? "none",
          hasCallsign: Boolean(status.player?.callsign),
        });
      }
    } catch (err) {
      debugWarn("network", "security-status-unavailable", { message: err instanceof Error ? err.message : "unknown" });
      setCallsignMessage("Identity bus unavailable; local flight still works.");
    }
  };

  useEffect(() => {
    refreshSecurityStatus();
    refreshLeaderboard();
    const id = window.setInterval(refreshLeaderboard, 30000);
    return () => window.clearInterval(id);
  }, []);

  submitScoreRef.current = (snapshot: DebriefSnapshot) => {
    const token = csrfTokenRef.current;
    if (!token || !playerIdentityRef.current.authenticated) {
      setScoreSubmitStatus("needs_login");
      return;
    }
    if (!playerIdentityRef.current.callsign) {
      setScoreSubmitStatus("needs_callsign");
      return;
    }
    setScoreSubmitStatus("submitting");
    readJson<{ ok: boolean }>("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify({
        score: snapshot.score,
        wave: snapshot.wave,
        survivalTimeSec: snapshot.survivalTimeSec,
        bestChain: snapshot.bestChain,
        citations: snapshot.citations,
        spheresAwakened: snapshot.spheresAwakened,
        causeKey: snapshot.causeKey,
      }),
    })
      .then(() => {
        setScoreSubmitStatus("submitted");
        refreshLeaderboard();
      })
      .catch((err) => {
        setScoreSubmitStatus("error");
        debugWarn("network", "score-submission-failed", {
          message: err instanceof Error ? err.message : "unknown",
          score: snapshot.score,
          wave: snapshot.wave,
        });
        void logClientEvent(token, "client.score_submission_error", "warning", {
          message: err instanceof Error ? err.message : "unknown",
          score: snapshot.score,
          wave: snapshot.wave,
        });
      });
  };

  const submitCallsign = async () => {
    const callsign = callsignInput.trim();
    if (!playerIdentity.authenticated) {
      setCallsignMessage("Log in before choosing a callsign. Callsigns are not passwords.");
      return;
    }
    if (!playerIdentity.canChooseCallsign) {
      setCallsignMessage(callsignStatusMessage(playerIdentity));
      return;
    }
    if (!/^[A-Za-z0-9]{3}$/.test(callsign)) {
      setCallsignMessage("Callsign must be exactly 3 ASCII letters or digits.");
      return;
    }
    if (!csrfToken) {
      setCallsignMessage("Identity bus warming up; try again after the next phosphor blink.");
      return;
    }
    try {
      const result = await readJson<{ ok: boolean; player: PublicPlayer }>("/api/player/callsign", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ callsign }),
      });
      setPlayerIdentity(result.player);
      setCallsignInput(result.player.callsign ?? callsign);
      setCallsignMessage(callsignStatusMessage(result.player));
      setScoreSubmitStatus("idle");
      refreshLeaderboard();
    } catch (err) {
      const error = err instanceof Error ? err.message : "unknown";
      const msg = error === "callsign_taken"
        ? "That callsign is already transmitting."
        : error === "login_required_before_callsign"
          ? "Log in before choosing a callsign."
          : error === "callsign_already_assigned"
            ? "This account already has a callsign assigned."
            : "Callsign registration failed.";
      setCallsignMessage(msg);
      void logClientEvent(csrfToken, "client.api_error", "warning", {
        endpoint: "/api/player/callsign",
        message: error,
      });
    }
  };

  const googleLogin = () => {
    if (!googleAuthEnabled) return;
    window.location.assign(googleLoginUrl || "/auth/google/start");
  };

  const devLogin = async () => {
    if (!csrfToken || !devAuthEnabled) return;
    const handle = devHandle.trim() || "dev";
    try {
      const result = await readJson<{ ok: boolean; player: PublicPlayer }>("/api/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ handle }),
      });
      setPlayerIdentity(result.player);
      setCallsignInput(result.player.callsign ?? "");
      setCallsignMessage(callsignStatusMessage(result.player));
      setScoreSubmitStatus("idle");
    } catch (err) {
      setCallsignMessage(`Dev login failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  const logoutPlayer = async () => {
    if (!csrfToken) return;
    try {
      const result = await readJson<{ ok: boolean; player: PublicPlayer; csrfToken?: string }>("/api/player/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({}),
      });
      if (result.csrfToken) setCsrfToken(result.csrfToken);
      setPlayerIdentity(result.player ?? DEFAULT_PLAYER);
      setCallsignInput("");
      setCallsignMessage(callsignStatusMessage(result.player ?? DEFAULT_PLAYER));
      setScoreSubmitStatus("idle");
    } catch (err) {
      setCallsignMessage(`Logout failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };

  useEffect(() => {
    let cancelled = false;
    loadTextLines("/static/text/flight-hints.txt")
      .then((lines) => { if (!cancelled && lines.length > 0) setFlightHints(lines); })
      .catch(() => undefined);
    loadTextLines("/static/text/insert-coin.txt")
      .then((lines) => { if (!cancelled && lines.length > 0) setInsertCoinLines(lines); })
      .catch(() => undefined);
    loadTextLines("/static/text/death-causes.txt")
      .then((lines) => { if (!cancelled && lines.length > 0) setDeathCauseLines(lines); })
      .catch(() => undefined);
    loadTextLines("/static/text/game-over.txt")
      .then((lines) => { if (!cancelled && lines.length > 0) setGameOverLines(lines); })
      .catch(() => undefined);
    loadJson<CommendationDefinition[]>("/static/text/commendations.json")
      .then((items) => {
        if (cancelled || items.length === 0) return;
        commendationMapRef.current = buildCommendationMap(items);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (mode !== "menu") {
      setMenuHintTick(0);
      return;
    }
    setMenuHintTick(0);
    const id = window.setInterval(() => setMenuHintTick((tick) => tick + 1), MENU_HINT_TICK_MS);
    return () => window.clearInterval(id);
  }, [mode, menuHintIdx]);

  useEffect(() => {
    if (mode !== "menu") return;
    const id = window.setTimeout(() => {
      setMenuHintIdx((idx) => (flightHints.length > 0 ? (idx + 1) % flightHints.length : 0));
    }, MENU_HINT_CYCLE_MS);
    return () => window.clearTimeout(id);
  }, [mode, flightHints.length, menuHintIdx]);


  const attractSequence = useMemo((): Array<{ id: string; label: string; headline: string; subline: string; anim: "typeon" | "blink" | "flicker" | "pulse"; durationMs: number }> => {
    const motto = insertCoinLines[3] ?? DEFAULT_INSERT_COIN_LINES[3];
    return [
      { id: "online", label: "SYSTEM", headline: "SPHENIC CORSAIR ONLINE", subline: "VECTOR FIELD LOCKED", anim: "flicker" as const, durationMs: 1300 },
      { id: "scope", label: "SCOPE", headline: "LIVE ORBITAL TRACE", subline: "PHOSPHOR PERSISTENCE", anim: "pulse" as const, durationMs: 1900 },
      { id: "tree", label: "TREE", headline: "AWAKEN WHAT YOU TOUCH", subline: motto, anim: "typeon" as const, durationMs: 2200 },
      { id: "guidance", label: "GUIDANCE", headline: "ORBITAL LESSON ARMED", subline: "READ THE BURN", anim: "typeon" as const, durationMs: 2100 },
    ];
  }, [insertCoinLines]);

  const currentAttract = attractSequence[attractIdx % attractSequence.length];
  const attractPhase = attractPhaseTick / 10;
  const attractPulse = 0.76 + 0.24 * ((Math.sin(attractPhase * Math.PI * 2) + 1) / 2);
  const attractBlinkOn = attractPhaseTick % 12 < 8;
  const attractFlickerOn = ![1, 5, 11].includes(attractPhaseTick % 16);
  const headlineChars = Math.max(1, Math.floor(attractPhaseTick * 1.8));
  const sublineChars = Math.max(1, Math.floor(attractPhaseTick * 2.4) - 6);
  const featuredHeadline = currentAttract.anim === "typeon"
    ? currentAttract.headline.slice(0, headlineChars)
    : currentAttract.headline;
  const featuredSubline = currentAttract.anim === "typeon"
    ? currentAttract.subline.slice(0, sublineChars)
    : currentAttract.subline;
  const featuredOpacity = currentAttract.anim === "blink"
    ? (attractBlinkOn ? 1 : 0.14)
    : currentAttract.anim === "flicker"
      ? (attractFlickerOn ? 1 : 0.35)
      : currentAttract.anim === "pulse"
        ? attractPulse
        : 0.94;
  const featuredGlow = currentAttract.anim === "pulse"
    ? 0.55 + 0.45 * attractPulse
    : currentAttract.anim === "flicker"
      ? (attractFlickerOn ? 0.9 : 0.2)
      : currentAttract.anim === "blink"
        ? (attractBlinkOn ? 0.85 : 0.08)
        : 0.72;

  useEffect(() => {
    if (mode !== "menu") {
      setAttractIdx(0);
      setAttractPhaseTick(0);
      return;
    }
    setAttractPhaseTick(0);
    const tickId = window.setInterval(() => setAttractPhaseTick((t) => t + 1), 90);
    return () => window.clearInterval(tickId);
  }, [mode, attractIdx]);

  useEffect(() => {
    if (mode !== "menu") return;
    const timeoutId = window.setTimeout(() => {
      setAttractIdx((idx) => (idx + 1) % attractSequence.length);
    }, currentAttract.durationMs);
    return () => window.clearTimeout(timeoutId);
  }, [mode, attractSequence.length, currentAttract.durationMs, attractIdx]);


  const getLevel = (idx: number): Level => {
    const wave = idx + 1;
    const enemyKind: SolidKind = wave <= 1 ? "cube" : wave === 2 ? "octa" : wave === 3 ? "dodeca" : "icosa";
    const kindName = enemyKind.charAt(0).toUpperCase() + enemyKind.slice(1);
    return {
      name: `Wave ${wave} · ${kindName}`,
      wave,
      gravityGM: T.GRAVITY_GM * (1 + idx * 0.08),
      solarPressure: T.SOLAR_PRESSURE * (1 + idx * 0.05),
      enemyCount: wave,
      enemyKind,
    };
  };

  // ===================== GAME LOOP =====================
  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const ctx0 = canvasEl.getContext("2d");
    if (!ctx0) return;
    const ctx = ctx0;
    const canvas = canvasEl;

    // ---- sizing ----
    let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    function setSize() {
      const host = canvas.parentElement as HTMLElement | null;
      const cssW = Math.max(1, Math.floor(host?.clientWidth ?? 1100));
      const cssH = Math.max(1, Math.floor(host?.clientHeight ?? 650));
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
      canvas.style.width = "100%";
      canvas.style.height = "100%";
    }
    setSize();
    const onResize = () => { dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); setSize(); };
    window.addEventListener("resize", onResize);

    // ---- input ----
    let onDebriefAdvance: (() => void) | null = null;
    let publishTerminalAuthorityState: ((causeKey: DeathCauseKey) => void) | null = null;
    const keys = keysRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " ") e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        const filename = exportDebugBundle({
          trigger: "hotkey",
          mode: modeRef.current,
          levelIdx: levelIdxRef.current,
          toggles: togglesRef.current,
          transport: multiplayerTransportRef.current?.getState() ?? null,
        });
        debugLog("lifecycle", "debug-export-complete", { trigger: "hotkey", filename });
        return;
      }
      // Audio unlock on first interaction
      audioRef.current.init();

      keys.add(e.key);

      if (e.key === "Enter") {
        if (modeRef.current === "debrief") {
          onDebriefAdvance?.();
          return;
        }
        if (modeRef.current === "menu") {
          const url = new URL(window.location.href);
          const rawConfiguredCount = Number(url.searchParams.get("mvfLocalPlayers"));
          const hasExplicitLocalCount = rawConfiguredCount === 1 || rawConfiguredCount === 2 || rawConfiguredCount === 3 || rawConfiguredCount === 4;
          const detectedLocalCount = Math.max(1, Math.min(4, getConnectedGamepadDescriptors().length)) as 1 | 2 | 3 | 4;
          const desiredLocalCount = transportLaunch.role === "guest"
            ? 1
            : hasExplicitLocalCount
              ? rawConfiguredCount as 1 | 2 | 3 | 4
              : detectedLocalCount;

          if (desiredLocalCount !== transportLaunch.localPlayerCount) {
            url.searchParams.set("mvfRole", transportLaunch.role);
            url.searchParams.set("mvfRoom", transportLaunch.roomId);
            url.searchParams.set("mvfRoster", "1");
            url.searchParams.set("mvfBroadcast", transportLaunch.enableBroadcastChannel ? "1" : "0");
            url.searchParams.set("mvfLocalPlayers", String(desiredLocalCount));
            url.searchParams.set("mvfAutostart", "1");
            debugLog("lifecycle", "local-player-launch-reconfigure", {
              previousLocalPlayerCount: transportLaunch.localPlayerCount,
              desiredLocalPlayerCount: desiredLocalCount,
              detectedGamepads: getConnectedGamepadDescriptors().map((pad) => ({ index: pad.index, label: pad.label })),
            });
            window.location.assign(url.toString());
            return;
          }

          modeRef.current = "playing";
          setMode("playing");
          return;
        }
        if (modeRef.current === "paused") {
          modeRef.current = "playing";
          setMode("playing");
        }
      }
      if ((e.key === " " || e.key === "Space") && modeRef.current === "debrief") {
        onDebriefAdvance?.();
        return;
      }
      if (e.key === "p" || e.key === "P") {
        setMode((m) => {
          const next = m === "playing" ? "paused" : (m === "paused" ? "playing" : m);
          modeRef.current = next;
          return next;
        });
      }
      if (e.key === "m" || e.key === "M") setToggles((t) => ({ ...t, metatron: !t.metatron }));
      if (e.key === "t" || e.key === "T") setToggles((t) => ({ ...t, trails: !t.trails }));
      if (e.key === "b" || e.key === "B") setToggles((t) => ({ ...t, debug: !t.debug }));
    };
    const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.key); };
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    const onPointerDown = () => audioRef.current.init();
    window.addEventListener("pointerdown", onPointerDown, { passive: true });

    // ---- world ----
    // Visual Metatron tuning is intentionally decoupled from node placement and playfield/camera scale.
    // META_CIRCLE_RADIUS controls both the drawn Metatron circles/spheres and their gameplay regions.
    // META_NODE_SPACING only changes the center-to-center arrangement of the 13 nodes.
    // META_PLAYFIELD_RADIUS controls gameplay/camera/Oort/horizon scale.
    const metaRadius = T.META_PLAYFIELD_RADIUS;
    const horizonR = metaRadius * T.HORIZON_MULT;
    const oortInner = horizonR * T.OORT_INNER_MULT;
    const oortOuter = horizonR * T.OORT_OUTER_MULT;

    const centers2 = metatronCenters(T.META_NODE_SPACING);
    const centers3 = centers2.map((c, i) => new V3(c.x, c.y, (i % 2 === 0 ? 1 : -1) * T.META_DEPTH_WOBBLE));
    const metaNodes: MetaNode[] = centers2.map((_, i) => ({
      index: i,
      kind: i === 0 ? "center" : (i <= 6 ? "inner" : "outer"),
      charge: i === 0 ? T.META_NODE_MAX_CHARGE_SEC : 0,
      awakened: i === 0,
      overcharged: i === 0,
      activatedAt: i === 0 ? 0 : -Infinity,
    }));
    let metaNodeWorld: V2[] = centers2.map((c) => new V2(c.x, c.y));

    // entities
    const camera = { pos: new V2(0, 0), zoom: 1 };
    const player: PlayerShipState = {
      pos: new V2(metaRadius, 0),
      vel: new V2(0, 0),
      angle: 0,
      angularVel: 0,
      thrust: 0,
      brakeAnim: 0,
      thrustGlow: 0,
      inActivatedSphere: false,
      fuel: T.FUEL_MAX,
      stuckTime: 0,
      hitsTaken: 0,
      hitInvuln: 0,
    };

    let shipBrakeInput = 0;
    const transportLaunch = detectMultiplayerTransportLaunch();
    const playerSlots = createPlayerRegistryWithLocal(
      transportLaunch.localPlayerId,
      transportLaunch.role,
      playerIdentityRef.current.callsign,
      transportLaunch.requestedSlot,
    );
    const localPlayerIds = new Set<PlayerId>([transportLaunch.localPlayerId]);
    if (transportLaunch.role !== "guest" && transportLaunch.localPlayerCount > 1) {
      for (let slotIndex = 1; slotIndex < transportLaunch.localPlayerCount; slotIndex += 1) {
        const localId = `${transportLaunch.localPlayerId}-local-${slotIndex}`;
        const slot = assignPlayerSlot(
          playerSlots,
          localId,
          transportLaunch.role,
          `P${slotIndex + 1}`,
          slotIndex as PlayerSlotIndex,
        );
        if (slot) localPlayerIds.add(localId);
      }
    }
    const authorityMode = transportLaunch.role === "host"
      ? "host"
      : transportLaunch.role === "guest"
        ? "client-mirror"
        : "solo-authority";
    const transport = createMultiplayerTransport(transportLaunch);
    multiplayerTransportRef.current = transport;
    setFlightRecorderContext({
      role: transportLaunch.role,
      playerId: transportLaunch.localPlayerId,
      callsign: playerIdentityRef.current.callsign ?? null,
    });
    debugLog("player", "player-registry-initialized", {
      players: playerSlots.map((slot) => ({ id: slot.id, slot: slot.slot, role: slot.role, lifeState: slot.lifeState })),
      maxPlayers: MULTIPLAYER_NET_CONFIG.maxPlayers,
      transportRole: transportLaunch.role,
      roomId: transportLaunch.roomId,
    });

    const authorityClock = createAuthorityClock(authorityMode);
    const entityIdCounters = createEntityIdCounters();
    let lastLocalInputSeq = 0;
    let localClientTick = 0;
    const remotePlayerMirrors: Record<PlayerId, PlayerRuntimeMirror> = {};
    const guestPredictionQueue = createPendingInputQueue(transportLaunch.localPlayerId);
    const guestSnapshotTimeline = new SnapshotTimeline();
    const localRenderCorrection = { x: 0, y: 0, angle: 0 };
    let displayedLocalPlayer = { x: player.pos.x, y: player.pos.y, angle: player.angle };
    const ackClientTimeMsByPlayer: Record<PlayerId, number> = {};
    let predictionHeartbeatAccumulator = 0;

    const bullets: Bullet[] = [];
    const enemies: Enemy[] = [];
    let nextEnemyId = 1;
    const shards: Shard[] = [];
    const fuelBits: FuelBit[] = [];
    const trail: V2[] = [];
    const oortClusters: OortCluster[] = [];

    const buildOortCloud = () => {
      oortClusters.length = 0;
      if (!T.OORT_CONSTELLATIONS_ENABLED) return;
      const inner = oortOuter * T.OORT_CONSTELLATION_INNER_MULT;
      const outer = oortOuter * T.OORT_CONSTELLATION_OUTER_MULT;
      for (let i = 0; i < T.OORT_CLUSTER_COUNT; i++) {
        const bandT = Math.sqrt(rand(0, 1)); // bias toward the outer dark
        const orbitRadius = lerp(inner, outer, bandT);
        const speedSign = Math.random() < 0.5 ? -1 : 1;
        const speedScale = Math.pow(clamp(inner / Math.max(1, orbitRadius), 0.35, 1.35), 0.5);
        oortClusters.push({
          orbitRadius,
          orbitPhase: rand(0, TAU),
          orbitSpeed: speedSign * rand(T.OORT_ORBIT_SPEED_MIN, T.OORT_ORBIT_SPEED_MAX) * speedScale,
          eccentricity: rand(0, T.OORT_ECCENTRICITY_MAX),
          eccentricPhase: rand(0, TAU),
          localSpin: rand(0, TAU),
          localSpinSpeed: rand(T.OORT_LOCAL_SPIN_SPEED_MIN, T.OORT_LOCAL_SPIN_SPEED_MAX),
          glyphRadius: rand(T.OORT_GLYPH_RADIUS_MIN, T.OORT_GLYPH_RADIUS_MAX),
          brightness: rand(0.55, 1.25),
          hazard: rand(0.55, 1.35),
          hue: rand(185, 225),
          variant: i % 3,
          brokenUntil: 0,
          pulseUntil: 0,
        });
      }
    };
    buildOortCloud();

    // metatron angles
    let metaAx = 0, metaAy = 0, metaAz = 0;
    let metaPulseClock = 0;
    let metaAlignT = metatronAlignmentFor(0);

    // timers / wave state
    let gunCD = 0;
    let waveBannerTimer = 0;
    let waveBannerText = "";
    let waveActive = false;
    let pendingWaveIdx = 0;
    let hudPublishAccumulator = 0;

    // reset helper
    const getAwakenedMetaNodeCount = () => metaNodes.filter((node) => node.kind !== "center" && node.awakened).length;

    const updateMetaAlignment = (dt: number) => {
      const target = metatronAlignmentFor(getAwakenedMetaNodeCount());
      const maxStep = T.META_ALIGN_SETTLE_SEC > 0 ? dt / T.META_ALIGN_SETTLE_SEC : 1;
      metaAlignT = approachScalar(metaAlignT, target, maxStep);
    };

    const syncMetaNodeWorldPositions = () => {
      const alignT = smoothstep(0, 1, metaAlignT);
      const tiltT = 1 - alignT;
      metaNodeWorld = centers3.map((v0) => {
        let v = new V3(v0.x, v0.y, v0.z * tiltT);
        v = rotX(v, metaAx * tiltT);
        v = rotY(v, metaAy * tiltT);
        v = rotZ(v, metaAz);
        const p = project(v, 1, 220 / 240);
        return new V2(p.x, p.y);
      });
    };

    const resetMetaNodes = () => {
      for (const node of metaNodes) {
        const isCenter = node.kind === "center";
        node.charge = isCenter ? T.META_NODE_MAX_CHARGE_SEC : 0;
        node.awakened = isCenter;
        node.overcharged = isCenter;
        node.activatedAt = isCenter ? 0 : -Infinity;
      }
      metaAlignT = metatronAlignmentFor(0);
      syncMetaNodeWorldPositions();
    };

    const findNearestMetaNode = (point: V2) => {
      let bestNode: MetaNode | null = null;
      let bestDist = Infinity;
      for (const node of metaNodes) {
        if (node.kind === "center") continue;
        const d = point.copy().sub(metaNodeWorld[node.index]).len();
        if (d < bestDist) {
          bestDist = d;
          bestNode = node;
        }
      }
      const gameplayRadius = T.META_CIRCLE_RADIUS;
      if (!bestNode || bestDist > gameplayRadius) return null;
      return bestNode;
    };

    const chargeMetaNodeAt = (point: V2, overcharge = false) => {
      const node = findNearestMetaNode(point);
      if (!node) return { charged: false, newlyAwakened: false, allLit: false, nodeIndex: -1 };
      const wasDark = !node.awakened;
      node.awakened = true;
      node.charge = T.META_NODE_MAX_CHARGE_SEC;
      node.overcharged = node.overcharged || overcharge;
      if (wasDark) node.activatedAt = metaPulseClock;
      const allLit = metaNodes.filter((n) => n.kind !== "center").every((n) => n.awakened);
      return { charged: true, newlyAwakened: wasDark, allLit, nodeIndex: node.index };
    };

    const queueWaveBanner = (waveIdx: number) => {
      const wave = getLevel(waveIdx).wave;
      waveBannerText = `Prepare for Wave ${wave}`;
      waveBannerTimer = 3.0;
      pendingWaveIdx = waveIdx;
      waveActive = false;
    };

    const deathCauseLabelFor = (causeKey: DeathCauseKey) => {
      const lines = deathCauseLines.length > 0 ? deathCauseLines : DEFAULT_DEATH_CAUSE_LINES;
      const indexByKey: Record<DeathCauseKey, number> = {
        shrapnel: 0,
        well: 1,
        sol: 2,
        enemy: 3,
        fuel: 4,
        collapse: 5,
        oort: 6,
      };
      return lines[indexByKey[causeKey]] ?? DEFAULT_DEATH_CAUSE_LINES[indexByKey[causeKey]];
    };

    const getDebriefRowTotal = (snapshot: DebriefSnapshot | null) => (snapshot ? 8 : 0);

    let debriefPhase: DebriefPhase = "inactive";
    let debriefPhaseElapsedMs = 0;
    let debriefVisibleRows = 0;
    let debriefSnapshot: DebriefSnapshot | null = null;
    let debriefPublishAccumulator = 0;

    const publishDebriefUI = () => {
      setDebriefUI({
        phase: debriefPhase,
        phaseElapsedMs: debriefPhaseElapsedMs,
        visibleRows: debriefVisibleRows,
        snapshot: debriefSnapshot ? { ...debriefSnapshot } : null,
      });
    };

    const setDebriefPhaseNow = (next: DebriefPhase) => {
      debriefPhase = next;
      debriefPhaseElapsedMs = 0;
      if (next === "plotting") debriefVisibleRows = 0;
      if (next === "ready") debriefVisibleRows = getDebriefRowTotal(debriefSnapshot);
      audioRef.current.cueDebriefPhase(next);
      publishDebriefUI();
    };

    const slotSpawnAngle = (slot?: PlayerSlotIndex | null) => {
      const safeSlot = slot === 1 || slot === 2 || slot === 3 ? slot : 0;
      return safeSlot * Math.PI * 0.5;
    };

    const slotSpawnState = (slot?: PlayerSlotIndex | null, tangentialSpeed = 0) => {
      const angle = slotSpawnAngle(slot);
      const pos = V2.fromAngle(angle, metaRadius);
      const vel = V2.fromAngle(angle + Math.PI * 0.5, tangentialSpeed);
      const shipAngle = Math.atan2(vel.y, vel.x);
      return { pos, vel, angle: shipAngle };
    };

    const applyLocalSlotSpawn = (tangentialSpeed: number) => {
      const spawn = slotSpawnState(playerSlots[0]?.slot ?? transportLaunch.requestedSlot ?? 0, tangentialSpeed);
      player.pos = spawn.pos;
      player.vel = spawn.vel;
      player.angle = spawn.angle;
    };

    const neutralControl = (seq = 0): PlayerControlState => ({
      rotate: 0,
      thrust: 0,
      brake: 0,
      fireHeld: false,
      firePressed: false,
      seq,
      clientTick: 0,
      simulationDtMs: T.FIXED_DT * 1000,
      clientTimeMs: Date.now(),
    });

    const createRuntimeForSlot = (slot: { id: PlayerId; slot: PlayerSlotIndex }, tangentialSpeed = 0): PlayerRuntimeMirror => {
      const spawn = slotSpawnState(slot.slot, tangentialSpeed);
      const pad = getConnectedGamepadDescriptors()[slot.slot];
      return {
        pos: spawn.pos,
        vel: spawn.vel,
        angle: spawn.angle,
        angularVel: 0,
        thrust: 0,
        brakeAnim: 0,
        thrustGlow: 0,
        inActivatedSphere: false,
        fuel: T.FUEL_MAX,
        stuckTime: 0,
        hitsTaken: 0,
        hitInvuln: 0,
        brakeInput: 0,
        gunCooldown: 0,
        lastInputSeq: 0,
        currentInput: neutralControl(),
        pendingInputs: [],
        trail: [],
        localGamepadIndex: localPlayerIds.has(slot.id) ? (pad?.index ?? null) : null,
        local: localPlayerIds.has(slot.id),
        renderCorrection: { x: 0, y: 0, angle: 0 },
        displayedX: spawn.pos.x,
        displayedY: spawn.pos.y,
        displayedAngle: spawn.angle,
        lastAckClientTimeMs: 0,
      };
    };

    const seedRemoteMirrorSpawn = (slot: { id: PlayerId; slot: PlayerSlotIndex }, tangentialSpeed = 0) => {
      if (slot.id === playerSlots[0]?.id || remotePlayerMirrors[slot.id]) return;
      remotePlayerMirrors[slot.id] = createRuntimeForSlot(slot, tangentialSpeed);
    };

    const shipForPlayerId = (playerId: PlayerId): PlayerShipState | null => {
      if (playerId === playerSlots[0]?.id) return player;
      return remotePlayerMirrors[playerId] ?? null;
    };

    const allAuthoritativeShips = () => playerSlots
      .filter((slot) => slot.connected && slot.lifeState === "alive")
      .map((slot) => ({ slot, ship: shipForPlayerId(slot.id) }))
      .filter((entry): entry is { slot: (typeof playerSlots)[number]; ship: PlayerShipState } => Boolean(entry.ship));

    const samplePlayerTrail = (points: V2[], position: V2) => {
      const maxTrail = Math.max(0, slidersRef.current.trail | 0);
      if (maxTrail <= 0) {
        points.length = 0;
        return;
      }
      points.push(position.copy());
      if (points.length > maxTrail) points.splice(0, points.length - maxTrail);
    };

    const clearPlayerTrail = (playerId: PlayerId) => {
      if (playerId === playerSlots[0]?.id) {
        trail.length = 0;
        return;
      }
      const runtime = remotePlayerMirrors[playerId];
      if (runtime) runtime.trail.length = 0;
    };

    for (const slot of playerSlots) seedRemoteMirrorSpawn(slot);

    const resetRun = (toMenu = false) => {
      debugLog("lifecycle", "run-reset", { toMenu, previousMode: modeRef.current, wave: getLevel(levelIdxRef.current).wave });
      bullets.length = 0; enemies.length = 0; shards.length = 0; fuelBits.length = 0; trail.length = 0;
      resetAuthorityClock(authorityClock, authorityMode);
      resetEntityIdCounters(entityIdCounters);
      lastLocalInputSeq = 0;
      for (const c of oortClusters) {
        c.brokenUntil = 0;
        c.pulseUntil = 0;
      }
      resetMetaNodes();
      // orbit init
      const gm = slidersRef.current.gravity;
      const v0 = Math.sqrt((gm) / metaRadius) * T.ORBIT_GAIN;
      applyLocalSlotSpawn(v0);
      player.angularVel = 0;
      player.thrust = 0;
      shipBrakeInput = 0;
      player.brakeAnim = 0;
      player.thrustGlow = 0;
      player.inActivatedSphere = false;
      player.fuel = T.FUEL_MAX;
      player.stuckTime = 0;
      player.hitsTaken = 0;
      player.hitInvuln = 0;
      guestPredictionQueue.items.length = 0;
      guestPredictionQueue.lastAckSeq = 0;
      guestSnapshotTimeline.clear();
      localRenderCorrection.x = 0;
      localRenderCorrection.y = 0;
      localRenderCorrection.angle = 0;
      displayedLocalPlayer = { x: player.pos.x, y: player.pos.y, angle: player.angle };
      for (const slot of playerSlots) {
        markPlayerRespawned(slot);
        if (slot.id === playerSlots[0]?.id) continue;
        const replacementRuntime = createRuntimeForSlot(slot, v0);
        remotePlayerMirrors[slot.id] = replacementRuntime;
      }
      debugLog("player", "players-respawned", { players: playerSlotSummary(playerSlots), reason: "run-reset", authorityTick: authorityClock.tick });
      gunCD = 0;
      nextEnemyId = 1;
      metaAx = 0; metaAy = 0; metaAz = 0; metaPulseClock = 0;
      score = 0;
      chainMultiplier = 1;
      bestChainMultiplier = 1;
      citationCount = 0;
      runClockMs = 0;
      scoreIdleMs = 0;
      lastScoreCategory = null;
      activeScoringAlert = null;
      scoringAlertQueue.length = 0;
      lastShotAtMs = -Infinity;
      currentBurstId = 0;
      burstStats.clear();
      allSpheresLitAwarded = false;
      runAwakenedCount = 0;
      bestShotDistance = 0;
      peakPseudoG = 0;
      furthestRadius = metaRadius;
      topCitationId = null;
      topCitationTier = 0;
      topCitationScore = 0;
      debriefPhase = "inactive";
      debriefPhaseElapsedMs = 0;
      debriefVisibleRows = 0;
      debriefSnapshot = null;
      debriefPublishAccumulator = 0;
      setDebriefUI({ phase: "inactive", phaseElapsedMs: 0, visibleRows: 0, snapshot: null });
      resetWaveFlags();
      audioRef.current.stop();
      audioRef.current.setMode(toMenu ? "menu" : "playing");
      levelIdxRef.current = 0;
      setLevelIdx(0);
      queueWaveBanner(0);
      syncMetaNodeWorldPositions();
      const nextMode = toMenu ? "menu" : "playing";
      modeRef.current = nextMode;
      setMode(nextMode);
    };
    resetToMenuRef.current = () => resetRun(true);

    const respawnPendingPlayersAtWaveBoundary = () => {
      const pending = respawnPendingPlayers(playerSlots);
      if (pending.length <= 0) return;
      const gm = slidersRef.current.gravity;
      const v0 = Math.sqrt(gm / metaRadius) * T.ORBIT_GAIN;
      for (const slot of pending) {
        markPlayerRespawned(slot);
        if (slot.id === playerSlots[0]?.id) {
          applyLocalSlotSpawn(v0);
          player.angularVel = 0;
          player.thrust = 0;
          shipBrakeInput = 0;
          player.brakeAnim = 0;
          player.thrustGlow = 0;
          player.inActivatedSphere = false;
          player.fuel = T.FUEL_MAX;
          player.stuckTime = 0;
          player.hitsTaken = 0;
          player.hitInvuln = T.SHIP_HIT_IFRAME_SEC * 2;
          trail.length = 0;
        } else {
          const runtime = createRuntimeForSlot(slot, v0);
          runtime.hitInvuln = T.SHIP_HIT_IFRAME_SEC * 2;
          remotePlayerMirrors[slot.id] = runtime;
        }
        debugLog("player", "player-respawned", {
          playerId: slot.id,
          slot: slot.slot,
          reason: "wave-boundary",
          authorityTick: authorityClock.tick,
        });
      }
    };

    // helpers
    const gravityAt = (p: V2, gm: number) => {
      const toC = new V2(-p.x, -p.y);
      const d = Math.max(T.GRAVITY_SOFTEN, toC.len());
      return toC.norm().mul(gm / (d * d));
    };

    const activeMetaNodeGravityAt = (p: V2, gm: number) => {
      const acc = new V2(0, 0);
      const nodeGm = gm * T.META_ACTIVE_NODE_GRAVITY_MULT;
      if (nodeGm <= 0) return acc;
      for (const node of metaNodes) {
        if (node.kind === "center" || !node.awakened) continue;
        const nodePos = metaNodeWorld[node.index];
        if (!nodePos) continue;
        const toNode = nodePos.copy().sub(p);
        const d = Math.max(T.META_ACTIVE_NODE_GRAVITY_SOFTEN, toNode.len());
        let a = nodeGm / (d * d);
        if (T.META_ACTIVE_NODE_GRAVITY_MAX > 0) a = Math.min(a, T.META_ACTIVE_NODE_GRAVITY_MAX);
        if (toNode.len() > 0.0001) acc.add(toNode.norm().mul(a));
      }
      return acc;
    };

    const solarSailAt = (p: V2, shipAngle: number, solarPressure: number) => {
      // Light direction is radially outward from star → sail reacts by pushing (mostly) away from the star.
      const out = p.copy().norm();                // outward direction (from star)
      const fwd = V2.fromAngle(shipAngle, 1);     // ship "foil normal" proxy
      const cos = clamp(fwd.dot(out), -1, 1);

      // Base outward pressure: strongest when facing "into" the light (cos positive)
      const press = Math.max(0, cos);
      const d = Math.max(1, p.len());
      const k = solarPressure / (d * d);

      // Add a tangential component when angled (lets you "tack" like a sail)
      const tang = out.copy().rot(Math.PI / 2);
      const tangAmt = T.SOLAR_ANGLE_GAIN * press * Math.sign(fwd.dot(tang));

      return out.mul(k * press).add(tang.mul(k * tangAmt));
    };

    const makeBulletFromState = (
      burstId: number,
      ownerId: PlayerId,
      shipState: { pos: V2; vel: V2; angle: number },
      options: { clientShotId?: string; predicted?: boolean; id?: string } = {},
    ): Bullet => {
      const muzzle = V2.fromAngle(shipState.angle, 18);
      const pos = shipState.pos.copy().add(muzzle);
      const vel = V2.fromAngle(shipState.angle, T.BULLET_SPEED).add(shipState.vel.copy());
      const id = options.id ?? (options.predicted && options.clientShotId
        ? `predicted-${options.clientShotId}`
        : makeAuthorityEntityId("projectile", entityIdCounters, authorityClock.tick, ownerId));
      const bullet: Bullet = {
        id,
        ownerId,
        clientShotId: options.clientShotId,
        predicted: options.predicted,
        hostTick: authorityClock.tick,
        pos,
        prevPos: pos.copy(),
        vel,
        life: T.BULLET_LIFE,
        mass: T.BULLET_MASS,
        origin: pos.copy(),
        firedAtMs: runClockMs,
        burstId,
      };
      debugLog("projectile", "projectile-created", {
        id,
        ownerId,
        burstId,
        authorityTick: authorityClock.tick,
        x: pos.x,
        y: pos.y,
        vx: vel.x,
        vy: vel.y,
        mass: T.BULLET_MASS,
      });
      return bullet;
    };

    const makeBullet = (burstId: number, ownerId: PlayerId = playerSlots[0]?.id ?? LOCAL_SOLO_PLAYER_ID) => (
      makeBulletFromState(burstId, ownerId, { pos: player.pos, vel: player.vel, angle: player.angle })
    );

    const spawnEnemy = (kind: SolidKind, waveIdx: number, index: number, total: number) => {
      const baseAngle = rand(0, TAU);
      const spread = total <= 1 ? 0 : (index / total) * TAU;
      const a = baseAngle + spread;
      const rOrbit = rand(
        oortOuter * T.ENEMY_SPAWN_RADIUS_INNER_MULT,
        oortOuter * T.ENEMY_SPAWN_RADIUS_OUTER_MULT,
      );
      const pos = new V2(Math.cos(a) * rOrbit, Math.sin(a) * rOrbit);
      const speedScale = 1 + waveIdx * 0.03;
      const vel = V2.fromAngle(a + Math.PI / 2, rand(T.ENEMY_SPEED * 0.6, T.ENEMY_SPEED * 1.1) * speedScale);
      const r = rand(12, 22);
      return {
        id: `enemy-${nextEnemyId++}`,
        pos,
        vel,
        ax: rand(0, TAU),
        ay: rand(0, TAU),
        az: rand(0, TAU),
        r,
        hue: rand(170, 320),
        kind,
        mesh: makePolyhedron(kind, r),
        morphing: false,
        morph: 0,
        nextKind: null,
      } satisfies Enemy;
    };

    const startWave = (waveIdx: number) => {
      const lvl = getLevel(waveIdx);
      enemies.length = 0;
      resetWaveFlags();
      debugLog("wave", "wave-started", { waveIdx, wave: lvl.wave, enemyKind: lvl.enemyKind, enemyCount: lvl.enemyCount });
      for (let i = 0; i < lvl.enemyCount; i++) {
        enemies.push(spawnEnemy(lvl.enemyKind, waveIdx, i, lvl.enemyCount));
      }
      levelIdxRef.current = waveIdx;
      setLevelIdx(waveIdx);
      waveActive = true;
    };

    const getEnemyMorphScale = (e: Enemy) => {
      if (!e.morphing) return { y: 1, z: 1 };
      const squash = Math.sin(Math.PI * clamp(e.morph, 0, 1));
      return {
        y: 1 - 0.34 * squash,
        z: Math.max(0.08, 1 - 0.92 * squash),
      };
    };

    const getEnemyProjectedVerts = (e: Enemy) => {
      const out: { x: number; y: number }[] = [];
      const scale = getEnemyMorphScale(e);
      for (const v0 of e.mesh.verts) {
        let v = v0;
        v = rotX(v, e.ax); v = rotY(v, e.ay); v = rotZ(v, e.az);
        v = new V3(v.x, v.y * scale.y, v.z * scale.z);
        const p = project(v, 1, 4);
        out.push({ x: e.pos.x + p.x, y: e.pos.y + p.y });
      }
      return out;
    };

    const closestPointsOnSegments = (p1: V2, q1: V2, p2: V2, q2: V2) => {
      const u = q1.copy().sub(p1);
      const v = q2.copy().sub(p2);
      const w = p1.copy().sub(p2);
      const a = u.dot(u);
      const b = u.dot(v);
      const c = v.dot(v);
      const d = u.dot(w);
      const e = v.dot(w);
      const EPS = 1e-6;
      let sN: number, sD = a * c - b * b;
      let tN: number, tD = sD;

      if (sD < EPS) {
        sN = 0;
        sD = 1;
        tN = e;
        tD = c;
      } else {
        sN = b * e - c * d;
        tN = a * e - b * d;
        if (sN < 0) {
          sN = 0;
          tN = e;
          tD = c;
        } else if (sN > sD) {
          sN = sD;
          tN = e + b;
          tD = c;
        }
      }

      if (tN < 0) {
        tN = 0;
        if (-d < 0) sN = 0;
        else if (-d > a) sN = sD;
        else { sN = -d; sD = a; }
      } else if (tN > tD) {
        tN = tD;
        if (-d + b < 0) sN = 0;
        else if (-d + b > a) sN = sD;
        else { sN = -d + b; sD = a; }
      }

      const sc = Math.abs(sN) < EPS ? 0 : sN / sD;
      const tc = Math.abs(tN) < EPS ? 0 : tN / tD;
      const bulletPoint = p1.copy().add(u.mul(sc));
      const edgePoint = p2.copy().add(v.mul(tc));
      const d2 = bulletPoint.copy().sub(edgePoint).dot(bulletPoint.copy().sub(edgePoint));
      return { bulletPoint, edgePoint, d2 };
    };

    const findBulletEnemyImpact = (b: Bullet, e: Enemy): Impact | null => {
      const verts = getEnemyProjectedVerts(e);
      let best: Impact | null = null;
      const maxD2 = T.BULLET_RADIUS * T.BULLET_RADIUS;
      for (const [i, j] of e.mesh.edges) {
        const a = verts[i], c = verts[j];
        if (!a || !c) continue;
        const res = closestPointsOnSegments(b.prevPos, b.pos, new V2(a.x, a.y), new V2(c.x, c.y));
        if (res.d2 > maxD2) continue;
        if (!best || res.d2 < best.d2) {
          const edge = new V2(c.x - a.x, c.y - a.y).norm();
          const n1 = new V2(-edge.y, edge.x);
          const n2 = new V2(edge.y, -edge.x);
          const away = res.edgePoint.copy().sub(e.pos);
          best = {
            point: res.edgePoint,
            normal: (n1.dot(away) > 0 ? n1 : n2).norm(),
            edgeI: i,
            edgeJ: j,
            d2: res.d2,
          };
        }
      }
      return best;
    };

    const spawnShrapnel = (e: Enemy, impact: Impact) => {
      const verts = getEnemyProjectedVerts(e);
      const origin = impact.point.copy();

      let dir = impact.normal.copy();
      if (impact.edgeI >= 0) {
        const a = verts[impact.edgeI], b = verts[impact.edgeJ];
        if (a && b) {
          const edge = new V2(b.x - a.x, b.y - a.y).norm();
          dir = impact.normal.copy().add(edge.mul(0.35)).norm();
        }
      }

      const kindFactor: Record<SolidKind, number> = { tetra: 0.6, cube: 0.78, octa: 0.88, dodeca: 1.0, icosa: 1.12 };
      const N = Math.max(3, ((rand(T.SHRAPNEL_COUNT_MIN, T.SHRAPNEL_COUNT_MAX + 1) * kindFactor[e.kind]) | 0));
      const firstShardId = makeAuthorityEntityId("shrapnel", entityIdCounters, authorityClock.tick, e.id);
      debugLog("shrapnel", "shrapnel-spawned", {
        sourceEnemyId: e.id,
        sourceKind: e.kind,
        count: N,
        firstShardId,
        authorityTick: authorityClock.tick,
        x: origin.x,
        y: origin.y,
      });
      for (let k = 0; k < N; k++) {
        const jitter = rand(-Math.PI / 6, Math.PI / 6);
        const dj = dir.copy().rot(jitter).norm();
        const sp = rand(T.SHRAPNEL_SPEED_MIN, T.SHRAPNEL_SPEED_MAX);
        const v = dj.copy().mul(sp).add(e.vel.copy().mul(T.SHRAPNEL_PARENT_VEL));
        const life0 = rand(T.SHRAPNEL_LIFE_MIN, T.SHRAPNEL_LIFE_MAX);
        const id = k === 0 ? firstShardId : makeAuthorityEntityId("shrapnel", entityIdCounters, authorityClock.tick, e.id);
        shards.push({
          id,
          sourceEnemyId: e.id,
          hostTick: authorityClock.tick,
          pos: origin.copy().add(dj.copy().mul(rand(0.2, 2.4))),
          vel: v,
          life: life0,
          life0,
          hue: e.hue,
          size: rand(1.5, 3.4),
          ang: rand(0, TAU),
          spin: rand(-6, 6),
        });
      }
    };

    const downgradeEnemy = (e: Enemy) => {
      const next = DOWNGRADE[e.kind];
      if (!next) return false;
      e.morphing = true;
      e.morph = 0;
      e.nextKind = next;
      return true;
    };

    const buildDebriefSnapshot = (causeKey: DeathCauseKey): DebriefSnapshot => ({
      causeKey,
      causeLabel: deathCauseLabelFor(causeKey),
      score: Math.round(score),
      wave: getLevel(levelIdxRef.current).wave,
      survivalTimeSec: runClockMs / 1000,
      bestChain: bestChainMultiplier,
      citations: citationCount,
      spheresAwakened: runAwakenedCount,
      totalSpheresLit: metaNodes.filter((node) => node.kind !== "center" && node.awakened).length,
      topCitation: topCitationId ? (getCommendation(topCitationId)?.label ?? String(topCitationId).toUpperCase()) : "NONE LOGGED",
      bestShotDistance,
      peakPseudoG,
      furthestRadius,
    });

    const enterDebrief = (causeKey: DeathCauseKey, submitAuthoritativeScore = true) => {
      if (modeRef.current === "debrief") return;
      debriefSnapshot = buildDebriefSnapshot(causeKey);
      debugLog("lifecycle", "debrief-entered", {
        causeKey,
        score: debriefSnapshot.score,
        wave: debriefSnapshot.wave,
        survivalTimeSec: debriefSnapshot.survivalTimeSec,
      });
      if (submitAuthoritativeScore && authorityClock.mode !== "client-mirror") submitScoreRef.current(debriefSnapshot);
      debriefVisibleRows = 0;
      debriefPublishAccumulator = 0;
      modeRef.current = "debrief";
      setMode("debrief");
      setDebriefPhaseNow("burn_fade");
      publishTerminalAuthorityState?.(causeKey);
    };

    onDebriefAdvance = () => {
      if (!debriefSnapshot) {
        resetRun(true);
        return;
      }
      if (debriefPhase !== "ready") {
        setDebriefPhaseNow("ready");
        return;
      }
      resetRun(true);
    };

    const destroyPlayer = (slot: (typeof playerSlots)[number] | undefined, causeKey: DeathCauseKey = "enemy") => {
      if (!slot || slot.lifeState !== "alive") return false;
      const ship = shipForPlayerId(slot.id);
      markPlayerDestroyed(slot);
      clearPlayerTrail(slot.id);
      if (ship) {
        ship.thrust = 0;
        ship.brakeAnim = 0;
        ship.thrustGlow = 0;
        ship.inActivatedSphere = false;
      }
      if (slot.id === playerSlots[0]?.id) {
        shipBrakeInput = 0;
        gunCD = 0;
      } else {
        const runtime = remotePlayerMirrors[slot.id];
        if (runtime) {
          runtime.brakeInput = 0;
          runtime.gunCooldown = 0;
          runtime.pendingInputs.length = 0;
          runtime.currentInput = neutralControl(runtime.lastInputSeq);
        }
      }
      const allPlayersDown = shouldEndRunForPlayerLoss(playerSlots);
      debugWarn("player", "player-destroyed", {
        playerId: slot.id,
        slot: slot.slot,
        causeKey,
        wave: getLevel(levelIdxRef.current).wave,
        hitsTaken: ship?.hitsTaken,
        allPlayersDown,
        survivors: playerSlots.filter((candidate) => candidate.connected && candidate.lifeState === "alive").map((candidate) => candidate.id),
        authorityTick: authorityClock.tick,
      });
      audioRef.current.shipDestroyed();
      if (allPlayersDown) {
        enterDebrief(causeKey);
      } else {
        waveBannerText = `P${slot.slot + 1} SIGNAL LOST // RESPAWN NEXT WAVE`;
        waveBannerTimer = Math.max(waveBannerTimer, 2.4);
      }
      return true;
    };

    const loseRun = (reason: "ship" | "sol" = "ship", causeKey: DeathCauseKey = reason === "sol" ? "sol" : "enemy") => {
      if (reason === "sol") {
        debugWarn("wave", "sol-destroyed", { causeKey, wave: getLevel(levelIdxRef.current).wave, authorityTick: authorityClock.tick });
        audioRef.current.solDestroyed();
        enterDebrief(causeKey);
        return;
      }
      destroyPlayer(playerSlots[0], causeKey);
    };

    const killPlayer = (causeKey: DeathCauseKey = "enemy") => {
      loseRun("ship", causeKey);
    };

    const applyShipHitTo = (
      slot: (typeof playerSlots)[number] | undefined,
      ship: PlayerShipState | null,
      sourcePos?: V2,
      causeKey: DeathCauseKey = "enemy",
      damage = 1,
      knockback = T.SHIP_HIT_KNOCKBACK,
    ) => {
      if (!slot || !ship || slot.lifeState !== "alive" || ship.hitInvuln > 0) return false;
      const appliedDamage = Math.max(0, damage);
      ship.hitsTaken += appliedDamage;
      ship.hitInvuln = T.SHIP_HIT_IFRAME_SEC;
      waveDamageTaken += appliedDamage;
      debugWarn("collision", "player-hit", {
        playerId: slot.id,
        slot: slot.slot,
        causeKey,
        damage: appliedDamage,
        hitsTaken: ship.hitsTaken,
        resilience: T.SHIP_RESILIENCE,
        x: ship.pos.x,
        y: ship.pos.y,
        sourceX: sourcePos?.x,
        sourceY: sourcePos?.y,
        authorityTick: authorityClock.tick,
      });
      chainMultiplier = Math.max(1, chainMultiplier - SCORE_THRESHOLDS.chainDamagePenalty);
      if (sourcePos) {
        const away = ship.pos.copy().sub(sourcePos);
        if (away.len() > 0.0001) ship.vel.add(away.norm().mul(knockback));
      }
      if (causeKey === "oort") audioRef.current.oortStrike();
      else audioRef.current.hit();
      if (ship.hitsTaken >= T.SHIP_RESILIENCE) {
        destroyPlayer(slot, causeKey);
        return true;
      }
      return false;
    };

    const applyShipHit = (
      sourcePos?: V2,
      causeKey: DeathCauseKey = "enemy",
      damage = 1,
      knockback = T.SHIP_HIT_KNOCKBACK,
    ) => applyShipHitTo(playerSlots[0], player, sourcePos, causeKey, damage, knockback);

    const applyEnemyImpulse = (e: Enemy, impulseDir: V2, impulseMag: number, tangentialBias = 0) => {
      if (impulseMag <= 0) return;
      const dir = impulseDir.copy();
      if (dir.len() <= 0.0001) return;
      dir.norm();

      if (Math.abs(tangentialBias) > 0.0001) {
        const tang = dir.copy().rot(Math.PI / 2);
        const sign = e.vel.dot(tang) >= 0 ? 1 : -1;
        dir.add(tang.mul(tangentialBias * sign)).norm();
      }

      e.vel.add(dir.mul(impulseMag));
    };

    let score = 0;
    let chainMultiplier = 1;
    let bestChainMultiplier = 1;
    let citationCount = 0;
    let runClockMs = 0;
    let scoreIdleMs = 0;
    let lastScoreCategory: CitationCategory | null = null;
    let activeScoringAlert: ScoreAlert | null = null;
    const scoringAlertQueue: ScoreAlert[] = [];
    let lastShotAtMs = -Infinity;
    let currentBurstId = 0;
    const burstStats = new Map<number, BurstStats>();
    let waveDamageTaken = 0;
    let allSpheresLitAwarded = false;
    let slingshotArmed = false;
    let slingshotEntrySpeed = 0;
    let slingshotMinRadius = Infinity;
    let lastHighGAtMs = -Infinity;
    let runAwakenedCount = 0;
    let bestShotDistance = 0;
    let peakPseudoG = 0;
    let furthestRadius = metaRadius;
    let topCitationId: CommendationDefinition["id"] | null = null;
    let topCitationTier = 0;
    let topCitationScore = 0;
    let waveFlags: WaveCitationFlags = { oortReach: false, farOortReach: false, returnToTheBurn: false, periapsisKiss: false };
    let lastJoinRequestSentMs = -Infinity;
    let localJoinAccepted = transportLaunch.role !== "guest";

    const makePeerLifecycleMessage = (event: PeerLifecycleMessage["event"], playerId: PlayerId, slot = playerSlots[0]?.slot, reason?: string): PeerLifecycleMessage => ({
      type: "peer-lifecycle",
      protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
      event,
      playerId,
      slot,
      callsign: playerIdentityRef.current.callsign ?? null,
      reason,
      serverTimeMs: Date.now(),
    });

    const sendGuestJoinRequest = (force = false) => {
      if (transportLaunch.role !== "guest") return;
      if (!force && runClockMs - lastJoinRequestSentMs < 1000) return;
      lastJoinRequestSentMs = runClockMs;
      const localId = playerSlots[0]?.id ?? transportLaunch.localPlayerId;
      const message = makePeerLifecycleMessage("join-request", localId, transportLaunch.requestedSlot ?? playerSlots[0]?.slot);
      const sent = transport.sendLifecycleToHost(message);
      debugLog("network", "join-request-sent", {
        playerId: localId,
        requestedSlot: message.slot,
        sent,
        roomId: transportLaunch.roomId,
      }, "debug");
    };

    const resetWaveFlags = () => {
      waveFlags = { oortReach: false, farOortReach: false, returnToTheBurn: false, periapsisKiss: false };
      waveDamageTaken = 0;
      slingshotArmed = false;
      slingshotEntrySpeed = 0;
      slingshotMinRadius = Infinity;
    };

    // initial setup lands on the title / insert coin screen
    resetRun(true);
    sendGuestJoinRequest(true);
    syncMetaNodeWorldPositions();

    const getCommendation = (id: string) => commendationMapRef.current[id] ?? DEFAULT_COMMENDATIONS.find((item) => item.id === id);

    const enqueueAlert = (alert: ScoreAlert) => {
      scoringAlertQueue.push(alert);
    };

    const updateAlertQueue = (dt: number) => {
      if (activeScoringAlert) {
        activeScoringAlert.duration -= dt;
        if (activeScoringAlert.duration <= 0) activeScoringAlert = null;
      }
      if (!activeScoringAlert && scoringAlertQueue.length > 0) {
        activeScoringAlert = scoringAlertQueue.shift() ?? null;
      }
    };

    const advanceChain = (category: CitationCategory) => {
      const categoryBonus = lastScoreCategory && lastScoreCategory !== category ? SCORE_THRESHOLDS.chainCategoryBonus : 0;
      chainMultiplier = clamp(chainMultiplier + SCORE_THRESHOLDS.chainAddPerFeat + categoryBonus, 1, SCORE_THRESHOLDS.chainMax);
      bestChainMultiplier = Math.max(bestChainMultiplier, chainMultiplier);
      lastScoreCategory = category;
      scoreIdleMs = 0;
    };

    const awardPoints = (basePoints: number, category: CitationCategory, options?: {
      showAlert?: boolean;
      label?: string;
      subtitle?: string;
      severity?: HUDState["alert"]["severity"];
      flashing?: boolean;
      duration?: number;
      countsTowardChain?: boolean;
    }) => {
      if (basePoints <= 0) return 0;
      const usedChain = chainMultiplier;
      const awarded = Math.round(basePoints * usedChain);
      score += awarded;
      if (options?.countsTowardChain !== false) advanceChain(category);
      if (options?.showAlert && options.label) {
        enqueueAlert({
          text: `${options.label} +${awarded.toLocaleString()}`,
          subtitle: options.subtitle,
          severity: options.severity ?? "info",
          flashing: options.flashing,
          duration: options.duration ?? 1.85,
        });
      }
      return awarded;
    };

    const awardCitation = (id: CommendationDefinition["id"], category: CitationCategory) => {
      const def = getCommendation(id);
      const citationScore = scoreForCitation(id);
      citationCount += 1;
      const tier = def?.tier ?? 1;
      if (
        !topCitationId ||
        tier > topCitationTier ||
        (tier === topCitationTier && citationScore >= topCitationScore)
      ) {
        topCitationId = id;
        topCitationTier = tier;
        topCitationScore = citationScore;
      }
      return awardPoints(citationScore, category, {
        showAlert: true,
        label: def?.label ?? String(id).toUpperCase(),
        subtitle: def?.subtitle,
        severity: def ? scoreAlertSeverity(def.tier) : "warning",
        flashing: def?.tier === 3,
        duration: def?.tier === 3 ? 2.6 : 1.9,
      });
    };

    const resolveBurst = (burstId: number, wasHit: boolean) => {
      const stats = burstStats.get(burstId);
      if (!stats) return;
      if (wasHit) stats.hits += 1;
      stats.active = Math.max(0, stats.active - 1);
      if (stats.active > 0) return;
      if (!stats.awardedFull && stats.shots >= 3 && stats.hits === stats.shots) {
        stats.awardedFull = true;
        awardCitation("fullSalvo", "gunnery");
      } else if (!stats.awardedSalvo && stats.hits >= 3) {
        stats.awardedSalvo = true;
        awardCitation("salvoConnect", "gunnery");
      }
      burstStats.delete(burstId);
    };

    const beginShotBurstIfNeeded = () => {
      if (runClockMs - lastShotAtMs > SCORE_THRESHOLDS.salvoWindowMs) {
        currentBurstId += 1;
        burstStats.set(currentBurstId, { shots: 0, hits: 0, active: 0, startedAtMs: runClockMs, awardedSalvo: false, awardedFull: false });
      }
      lastShotAtMs = runClockMs;
      return currentBurstId;
    };

    const awardEnemyShellHit = (kind: SolidKind, pos: V2, extra = 0) => {
      const key = kind === "tetra" ? "tetrahedron" : kind === "cube" ? "cube" : kind === "octa" ? "octahedron" : kind === "dodeca" ? "dodecahedron" : "icosahedron";
      const nearSolBonus = pos.len() < horizonR * 1.1 ? 150 : 0;
      return awardPoints(scoreForEnemy(key) + nearSolBonus + extra, "destruction", { countsTowardChain: true });
    };

    const activatedSphereMediumAt = (point: V2) => {
      let depth = 0;
      let nodeIndex = -1;
      let nodeKind: MetaNodeKind | null = null;
      let overcharged = false;

      for (const node of metaNodes) {
        if (node.kind === "center" || !node.awakened) continue;
        const nodePos = metaNodeWorld[node.index];
        if (!nodePos) continue;
        const d = point.copy().sub(nodePos).len();
        if (d > T.META_CIRCLE_RADIUS) continue;
        const localDepth = 1 - d / Math.max(1, T.META_CIRCLE_RADIUS);
        if (localDepth > depth) {
          depth = localDepth;
          nodeIndex = node.index;
          nodeKind = node.kind;
          overcharged = node.overcharged;
        }
      }

      return { inside: depth > 0, depth, nodeIndex, nodeKind, overcharged };
    };

    const applyActivatedSphereMediumDrag = (vel: V2, point: V2, dt: number, dragPerSecond: number) => {
      if (dragPerSecond <= 0) return 0;
      const medium = activatedSphereMediumAt(point);
      if (!medium.inside) return 0;
      const factor = Math.exp(-dragPerSecond * medium.depth * dt);
      vel.mul(clamp(factor, 0, 1));
      return medium.depth;
    };

    const getMetaNodeBonuses = (point: V2 = player.pos) => {
      let passiveFuel = 0;
      let sphereFuel = 0;
      let shieldRepair = 0;
      let occupiedNode = -1;
      let insideAwakenedSphere = false;
      let mediumDepth = 0;

      for (const node of metaNodes) {
        if (node.kind === "center") continue;
        const nodePos = metaNodeWorld[node.index];
        if (!nodePos) continue;
        const d = point.copy().sub(nodePos).len();
        if (d > T.META_CIRCLE_RADIUS) continue;

        occupiedNode = node.index;
        const passive = node.kind === "outer" ? T.META_NODE_FUEL_OUTER : T.META_NODE_FUEL_INNER;
        passiveFuel = Math.max(passiveFuel, passive);

        if (node.awakened) {
          insideAwakenedSphere = true;
          mediumDepth = Math.max(mediumDepth, 1 - d / Math.max(1, T.META_CIRCLE_RADIUS));
          const sphereFuelRate = node.kind === "outer" ? T.META_SPHERE_FUEL_OUTER : T.META_SPHERE_FUEL_INNER;
          const shieldRateBase = node.kind === "outer" ? T.META_SPHERE_SHIELD_REGEN_OUTER : T.META_SPHERE_SHIELD_REGEN;
          sphereFuel = Math.max(sphereFuel, sphereFuelRate);
          shieldRepair = Math.max(shieldRepair, node.overcharged ? shieldRateBase * 1.35 : shieldRateBase);
        }
      }

      return { passiveFuel, sphereFuel, shieldRepair, occupiedNode, insideAwakenedSphere, mediumDepth };
    };

    const settleFuelBitsFromShards = (dt: number) => {
      // If a shard reaches the Oort band and slows, it can become a fuel bit that persists longer.
      for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        const r = s.pos.len();
        const v = s.vel.len();
        if (r > oortInner && r < oortOuter && v < 180 && s.life < 0.8) {
          const tang = s.pos.copy().norm().rot(Math.PI / 2);
          const vel = tang.mul(rand(35, 85)); // gentle drift around the ring
          fuelBits.push({ pos: s.pos.copy(), vel, life: rand(9, 18), hue: s.hue });
          debugLog("shrapnel", "shrapnel-destroyed", {
            id: s.id,
            sourceEnemyId: s.sourceEnemyId,
            reason: "settled-to-fuel",
            authorityTick: authorityClock.tick,
          }, "debug");
          shards.splice(i, 1);
        }
      }
    };

    const collectFuelBits = () => {
      const activeShips = allAuthoritativeShips();
      for (let i = fuelBits.length - 1; i >= 0; i--) {
        const b = fuelBits[i];
        const collector = activeShips.find(({ ship }) => b.pos.copy().sub(ship.pos).len() < 18);
        if (!collector) continue;
        collector.ship.fuel = clamp(collector.ship.fuel + T.FUEL_PICKUP_AMOUNT, 0, T.FUEL_MAX);
        audioRef.current.blip(520 + rand(-50, 50), 0.06, 0.12);
        fuelBits.splice(i, 1);
      }
    };

    const oortDustDensityAt = (p: V2, timeSec: number) => {
      const r = p.len();
      const inner = oortOuter * T.OORT_CONSTELLATION_INNER_MULT * 0.86;
      const outer = oortOuter * T.OORT_CONSTELLATION_OUTER_MULT * 1.04;
      const radial = smoothstep(inner, inner + oortOuter * 0.22, r) * (1 - smoothstep(outer * 0.82, outer, r));
      if (radial <= 0) return 0;
      const a = Math.atan2(p.y, p.x);
      const filament = 0.5 + 0.5 * Math.sin(a * 7 + timeSec * 0.17 + Math.sin(r * 0.018));
      const glitter = 0.5 + 0.5 * Math.sin(a * 17 - timeSec * 0.11 + r * 0.041);
      return clamp(radial * (0.34 + 0.46 * filament + 0.20 * glitter), 0, 1);
    };

    const oortMediumDepthAt = (p: V2, timeSec: number) => {
      if (!T.OORT_CONSTELLATIONS_ENABLED) return 0;
      return smoothstep(0.05, 0.55, oortDustDensityAt(p, timeSec));
    };

    const applyOortPassiveDragTo = (ship: PlayerShipState, dt: number, timeSec: number) => {
      if (!T.OORT_CONSTELLATIONS_ENABLED || T.OORT_PASSIVE_DRAG <= 0) return 0;
      const depth = oortMediumDepthAt(ship.pos, timeSec);
      if (depth <= 0) return 0;
      ship.vel.mul(clamp(Math.exp(-T.OORT_PASSIVE_DRAG * depth * dt), 0, 1));
      return depth;
    };

    const applyOortPassiveDrag = (dt: number, timeSec: number) => applyOortPassiveDragTo(player, dt, timeSec);

    const applyOortInwardPressureTo = (ship: PlayerShipState, dt: number) => {
      if (!T.OORT_INWARD_PRESSURE_ENABLED || T.OORT_INWARD_PRESSURE_ACCEL <= 0) return 0;
      const r = ship.pos.len();
      const startR = oortOuter * T.OORT_INWARD_PRESSURE_START_MULT;
      const fullR = oortOuter * T.OORT_INWARD_PRESSURE_FULL_MULT;
      if (r <= startR) return 0;
      const inward = ship.pos.copy().mul(-1);
      if (inward.len() <= 0.0001) return 0;
      const pressure = smoothstep(startR, fullR, r) * T.OORT_INWARD_PRESSURE_ACCEL;
      ship.vel.add(inward.norm().mul(pressure * dt));
      return pressure;
    };

    const applyOortInwardPressure = (dt: number) => applyOortInwardPressureTo(player, dt);

    const applyOortCollisionRecoveryTo = (ship: PlayerShipState) => {
      if (T.OORT_COLLISION_SPEED_DAMPING > 0) ship.vel.mul(clamp(T.OORT_COLLISION_SPEED_DAMPING, 0, 1));
      const bias = clamp(T.OORT_COLLISION_INWARD_BIAS, 0, 1);
      if (bias <= 0) return;
      const speed = ship.vel.len();
      const inward = ship.pos.copy().mul(-1);
      if (speed <= 0.0001 || inward.len() <= 0.0001) return;
      const biased = ship.vel.copy().norm().mul(1 - bias).add(inward.norm().mul(bias));
      if (biased.len() <= 0.0001) return;
      const next = biased.norm().mul(speed);
      ship.vel.x = next.x;
      ship.vel.y = next.y;
    };

    const applyOortAmbientAbrasionTo = (
      slot: (typeof playerSlots)[number],
      ship: PlayerShipState,
      dt: number,
      timeSec: number,
      primary = false,
    ) => {
      if (!T.OORT_CONSTELLATIONS_ENABLED || T.OORT_DUST_DAMAGE_PER_SECOND <= 0) {
        if (primary) audioRef.current.setOortDust(0);
        return false;
      }
      const density = oortDustDensityAt(ship.pos, timeSec);
      if (density <= 0.015) {
        if (primary) audioRef.current.setOortDust(0);
        return false;
      }
      const speedFactor = 0.38 + ship.vel.len() * T.OORT_DUST_SPEED_SCALE;
      const damage = density * T.OORT_DUST_DAMAGE_PER_SECOND * speedFactor * dt;
      if (damage <= 0) {
        if (primary) audioRef.current.setOortDust(0);
        return false;
      }
      if (primary) audioRef.current.setOortDust(clamp(density * speedFactor * 0.85, 0, 1));
      ship.hitsTaken += damage;
      waveDamageTaken += damage;
      if (ship.hitsTaken >= T.SHIP_RESILIENCE) {
        destroyPlayer(slot, "oort");
        return true;
      }
      return false;
    };

    const applyOortPlayerHazardsTo = (
      slot: (typeof playerSlots)[number],
      ship: PlayerShipState,
      dt: number,
      previousPos: V2,
      primary = false,
    ) => {
      if (!T.OORT_CONSTELLATIONS_ENABLED) return false;
      const timeSec = metaPulseClock;
      if (applyOortAmbientAbrasionTo(slot, ship, dt, timeSec, primary)) return true;
      if (ship.hitInvuln > 0) return false;
      const speed = ship.vel.len();
      const lineHitR = T.SHIP_HIT_RADIUS + T.OORT_LINE_HIT_RADIUS;
      const nodeHitR = T.SHIP_HIT_RADIUS + T.OORT_NODE_HIT_RADIUS;
      for (const c of oortClusters) {
        if (c.brokenUntil > timeSec) continue;
        const center = oortClusterCenter(c, timeSec);
        const coarse = center.copy().sub(ship.pos).len();
        if (coarse > T.OORT_HAZARD_WAKE_RADIUS + c.glyphRadius + T.SHIP_HIT_RADIUS) continue;
        const pts = oortClusterNodes(c, timeSec);
        let struck = pts.some((point) => pointSegmentDistanceSq(point, previousPos, ship.pos) <= nodeHitR * nodeHitR);
        if (!struck) {
          for (const [ai, bi] of oortClusterLinks(c)) {
            const a = pts[ai];
            const b = pts[bi];
            if (!a || !b) continue;
            if (closestPointsOnSegments(previousPos, ship.pos, a, b).d2 <= lineHitR * lineHitR) {
              struck = true;
              break;
            }
          }
        }
        if (!struck) continue;
        c.pulseUntil = timeSec + 0.72;
        const damage = (T.OORT_COLLISION_BASE_DAMAGE + speed * T.OORT_COLLISION_SPEED_DAMAGE) * c.hazard;
        const died = applyShipHitTo(slot, ship, center, "oort", damage, T.OORT_COLLISION_KNOCKBACK);
        if (!died) applyOortCollisionRecoveryTo(ship);
        return died;
      }
      return false;
    };

    const applyOortPlayerHazards = (dt: number, previousPos: V2) => {
      const slot = playerSlots[0];
      return slot ? applyOortPlayerHazardsTo(slot, player, dt, previousPos, true) : false;
    };

    const breakOortCluster = (c: OortCluster, timeSec: number) => {
      c.brokenUntil = timeSec + T.OORT_REFORM_SECONDS;
      c.pulseUntil = timeSec + 0.62;
      audioRef.current.oortBreak();
    };

    const handleOortProjectileHits = () => {
      if (!T.OORT_CONSTELLATIONS_ENABLED || bullets.length === 0 || oortClusters.length === 0) return;
      const timeSec = metaPulseClock;
      const hitR = T.OORT_SHOT_BREAK_RADIUS + T.BULLET_RADIUS;
      for (let bi = bullets.length - 1; bi >= 0; bi--) {
        const b = bullets[bi];
        let cleared = false;
        for (const c of oortClusters) {
          if (c.brokenUntil > timeSec) continue;
          const center = oortClusterCenter(c, timeSec);
          if (pointSegmentDistanceSq(center, b.prevPos, b.pos) > Math.pow(T.OORT_HAZARD_WAKE_RADIUS + c.glyphRadius, 2)) continue;
          const pts = oortClusterNodes(c, timeSec);

          for (const p of pts) {
            if (pointSegmentDistanceSq(p, b.prevPos, b.pos) <= hitR * hitR) {
              cleared = true;
              break;
            }
          }
          if (!cleared) {
            for (const [ai, ci] of oortClusterLinks(c)) {
              const a = pts[ai];
              const d = pts[ci];
              if (!a || !d) continue;
              const res = closestPointsOnSegments(b.prevPos, b.pos, a, d);
              if (res.d2 <= hitR * hitR) {
                cleared = true;
                break;
              }
            }
          }

          if (cleared) {
            breakOortCluster(c, timeSec);
            debugLog("projectile", "projectile-destroyed", {
              id: b.id,
              ownerId: b.ownerId,
              reason: "oort-impact",
              authorityTick: authorityClock.tick,
            }, "debug");
            resolveBurst(b.burstId, false);
            bullets.splice(bi, 1);
            break;
          }
        }
      }
    };

    const simulatePlayerShip = (
      ship: PlayerShipState,
      control: Pick<PlayerControlState, "rotate" | "thrust" | "brake">,
      dt: number,
      currentBrakeInput: number,
    ) => {
      const lvl = getLevel(levelIdxRef.current);
      const thrustForce = slidersRef.current.thrust;
      const solar = slidersRef.current.solar;
      ship.hitInvuln = Math.max(0, ship.hitInvuln - dt);

      const turnInput = clamp(control.rotate, -1, 1);
      if (T.SHIP_ROTATIONAL_INERTIA_ENABLED) {
        ship.angularVel = clamp(
          ship.angularVel + turnInput * T.SHIP_ANGULAR_ACCEL * dt,
          -T.SHIP_MAX_ANGULAR_SPEED,
          T.SHIP_MAX_ANGULAR_SPEED,
        );
        if (Math.abs(turnInput) < 0.001 && T.SHIP_ANGULAR_DAMPING > 0) ship.angularVel *= Math.exp(-T.SHIP_ANGULAR_DAMPING * dt);
        ship.angle += ship.angularVel * dt;
      } else {
        ship.angularVel = 0;
        ship.angle += turnInput * T.ROT_SPEED * dt;
      }

      const thrustIntent = clamp(control.thrust, 0, 1);
      const brakeIntent = clamp(control.brake, 0, 1);
      ship.thrust = lerp(ship.thrust, thrustIntent, thrustIntent > 0 ? 0.16 : 0.10);
      const nextBrakeInput = lerp(currentBrakeInput, brakeIntent, brakeIntent > 0 ? 0.18 : 0.12);

      const dist = ship.pos.len();
      const outside = dist > horizonR;
      const use = Math.max(0, ship.thrust);
      if (use > 0.03 && ship.fuel > 0) ship.fuel = Math.max(0, ship.fuel - T.FUEL_BURN * use * dt);

      const nodeBonuses = getMetaNodeBonuses(ship.pos);
      ship.inActivatedSphere = nodeBonuses.insideAwakenedSphere;
      const baseFuelRegen = outside ? T.FUEL_REGEN_OUTER : T.FUEL_REGEN_INNER;
      const totalFuelRegen = baseFuelRegen + nodeBonuses.passiveFuel + nodeBonuses.sphereFuel;
      if (totalFuelRegen > 0) ship.fuel = Math.min(T.FUEL_MAX, ship.fuel + totalFuelRegen * dt);
      if (nodeBonuses.shieldRepair > 0 && ship.hitInvuln <= 0) ship.hitsTaken = Math.max(0, ship.hitsTaken - nodeBonuses.shieldRepair * dt);

      const velBefore = ship.vel.copy();
      const g = gravityAt(ship.pos, lvl.gravityGM);
      const nodeG = T.META_NODE_GRAVITY_AFFECTS_PLAYER ? activeMetaNodeGravityAt(ship.pos, lvl.gravityGM) : new V2(0, 0);
      const sail = solarSailAt(ship.pos, ship.angle, lvl.solarPressure * (solar / T.SOLAR_PRESSURE));
      const fwd = V2.fromAngle(ship.angle, 1);
      const engine = fwd.copy().mul((ship.fuel > 0 ? 1 : 0) * Math.max(0, ship.thrust) * thrustForce);
      ship.vel.add(g.mul(dt));
      ship.vel.add(nodeG.mul(dt));
      ship.vel.add(sail.mul(dt / T.SHIP_MASS));
      ship.vel.add(engine.mul(dt / T.SHIP_MASS));

      const brake = clamp(nextBrakeInput, 0, 1);
      const oortBrakeMedium = T.OORT_ALLOWS_BRAKING ? T.OORT_BRAKE_MULTIPLIER * oortMediumDepthAt(ship.pos, metaPulseClock) : 0;
      const brakeMedium = T.BRAKING_REQUIRES_ACTIVATED_SPHERE
        ? (nodeBonuses.insideAwakenedSphere ? 1 : Math.max(T.OPEN_SPACE_BRAKE_MULTIPLIER, oortBrakeMedium))
        : 1;
      const effectiveBrake = brake * brakeMedium;
      ship.brakeAnim = lerp(ship.brakeAnim, effectiveBrake, effectiveBrake > 0 ? 0.22 : 0.11);
      ship.thrustGlow = lerp(ship.thrustGlow, (ship.fuel > 0 ? 1 : 0) * Math.max(0, ship.thrust), ship.thrust > 0 ? 0.18 : 0.10);
      if (effectiveBrake > 0.001) ship.vel.mul(lerp(1, T.BRAKE_COEFF, effectiveBrake));
      if (nodeBonuses.mediumDepth > 0 && T.META_SPHERE_PLAYER_MEDIUM_DRAG > 0) {
        const mediumDrag = Math.exp(-T.META_SPHERE_PLAYER_MEDIUM_DRAG * nodeBonuses.mediumDepth * dt);
        ship.vel.mul(clamp(mediumDrag, 0, 1));
      }
      applyOortPassiveDragTo(ship, dt, metaPulseClock);
      applyOortInwardPressureTo(ship, dt);
      if (T.DRAG > 0) ship.vel.mul(1 - T.DRAG * dt);
      const speed = ship.vel.len();
      if (speed > T.MAX_SPEED) ship.vel.mul(T.MAX_SPEED / speed);
      const previousPosition = ship.pos.copy();
      ship.pos.add(ship.vel.copy().mul(dt));
      return { brakeInput: nextBrakeInput, previousPosition, velBefore };
    };

    const simulateSecondaryAuthoritativePlayers = (dt: number) => {
      if (authorityClock.mode === "client-mirror") return false;
      const descriptors = getConnectedGamepadDescriptors();
      const solCrashR = Math.max(1, T.STAR_COLLISION_RADIUS + T.SHIP_HIT_RADIUS * 0.25);
      for (const slot of playerSlots) {
        if (slot.id === playerSlots[0]?.id || !slot.connected || slot.lifeState !== "alive") continue;
        const runtime = remotePlayerMirrors[slot.id];
        if (!runtime) continue;

        let control = runtime.currentInput;
        if (runtime.local) {
          const descriptor = descriptors[slot.slot];
          runtime.localGamepadIndex = descriptor?.index ?? runtime.localGamepadIndex;
          const pad = runtime.localGamepadIndex === null ? null : readGamepadShipInputForIndex(runtime.localGamepadIndex, dt);
          const seq = nextInputSequence(authorityClock, slot.id);
          control = {
            rotate: pad?.rotate ?? 0,
            thrust: pad?.thrust ?? 0,
            brake: pad?.brake ?? 0,
            fireHeld: pad?.fire ?? false,
            firePressed: pad?.firePressed ?? false,
            clientShotId: (pad?.fire ?? false) && runtime.gunCooldown <= 0 ? `${slot.id}-${seq}` : undefined,
            seq,
            clientTick: authorityClock.tick,
            simulationDtMs: dt * 1000,
            clientTimeMs: Date.now(),
          };
          markInputSequenceApplied(authorityClock, slot.id, seq);
        } else if (runtime.pendingInputs.length > 0) {
          control = runtime.pendingInputs.shift() ?? runtime.currentInput;
          markInputSequenceApplied(authorityClock, slot.id, control.seq);
          ackClientTimeMsByPlayer[slot.id] = control.clientTimeMs;
        } else {
          control = { ...runtime.currentInput, firePressed: false, clientShotId: undefined };
        }
        runtime.currentInput = control;
        runtime.lastInputSeq = control.seq;
        slot.lastInputSeq = control.seq;

        const result = simulatePlayerShip(runtime, control, dt, runtime.brakeInput);
        runtime.brakeInput = result.brakeInput;
        runtime.gunCooldown = Math.max(0, runtime.gunCooldown - dt);
        if ((control.firePressed || control.fireHeld) && runtime.gunCooldown <= 0) {
          const burstId = beginShotBurstIfNeeded();
          const stats = burstStats.get(burstId);
          if (stats) { stats.shots += 1; stats.active += 1; }
          bullets.push(makeBulletFromState(burstId, slot.id, runtime, { clientShotId: control.clientShotId }));
          runtime.gunCooldown = T.FIRE_RATE;
          audioRef.current.shoot();
        }
        runtime.currentInput = { ...control, firePressed: false, clientShotId: undefined };
        samplePlayerTrail(runtime.trail, runtime.pos);

        if (pointSegmentDistanceSq(new V2(0, 0), result.previousPosition, runtime.pos) <= solCrashR * solCrashR) {
          destroyPlayer(slot, "sol");
          if (modeRef.current === "debrief") return true;
          continue;
        }
        if (applyOortPlayerHazardsTo(slot, runtime, dt, result.previousPosition, false)) {
          if (modeRef.current === "debrief") return true;
          continue;
        }
        const dStar = runtime.pos.len();
        if (dStar < T.STAR_TRAP_RADIUS && runtime.vel.len() < 120) {
          runtime.stuckTime += dt;
          if (runtime.stuckTime >= T.STAR_TRAP_TIME) {
            destroyPlayer(slot, runtime.fuel <= 0 ? "fuel" : "well");
            if (modeRef.current === "debrief") return true;
          }
        } else runtime.stuckTime = 0;
      }
      return false;
    };

    const buildAuthoritySnapshot = (): NetWorldSnapshot => {
      const players = playerSlots.map((slot) => {
        const ship = shipForPlayerId(slot.id);
        const runtime = remotePlayerMirrors[slot.id];
        return {
          id: slot.id,
          slot: slot.slot,
          callsign: slot.callsign ?? null,
          alive: slot.lifeState === "alive",
          respawnPending: slot.lifeState === "respawn-pending",
          x: ship?.pos.x ?? 0,
          y: ship?.pos.y ?? 0,
          vx: ship?.vel.x ?? 0,
          vy: ship?.vel.y ?? 0,
          angle: ship?.angle ?? 0,
          angularVelocity: ship?.angularVel ?? 0,
          fuel: ship?.fuel ?? 0,
          hitsTaken: ship?.hitsTaken ?? 0,
          thrust: ship?.thrust ?? 0,
          brake: slot.id === playerSlots[0]?.id ? shipBrakeInput : (runtime?.brakeInput ?? 0),
          lastInputSeq: slot.lastInputSeq,
        };
      });

      return {
        type: "world-snapshot",
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        authorityRole: authorityClock.mode === "solo-authority" ? "solo" : authorityClock.mode === "host" ? "host" : "guest",
        runState: modeRef.current === "debrief" ? "debrief" : "playing",
        gameOverCause: debriefSnapshot?.causeKey,
        tick: authorityClock.tick,
        serverTimeMs: Date.now(),
        players,
        enemies: enemies.map((e) => ({
          id: e.id,
          kind: e.kind,
          x: e.pos.x,
          y: e.pos.y,
          vx: e.vel.x,
          vy: e.vel.y,
          morphing: e.morphing,
          nextKind: e.nextKind,
        })),
        projectiles: bullets
          .filter((b) => !b.predicted)
          .map((b) => ({
            id: b.id,
            ownerId: b.ownerId,
            clientShotId: b.clientShotId,
            hostTick: b.hostTick,
            x: b.pos.x,
            y: b.pos.y,
            vx: b.vel.x,
            vy: b.vel.y,
            ageMs: Math.max(0, runClockMs - b.firedAtMs),
            kind: "blaster",
          })),
        shrapnel: shards.map((fragment) => ({
          id: fragment.id,
          sourceEnemyId: fragment.sourceEnemyId,
          hostTick: fragment.hostTick,
          x: fragment.pos.x,
          y: fragment.pos.y,
          vx: fragment.vel.x,
          vy: fragment.vel.y,
          lifeMs: Math.max(0, fragment.life * 1000),
          size: fragment.size,
          hue: fragment.hue,
        })),
        wave: getLevel(levelIdxRef.current).wave,
        score: Math.round(score),
        solIntegrity: 1,
        ackInputSeqByPlayer: ackInputSeqByPlayer(authorityClock),
        ackClientTimeMsByPlayer: { ...ackClientTimeMsByPlayer },
      };
    };

    publishTerminalAuthorityState = (causeKey: DeathCauseKey) => {
      if (authorityClock.mode !== "host") return;
      const snapshot = buildAuthoritySnapshot();
      const snapshotSent = transport.broadcastFromHost(snapshot);
      const eventSent = transport.broadcastFromHost({
        type: "world-event",
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        tick: authorityClock.tick,
        serverTimeMs: Date.now(),
        event: "run-ended",
        data: {
          causeKey,
          score: debriefSnapshot?.score ?? Math.round(score),
          wave: debriefSnapshot?.wave ?? getLevel(levelIdxRef.current).wave,
          survivalTimeSec: debriefSnapshot?.survivalTimeSec ?? runClockMs / 1000,
        },
      });
      debugLog("network", "terminal-state-broadcast", {
        causeKey,
        snapshotSent,
        eventSent,
        authorityTick: authorityClock.tick,
      });
    };

    const ensureRemoteSlot = (playerId: PlayerId, callsign?: string | null, preferredSlot?: number | null) => {
      let slot = playerSlots.find((candidate) => candidate.id === playerId) ?? null;
      if (slot) {
        slot.connected = true;
        if (callsign !== undefined) slot.callsign = callsign;
        seedRemoteMirrorSpawn(slot);
        return slot;
      }
      const safePreferredSlot = preferredSlot === 0 || preferredSlot === 1 || preferredSlot === 2 || preferredSlot === 3
        ? preferredSlot
        : null;
      slot = assignPlayerSlot(playerSlots, playerId, "guest", callsign, safePreferredSlot);
      if (!slot) {
        debugWarn("network", "join-denied-no-slot", { playerId, preferredSlot, maxPlayers: MULTIPLAYER_NET_CONFIG.maxPlayers });
        return null;
      }
      seedRemoteMirrorSpawn(slot);
      debugLog("network", "remote-player-slot-assigned", { playerId, slot: slot.slot, preferredSlot, players: playerSlotSummary(playerSlots) });
      return slot;
    };

    const toControlState = (frame: NetInputFramePayload): PlayerControlState => ({
      rotate: clamp(frame.rotate, -1, 1),
      thrust: clamp(frame.thrust, 0, 1),
      brake: clamp(frame.brake, 0, 1),
      fireHeld: Boolean(frame.fireHeld),
      firePressed: Boolean(frame.firePressed),
      clientShotId: frame.clientShotId,
      seq: frame.seq,
      clientTick: frame.clientTick,
      simulationDtMs: clamp(frame.simulationDtMs || T.FIXED_DT * 1000, 1, 50),
      clientTimeMs: frame.clientTimeMs,
    });

    const enqueueRemoteInput = (input: NetInputMessage) => {
      const slot = ensureRemoteSlot(input.playerId);
      if (!slot) return 0;
      const runtime = remotePlayerMirrors[input.playerId];
      if (!runtime) return 0;
      const frames = [...(input.recentInputs ?? []), input]
        .sort((a, b) => a.seq - b.seq)
        .filter((frame, index, all) => index === 0 || all[index - 1].seq !== frame.seq);
      let accepted = 0;
      for (const frame of frames) {
        const framedMessage = { playerId: input.playerId, seq: frame.seq };
        if (!acceptInputSequence(authorityClock, framedMessage)) continue;
        runtime.pendingInputs.push(toControlState(frame));
        accepted += 1;
      }
      if (runtime.pendingInputs.length > MULTIPLAYER_NET_CONFIG.maxPendingPredictedInputs) {
        runtime.pendingInputs.splice(0, runtime.pendingInputs.length - MULTIPLAYER_NET_CONFIG.maxPendingPredictedInputs);
      }
      return accepted;
    };

    const reconcileLocalPlayerFromSnapshot = (snapshot: NetWorldSnapshot, localNetPlayer: NetPlayerState, inbound: InboundTransportMessage) => {
      localJoinAccepted = true;
      const localPlayerId = playerSlots[0]?.id ?? LOCAL_SOLO_PLAYER_ID;
      const previousDisplayed = {
        x: player.pos.x + localRenderCorrection.x,
        y: player.pos.y + localRenderCorrection.y,
        angle: player.angle + localRenderCorrection.angle,
      };
      player.pos = new V2(localNetPlayer.x, localNetPlayer.y);
      player.vel = new V2(localNetPlayer.vx, localNetPlayer.vy);
      player.angle = localNetPlayer.angle;
      player.angularVel = localNetPlayer.angularVelocity;
      player.fuel = localNetPlayer.fuel;
      player.hitsTaken = localNetPlayer.hitsTaken;
      player.thrust = localNetPlayer.thrust ?? player.thrust;
      shipBrakeInput = localNetPlayer.brake ?? shipBrakeInput;

      const ackSeq = snapshot.ackInputSeqByPlayer[localPlayerId] ?? localNetPlayer.lastInputSeq ?? 0;
      acknowledgePredictedInputs(guestPredictionQueue, ackSeq);
      let replayed = 0;
      for (const pending of guestPredictionQueue.items) {
        const simulated = simulatePlayerShip(player, pending, pending.simulationDtMs / 1000, shipBrakeInput);
        shipBrakeInput = simulated.brakeInput;
        replayed += 1;
      }

      const correctionDistance = Math.hypot(previousDisplayed.x - player.pos.x, previousDisplayed.y - player.pos.y);
      const angularCorrection = Math.abs(shortestAngleDelta(player.angle, previousDisplayed.angle));
      if (correctionDistance >= MULTIPLAYER_NET_CONFIG.correctionSnapDistance || angularCorrection >= MULTIPLAYER_NET_CONFIG.correctionSnapAngleRad) {
        localRenderCorrection.x = 0;
        localRenderCorrection.y = 0;
        localRenderCorrection.angle = 0;
      } else {
        addRenderCorrection(localRenderCorrection, previousDisplayed, { x: player.pos.x, y: player.pos.y, angle: player.angle });
      }
      displayedLocalPlayer = previousDisplayed;
      const ackClientTimeMs = snapshot.ackClientTimeMsByPlayer?.[localPlayerId] ?? 0;
      guestSnapshotTimeline.updateMetrics({
        lastAckSeq: ackSeq,
        pendingInputs: guestPredictionQueue.items.length,
        replayedInputs: replayed,
        correctionDistance,
        angularCorrection,
        snapshotAgeMs: Math.max(0, Date.now() - snapshot.serverTimeMs),
      });
      if (correctionDistance > MULTIPLAYER_NET_CONFIG.largeCorrectionWarnDistance) {
        debugWarn("snapshot", "large-player-correction", {
          playerId: localPlayerId,
          correction: correctionDistance,
          angularCorrection,
          tick: snapshot.tick,
          via: inbound.via,
          replayed,
          ackSeq,
          pendingInputs: guestPredictionQueue.items.length,
          roundTripMs: ackClientTimeMs > 0 ? Date.now() - ackClientTimeMs : undefined,
        });
      }
    };

    const applyAuthoritySnapshot = (snapshot: NetWorldSnapshot, inbound: InboundTransportMessage) => {
      if (!acceptWorldSnapshot(authorityClock, snapshot)) return;
      if (!guestSnapshotTimeline.push(snapshot, inbound.receivedAtMs)) return;
      const localPlayerId = playerSlots[0]?.id ?? LOCAL_SOLO_PLAYER_ID;
      const localNetPlayer = snapshot.players.find((candidate) => candidate.id === localPlayerId);
      if (localNetPlayer) reconcileLocalPlayerFromSnapshot(snapshot, localNetPlayer, inbound);

      for (const netPlayer of snapshot.players) {
        const existing = playerSlots.find((slot) => slot.id === netPlayer.id)
          ?? assignNextPlayerSlot(playerSlots, netPlayer.id, netPlayer.id === localPlayerId ? transportLaunch.role : "guest", netPlayer.callsign ?? null);
        if (!existing) continue;
        existing.slot = netPlayer.slot;
        existing.connected = true;
        existing.lifeState = netPlayer.alive ? "alive" : netPlayer.respawnPending ? "respawn-pending" : "dead";
        existing.lastInputSeq = netPlayer.lastInputSeq;
        existing.callsign = netPlayer.callsign ?? existing.callsign;
        if (netPlayer.id !== localPlayerId) seedRemoteMirrorSpawn(existing);
      }

      score = snapshot.score;
      const nextLevelIdx = Math.max(0, snapshot.wave - 1);
      if (nextLevelIdx !== levelIdxRef.current) {
        levelIdxRef.current = nextLevelIdx;
        setLevelIdx(nextLevelIdx);
      }
      if (snapshot.runState === "debrief") {
        const cause = deathCauseKeyFromUnknown(snapshot.gameOverCause);
        enterDebrief(cause, false);
      }
      debugLog("snapshot", "snapshot-buffered", {
        tick: snapshot.tick,
        via: inbound.via,
        players: snapshot.players.length,
        enemies: snapshot.enemies.length,
        projectiles: snapshot.projectiles.length,
        shrapnel: snapshot.shrapnel.length,
        metrics: guestSnapshotTimeline.getMetrics(),
      }, "debug");
    };

    const interpolateNetPlayer = (older: NetPlayerState | undefined, newer: NetPlayerState, alpha: number) => ({
      x: older ? lerpNumber(older.x, newer.x, alpha) : newer.x,
      y: older ? lerpNumber(older.y, newer.y, alpha) : newer.y,
      vx: older ? lerpNumber(older.vx, newer.vx, alpha) : newer.vx,
      vy: older ? lerpNumber(older.vy, newer.vy, alpha) : newer.vy,
      angle: older ? lerpAngle(older.angle, newer.angle, alpha) : newer.angle,
      angularVelocity: older ? lerpNumber(older.angularVelocity, newer.angularVelocity, alpha) : newer.angularVelocity,
      fuel: older ? lerpNumber(older.fuel, newer.fuel, Math.min(1, alpha)) : newer.fuel,
      hitsTaken: older ? lerpNumber(older.hitsTaken, newer.hitsTaken, Math.min(1, alpha)) : newer.hitsTaken,
      thrust: newer.thrust ?? 0,
      brake: newer.brake ?? 0,
    });

    const applyInterpolatedSnapshotPresentation = () => {
      const sample = guestSnapshotTimeline.sample(Date.now(), MULTIPLAYER_NET_CONFIG.interpolationDelayMs);
      if (!sample) return;
      const { older, newer, alpha } = sample;
      const localPlayerId = playerSlots[0]?.id ?? LOCAL_SOLO_PLAYER_ID;
      const olderPlayers = new Map(older.players.map((entry) => [entry.id, entry]));
      for (const netPlayer of newer.players) {
        if (netPlayer.id === localPlayerId) continue;
        const slot = playerSlots.find((candidate) => candidate.id === netPlayer.id)
          ?? assignNextPlayerSlot(playerSlots, netPlayer.id, "guest", netPlayer.callsign ?? null);
        if (!slot) continue;
        slot.slot = netPlayer.slot;
        slot.connected = true;
        slot.lifeState = netPlayer.alive ? "alive" : netPlayer.respawnPending ? "respawn-pending" : "dead";
        seedRemoteMirrorSpawn(slot);
        const runtime = remotePlayerMirrors[netPlayer.id];
        if (!runtime) continue;
        const state = interpolateNetPlayer(olderPlayers.get(netPlayer.id), netPlayer, alpha);
        runtime.pos.x = state.x;
        runtime.pos.y = state.y;
        runtime.vel.x = state.vx;
        runtime.vel.y = state.vy;
        runtime.angle = state.angle;
        runtime.angularVel = state.angularVelocity;
        runtime.fuel = state.fuel;
        runtime.hitsTaken = state.hitsTaken;
        runtime.thrust = state.thrust;
        runtime.thrustGlow = lerp(runtime.thrustGlow, clamp(state.thrust, 0, 1), 0.22);
        runtime.brakeInput = state.brake;
        runtime.displayedX = state.x;
        runtime.displayedY = state.y;
        runtime.displayedAngle = state.angle;
        runtime.lastInputSeq = netPlayer.lastInputSeq;
        if (slot.lifeState === "alive") samplePlayerTrail(runtime.trail, runtime.pos);
        else runtime.trail.length = 0;
      }

      const olderEnemies = new Map(older.enemies.map((entry) => [entry.id, entry]));
      const liveEnemyIds = new Set(newer.enemies.map((entry) => entry.id));
      for (let index = enemies.length - 1; index >= 0; index -= 1) if (!liveEnemyIds.has(enemies[index].id)) enemies.splice(index, 1);
      for (const netEnemy of newer.enemies) {
        const prior = olderEnemies.get(netEnemy.id);
        let enemy = enemies.find((candidate) => candidate.id === netEnemy.id);
        if (!enemy) {
          enemy = {
            id: netEnemy.id,
            pos: new V2(netEnemy.x, netEnemy.y),
            vel: new V2(netEnemy.vx, netEnemy.vy),
            ax: 0,
            ay: 0,
            az: 0,
            r: 16,
            hue: 210,
            kind: netEnemy.kind,
            mesh: makePolyhedron(netEnemy.kind, 16),
            morphing: netEnemy.morphing,
            morph: netEnemy.morphing ? 0.5 : 0,
            nextKind: netEnemy.nextKind,
          };
          enemies.push(enemy);
        }
        enemy.pos.x = prior ? lerpNumber(prior.x, netEnemy.x, alpha) : netEnemy.x;
        enemy.pos.y = prior ? lerpNumber(prior.y, netEnemy.y, alpha) : netEnemy.y;
        enemy.vel.x = prior ? lerpNumber(prior.vx, netEnemy.vx, alpha) : netEnemy.vx;
        enemy.vel.y = prior ? lerpNumber(prior.vy, netEnemy.vy, alpha) : netEnemy.vy;
        if (enemy.kind !== netEnemy.kind) {
          enemy.kind = netEnemy.kind;
          enemy.mesh = makePolyhedron(netEnemy.kind, enemy.r);
        }
        enemy.morphing = netEnemy.morphing;
        enemy.nextKind = netEnemy.nextKind;
      }

      const olderProjectiles = new Map(older.projectiles.map((entry) => [entry.id, entry]));
      const authoritativeIds = new Set<string>();
      for (const projectile of newer.projectiles) {
        authoritativeIds.add(projectile.id);
        const prior = olderProjectiles.get(projectile.id);
        let bullet = bullets.find((candidate) => candidate.id === projectile.id);
        if (!bullet && projectile.clientShotId) bullet = bullets.find((candidate) => candidate.predicted && candidate.clientShotId === projectile.clientShotId);
        const x = prior ? lerpNumber(prior.x, projectile.x, alpha) : projectile.x;
        const y = prior ? lerpNumber(prior.y, projectile.y, alpha) : projectile.y;
        const vx = prior ? lerpNumber(prior.vx, projectile.vx, alpha) : projectile.vx;
        const vy = prior ? lerpNumber(prior.vy, projectile.vy, alpha) : projectile.vy;
        if (!bullet) {
          const pos = new V2(x, y);
          bullet = {
            id: projectile.id,
            ownerId: projectile.ownerId,
            clientShotId: projectile.clientShotId,
            hostTick: projectile.hostTick ?? newer.tick,
            pos,
            prevPos: pos.copy(),
            vel: new V2(vx, vy),
            life: Math.max(0.02, T.BULLET_LIFE - projectile.ageMs / 1000),
            mass: T.BULLET_MASS,
            origin: pos.copy(),
            firedAtMs: runClockMs - projectile.ageMs,
            burstId: 0,
          };
          bullets.push(bullet);
        } else {
          bullet.id = projectile.id;
          bullet.predicted = false;
          bullet.clientShotId = projectile.clientShotId ?? bullet.clientShotId;
          bullet.prevPos = bullet.pos.copy();
          bullet.pos.x = x;
          bullet.pos.y = y;
          bullet.vel.x = vx;
          bullet.vel.y = vy;
          bullet.life = Math.max(0.02, T.BULLET_LIFE - projectile.ageMs / 1000);
        }
      }
      for (let index = bullets.length - 1; index >= 0; index -= 1) {
        const bullet = bullets[index];
        if (bullet.predicted && runClockMs - bullet.firedAtMs < 900) continue;
        if (!authoritativeIds.has(bullet.id)) bullets.splice(index, 1);
      }

      const olderFragments = new Map(older.shrapnel.map((entry) => [entry.id, entry]));
      const fragmentIds = new Set(newer.shrapnel.map((entry) => entry.id));
      for (let index = shards.length - 1; index >= 0; index -= 1) if (!fragmentIds.has(shards[index].id)) shards.splice(index, 1);
      for (const fragment of newer.shrapnel) {
        const prior = olderFragments.get(fragment.id);
        let shard = shards.find((candidate) => candidate.id === fragment.id);
        const life = Math.max(0.02, fragment.lifeMs / 1000);
        if (!shard) {
          shard = {
            id: fragment.id,
            sourceEnemyId: fragment.sourceEnemyId,
            hostTick: fragment.hostTick ?? newer.tick,
            pos: new V2(fragment.x, fragment.y),
            vel: new V2(fragment.vx, fragment.vy),
            life,
            life0: life,
            hue: fragment.hue ?? 210,
            size: fragment.size,
            ang: 0,
            spin: 0,
          };
          shards.push(shard);
        }
        shard.pos.x = prior ? lerpNumber(prior.x, fragment.x, alpha) : fragment.x;
        shard.pos.y = prior ? lerpNumber(prior.y, fragment.y, alpha) : fragment.y;
        shard.vel.x = prior ? lerpNumber(prior.vx, fragment.vx, alpha) : fragment.vx;
        shard.vel.y = prior ? lerpNumber(prior.vy, fragment.vy, alpha) : fragment.vy;
        shard.life = life;
      }
    };

    const handlePeerLifecycleMessage = (message: PeerLifecycleMessage, inbound: InboundTransportMessage) => {
      const messagePlayerId = message.playerId ?? inbound.fromPlayerId;
      if (!messagePlayerId) return;

      if (authorityClock.mode === "host") {
        if (message.event === "join-request") {
          const slot = ensureRemoteSlot(messagePlayerId, message.callsign ?? null, message.slot ?? null);
          if (!slot) {
            transport.sendLifecycleToPeer(messagePlayerId, makePeerLifecycleMessage("join-denied", messagePlayerId, undefined, "room-full"));
            return;
          }
          const accepted = makePeerLifecycleMessage("join-accepted", messagePlayerId, slot.slot);
          const sent = transport.sendLifecycleToPeer(messagePlayerId, accepted);
          debugLog("network", "join-accepted", {
            playerId: messagePlayerId,
            slot: slot.slot,
            requestedSlot: message.slot,
            sent,
            via: inbound.via,
            players: playerSlotSummary(playerSlots),
          });
          return;
        }
        if (message.event === "peer-left") {
          const slot = playerSlots.find((candidate) => candidate.id === messagePlayerId);
          if (slot) {
            slot.connected = false;
            slot.lifeState = "disconnected";
            debugWarn("network", "peer-left", { playerId: messagePlayerId, slot: slot.slot, via: inbound.via });
          }
          return;
        }
      }

      if (authorityClock.mode === "client-mirror") {
        const localId = playerSlots[0]?.id ?? transportLaunch.localPlayerId;
        if (messagePlayerId !== localId) return;
        if (message.event === "join-accepted") {
          localJoinAccepted = true;
          if (playerSlots[0] && message.slot !== undefined) playerSlots[0].slot = message.slot;
          debugLog("network", "join-accepted-received", {
            playerId: localId,
            slot: message.slot,
            via: inbound.via,
            roomId: transportLaunch.roomId,
          });
          return;
        }
        if (message.event === "join-denied") {
          debugWarn("network", "join-denied-received", {
            playerId: localId,
            reason: message.reason,
            via: inbound.via,
            roomId: transportLaunch.roomId,
          });
        }
      }
    };

    const handleInboundTransportMessages = () => {
      const inbound = transport.drainInboundMessages();
      if (inbound.length <= 0) return;
      for (const item of inbound) {
        const message = item.message;
        if (isPeerLifecycleMessage(message)) {
          handlePeerLifecycleMessage(message, item);
          continue;
        }
        if (isPlayerInputMessage(message)) {
          if (authorityClock.mode !== "host") continue;
          if (item.fromPlayerId !== message.playerId) {
            debugWarn("network", "input-owner-mismatch", { fromPlayerId: item.fromPlayerId, claimedPlayerId: message.playerId, via: item.via });
            continue;
          }
          const slot = ensureRemoteSlot(message.playerId);
          if (!slot) continue;
          const acceptedFrames = enqueueRemoteInput(message);
          if (acceptedFrames <= 0) continue;
          debugLog("input", "remote-input-queued", {
            playerId: message.playerId,
            seq: message.seq,
            acceptedFrames,
            rotate: message.rotate,
            thrust: message.thrust,
            brake: message.brake,
            firePressed: message.firePressed,
            via: item.via,
            authorityTick: authorityClock.tick,
          }, "debug");
          continue;
        }
        if (isWorldEventMessage(message)) {
          if (authorityClock.mode === "client-mirror" && message.event === "run-ended") {
            const eventScore = message.data?.score;
            const eventWave = message.data?.wave;
            const eventSurvivalTimeSec = message.data?.survivalTimeSec;
            if (typeof eventScore === "number" && Number.isFinite(eventScore)) score = eventScore;
            if (typeof eventSurvivalTimeSec === "number" && Number.isFinite(eventSurvivalTimeSec)) runClockMs = eventSurvivalTimeSec * 1000;
            if (typeof eventWave === "number" && Number.isFinite(eventWave)) {
              const nextLevelIdx = Math.max(0, Math.floor(eventWave) - 1);
              levelIdxRef.current = nextLevelIdx;
              setLevelIdx(nextLevelIdx);
            }
            enterDebrief(deathCauseKeyFromUnknown(message.data?.causeKey), false);
          }
          continue;
        }
        if (isWorldSnapshotMessage(message)) {
          if (authorityClock.mode === "client-mirror") applyAuthoritySnapshot(message, item);
          continue;
        }
      }
    };

    const publishAuthoritySnapshotIfDue = (dt: number) => {
      const shouldPublish = shouldPublishSnapshot(authorityClock, dt, MULTIPLAYER_NET_CONFIG.snapshotHz);
      const shouldHeartbeat = shouldLogSnapshotHeartbeat(authorityClock, dt);
      if (!shouldPublish && !shouldHeartbeat) return;
      const snapshot = buildAuthoritySnapshot();
      if (shouldHeartbeat) logSnapshotHeartbeat(snapshot, authorityClock.mode);
      if (shouldPublish && authorityClock.mode === "host") {
        const sent = transport.broadcastFromHost(snapshot);
        if (sent > 0 && shouldHeartbeat) {
          debugLog("network", "snapshot-broadcast", { tick: snapshot.tick, sent, peers: transport.getState().peers.length }, "debug");
        }
      }
    };

    // =============== fixed timestep loop ===============
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const step = (dt: number) => {
      const lvl = getLevel(levelIdxRef.current);
      const gm = slidersRef.current.gravity;
      const thrust = slidersRef.current.thrust;
      const solar = slidersRef.current.solar;
      const connectedPads = getConnectedGamepadDescriptors();
      const primaryPadIndex = transportLaunch.localPlayerCount > 1 ? (connectedPads[0]?.index ?? null) : null;
      const gamepadInput = primaryPadIndex === null
        ? readGamepadShipInput(dt)
        : readGamepadShipInputForIndex(primaryPadIndex, dt);
      const gamepadActive = gamepadInput.connected && (
        Math.abs(gamepadInput.rotate) > 0.08 ||
        gamepadInput.thrust > 0.05 ||
        gamepadInput.brake > 0.05 ||
        gamepadInput.firePressed ||
        gamepadInput.pausePressed
      );
      if (gamepadActive) audioRef.current.init();

      runClockMs += dt * 1000;
      scoreIdleMs += dt * 1000;
      handleInboundTransportMessages();
      if (!localJoinAccepted) sendGuestJoinRequest(false);
      if (scoreIdleMs >= SCORE_THRESHOLDS.chainDecayMs) {
        chainMultiplier = 1;
        lastScoreCategory = null;
      }
      updateAlertQueue(dt);

      metaPulseClock += dt;
      syncMetaNodeWorldPositions();

      // handle pause/menu/debrief/transition
      if (modeRef.current === "debrief") {
        if (gamepadInput.firePressed || gamepadInput.pausePressed) {
          onDebriefAdvance?.();
        }
        debriefPhaseElapsedMs += dt * 1000;
        debriefPublishAccumulator += dt * 1000;
        if (debriefPhase === "burn_fade" && debriefPhaseElapsedMs >= DEBRIEF_SEQUENCE.burnFadeMs) {
          setDebriefPhaseNow("game_over_hold");
        } else if (debriefPhase === "game_over_hold" && debriefPhaseElapsedMs >= DEBRIEF_SEQUENCE.gameOverHoldMs) {
          setDebriefPhaseNow("plotting");
        } else if (debriefPhase === "plotting") {
          debriefVisibleRows = Math.min(
            getDebriefRowTotal(debriefSnapshot),
            Math.floor(debriefPhaseElapsedMs / DEBRIEF_SEQUENCE.rowRevealMs),
          );
          if (
            debriefVisibleRows >= getDebriefRowTotal(debriefSnapshot) &&
            debriefPhaseElapsedMs >= getDebriefRowTotal(debriefSnapshot) * DEBRIEF_SEQUENCE.rowRevealMs + DEBRIEF_SEQUENCE.readyPromptDelayMs
          ) {
            setDebriefPhaseNow("ready");
          }
        } else if (debriefPhase === "ready" && debriefPhaseElapsedMs >= DEBRIEF_SEQUENCE.autoReturnMs) {
          resetRun(true);
          return;
        }
        if (debriefPublishAccumulator >= 90) {
          debriefPublishAccumulator = 0;
          publishDebriefUI();
        }
        audioRef.current.updateDrones("debrief", enemies, player, T.STAR_RADIUS, oortOuter);
        audioRef.current.setThrust(0);
        return;
      }
      if (gamepadInput.pausePressed) {
        setMode((m) => {
          const next = m === "playing" ? "paused" : ((m === "menu" || m === "paused") ? "playing" : m);
          modeRef.current = next;
          return next;
        });
      }

      if (modeRef.current !== "playing") {
        // still animate metatron slowly for menu vibes
        const dist = player.pos.len();
        const spin = (T.META_BASE_SPIN + T.META_SPIN_GAIN * (dist / Math.max(1, metaRadius))) * 0.15;
        metaAz += spin * dt;
        metaAx += spin * 0.6 * dt;
        metaAy += spin * 0.4 * dt;
        updateMetaAlignment(dt);
        syncMetaNodeWorldPositions();
        audioRef.current.updateDrones(modeRef.current as GameMode, enemies, player, T.STAR_RADIUS, oortOuter);
        audioRef.current.setThrust(0);
        return;
      }

      advanceAuthorityTick(authorityClock);

      for (const node of metaNodes) {
        if (node.awakened) {
          node.charge = T.META_NODE_MAX_CHARGE_SEC;
        }
      }

      // ---- local ship input + prediction ----
      const primaryAlive = playerSlots[0]?.lifeState === "alive";
      const turnLeft = primaryAlive && (keys.has("a") || keys.has("A") || keys.has("ArrowLeft"));
      const turnRight = primaryAlive && (keys.has("d") || keys.has("D") || keys.has("ArrowRight"));
      const keyboardTurnInput = (turnRight ? 1 : 0) - (turnLeft ? 1 : 0);
      const turnInput = keyboardTurnInput !== 0 ? keyboardTurnInput : gamepadInput.rotate;
      const keyboardThrustInput = primaryAlive && (keys.has("w") || keys.has("W") || keys.has("ArrowUp")) ? 1 : 0;
      const keyboardBrakeInput = primaryAlive && (keys.has("s") || keys.has("S") || keys.has("ArrowDown")) ? 1 : 0;
      const thrustIntent = primaryAlive ? Math.max(keyboardThrustInput, gamepadInput.thrust) : 0;
      const brakeIntent = primaryAlive ? Math.max(keyboardBrakeInput, gamepadInput.brake) : 0;
      const fireHeld = primaryAlive && (keys.has(" ") || keys.has("Space") || gamepadInput.fire);
      const localPlayerId = playerSlots[0]?.id ?? LOCAL_SOLO_PLAYER_ID;
      lastLocalInputSeq = nextInputSequence(authorityClock, localPlayerId);
      localClientTick += 1;
      const willFireThisTick = fireHeld && gunCD <= 0;
      const clientShotId = willFireThisTick ? `${localPlayerId}-${lastLocalInputSeq}` : undefined;
      const localInputMessage: NetInputMessage = {
        type: "player-input",
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        playerId: localPlayerId,
        seq: lastLocalInputSeq,
        clientTick: localClientTick,
        clientTimeMs: Date.now(),
        simulationDtMs: dt * 1000,
        rotate: turnInput,
        thrust: thrustIntent,
        brake: brakeIntent,
        fireHeld,
        firePressed: willFireThisTick,
        clientShotId,
        x: player.pos.x,
        y: player.pos.y,
        vx: player.vel.x,
        vy: player.vel.y,
        angle: player.angle,
        angularVelocity: player.angularVel,
      };
      if (authorityClock.mode === "client-mirror") {
        queuePredictedInput(guestPredictionQueue, localInputMessage);
        localInputMessage.recentInputs = recentInputsForRedundancy(guestPredictionQueue, localInputMessage);
        const sent = transport.sendToHost(localInputMessage);
        if (sent > 0 && lastLocalInputSeq % MULTIPLAYER_NET_CONFIG.hostSimulationHz === 0) {
          debugLog("network", "input-sent-to-host", { playerId: localPlayerId, seq: lastLocalInputSeq, sent }, "debug");
        }
      } else {
        markInputSequenceApplied(authorityClock, localPlayerId, lastLocalInputSeq);
        ackClientTimeMsByPlayer[localPlayerId] = localInputMessage.clientTimeMs;
      }
      if (playerSlots[0]) playerSlots[0].lastInputSeq = lastLocalInputSeq;
      if (lastLocalInputSeq % MULTIPLAYER_NET_CONFIG.hostSimulationHz === 0 && (Math.abs(turnInput) > 0.01 || thrustIntent > 0.01 || brakeIntent > 0.01 || fireHeld)) {
        debugLog("input", "local-input-heartbeat", {
          playerId: localInputMessage.playerId,
          seq: localInputMessage.seq,
          rotate: localInputMessage.rotate,
          thrust: localInputMessage.thrust,
          brake: localInputMessage.brake,
          fireHeld: localInputMessage.fireHeld,
          authorityTick: authorityClock.tick,
        }, "debug");
      }

      const localSim = primaryAlive
        ? simulatePlayerShip(player, toControlState(localInputMessage), dt, shipBrakeInput)
        : { brakeInput: 0, previousPosition: player.pos.copy(), velBefore: player.vel.copy() };
      shipBrakeInput = localSim.brakeInput;
      if (!primaryAlive) {
        player.thrust = 0;
        player.thrustGlow = 0;
        player.brakeAnim = 0;
      }
      const playerPrevPos = localSim.previousPosition;
      const velBefore = localSim.velBefore;
      decayRenderCorrection(localRenderCorrection, dt);
      displayedLocalPlayer = {
        x: player.pos.x + localRenderCorrection.x,
        y: player.pos.y + localRenderCorrection.y,
        angle: player.angle + localRenderCorrection.angle,
      };
      if (authorityClock.mode !== "client-mirror") {
      const solCrashR = Math.max(1, T.STAR_COLLISION_RADIUS + T.SHIP_HIT_RADIUS * 0.25);
      if (pointSegmentDistanceSq(new V2(0, 0), playerPrevPos, player.pos) <= solCrashR * solCrashR) {
        loseRun("ship", "sol");
        return;
      }
      if (applyOortPlayerHazards(dt, playerPrevPos)) return;

      const accel = player.vel.copy().sub(velBefore).mul(1 / Math.max(dt, 1e-6));
      const speedNow = player.vel.len();
      furthestRadius = Math.max(furthestRadius, player.pos.len());
      if (!waveFlags.oortReach && player.pos.len() >= SCORE_THRESHOLDS.oortReachRadius) {
        waveFlags.oortReach = true;
        awardCitation("oortReach", "pilotage");
      }
      if (!waveFlags.returnToTheBurn && waveFlags.oortReach && player.pos.len() >= SCORE_THRESHOLDS.returnToBurnOuterRadius) {
        waveFlags.returnToTheBurn = true;
      }
      if (waveFlags.returnToTheBurn && player.pos.len() <= SCORE_THRESHOLDS.returnToBurnInnerRadius && speedNow > 280) {
        waveFlags.returnToTheBurn = false;
        awardCitation("returnToTheBurn", "pilotage");
      }
      if (!waveFlags.periapsisKiss && player.pos.len() <= T.STAR_TRAP_RADIUS * 1.55 && speedNow > 220) {
        waveFlags.periapsisKiss = true;
        awardCitation("periapsisKiss", "pilotage");
      }
      if (!slingshotArmed && player.pos.len() <= horizonR * 1.05) {
        slingshotArmed = true;
        slingshotEntrySpeed = speedNow;
        slingshotMinRadius = player.pos.len();
      } else if (slingshotArmed) {
        slingshotMinRadius = Math.min(slingshotMinRadius, player.pos.len());
        if (player.pos.len() >= horizonR * 1.25) {
          if (slingshotMinRadius <= horizonR * 0.9 && speedNow >= slingshotEntrySpeed * 1.18) {
            awardCitation("slingshot", "pilotage");
          }
          slingshotArmed = false;
          slingshotMinRadius = Infinity;
        }
      }
      if (speedNow > 120) {
        const vhat = player.vel.copy().mul(1 / speedNow);
        const lateral = accel.copy().sub(vhat.copy().mul(accel.dot(vhat)));
        const pseudoG = lateral.len() / 250;
        peakPseudoG = Math.max(peakPseudoG, pseudoG);
        if (pseudoG >= SCORE_THRESHOLDS.highGTurn && runClockMs - lastHighGAtMs > 4500 && (enemies.length > 0 || player.pos.len() < horizonR * 1.2)) {
          awardCitation(pseudoG >= SCORE_THRESHOLDS.extremeGTurn ? "extremeGTurn" : "highGTurn", "pilotage");
          lastHighGAtMs = runClockMs;
        }
      }

      // "stuck in well" explosion check
      const dStar = player.pos.len();
      if (dStar < T.STAR_TRAP_RADIUS && player.vel.len() < 120) {
        player.stuckTime += dt;
        if (player.stuckTime >= T.STAR_TRAP_TIME) {
          loseRun("ship", player.fuel <= 0 ? "fuel" : "well");
          return;
        }
      } else {
        player.stuckTime = 0;
      }

      }

      // ---- gun ----
      gunCD = Math.max(0, gunCD - dt);
      if (willFireThisTick) {
        const burstId = beginShotBurstIfNeeded();
        const stats = burstStats.get(burstId);
        if (stats) {
          stats.shots += 1;
          stats.active += 1;
        }
        bullets.push(makeBulletFromState(burstId, localPlayerId, player, {
          clientShotId,
          predicted: authorityClock.mode === "client-mirror",
        }));
        audioRef.current.shoot();
        gunCD = T.FIRE_RATE;
      }

      if (simulateSecondaryAuthoritativePlayers(dt)) return;

      if (authorityClock.mode !== "client-mirror") {
      // bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.prevPos = b.pos.copy();
        if (b.mass > 0) {
          b.vel.add(gravityAt(b.pos, lvl.gravityGM * b.mass).mul(dt));
          if (T.META_NODE_GRAVITY_AFFECTS_BULLETS) b.vel.add(activeMetaNodeGravityAt(b.pos, lvl.gravityGM * b.mass).mul(dt));
        }
        b.pos.add(b.vel.copy().mul(dt));
        b.life -= dt;
        if (b.life <= 0 || Math.abs(b.pos.x) > oortOuter * 3 || Math.abs(b.pos.y) > oortOuter * 3) {
          debugLog("projectile", "projectile-destroyed", {
            id: b.id,
            ownerId: b.ownerId,
            reason: b.life <= 0 ? "expired" : "out-of-bounds",
            authorityTick: authorityClock.tick,
          }, "debug");
          resolveBurst(b.burstId, false);
          bullets.splice(i, 1);
        }
      }

      handleOortProjectileHits();

      if (waveBannerTimer > 0) {
        waveBannerTimer = Math.max(0, waveBannerTimer - dt);
        if (waveBannerTimer <= 0) {
          startWave(pendingWaveIdx);
        }
      }

      // enemies update + AI
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];

        const toStar = e.pos.copy().mul(-1);
        const starDist = Math.max(1, toStar.len());
        const starDir = toStar.copy().mul(1 / starDist);
        const starTang = starDir.copy().rot(Math.PI / 2);

        const targetEntry = allAuthoritativeShips().reduce<ReturnType<typeof allAuthoritativeShips>[number] | null>((best, entry) => {
          if (!best) return entry;
          return entry.ship.pos.copy().sub(e.pos).len() < best.ship.pos.copy().sub(e.pos).len() ? entry : best;
        }, null);
        const toShip = (targetEntry?.ship.pos ?? player.pos).copy().sub(e.pos);
        const shipDist = Math.max(1, toShip.len());
        const shipDir = toShip.copy().mul(1 / shipDist);

        // primary behavior: fall toward Sol in a spiraling path, with only a slight bias toward the ship
        const spiralSign = Math.sin(e.ax + e.ay) >= 0 ? 1 : -1;
        const inward = starDir.copy().mul(T.ENEMY_STEER * (1 - T.ENEMY_ORBIT_BIAS));
        const orbit = starTang.mul(spiralSign * T.ENEMY_STEER * T.ENEMY_ORBIT_BIAS);
        const shipBias = shipDir.mul(T.ENEMY_STEER * T.ENEMY_PLAYER_BIAS);
        e.vel.add(inward.mul(dt));
        e.vel.add(orbit.mul(dt * (0.7 + 0.3 * Math.cos(e.az))));
        e.vel.add(shipBias.mul(dt));

        // stellar gravity keeps them diving inward instead of simply crossing the centerline ballistically
        e.vel.add(gravityAt(e.pos, lvl.gravityGM * T.ENEMY_GRAVITY_MULT).mul(dt));
        if (T.META_NODE_GRAVITY_AFFECTS_ENEMIES) {
          e.vel.add(activeMetaNodeGravityAt(e.pos, lvl.gravityGM * T.ENEMY_GRAVITY_MULT).mul(dt));
        }

        applyActivatedSphereMediumDrag(e.vel, e.pos, dt, T.META_SPHERE_ENEMY_MEDIUM_DRAG);

        e.vel.mul(0.999);
        e.pos.add(e.vel.copy().mul(dt));

        // rotation
        e.ax += 0.75 * dt; e.ay += 0.55 * dt; e.az += 0.42 * dt;

        if (e.morphing) {
          e.morph += T.ENEMY_COLLAPSE_RATE * dt;
          if (e.nextKind && e.morph >= 0.5) {
            e.kind = e.nextKind;
            e.mesh = makePolyhedron(e.kind, e.r);
            e.nextKind = null;
          }
          if (e.morph >= 1) {
            e.morph = 0;
            e.morphing = false;
          }
        }

        const enemyHitR = Math.max(8, e.r * T.ENEMY_HIT_RADIUS_MULT);
        const impactedPlayer = allAuthoritativeShips().find(({ ship }) => ship.pos.copy().sub(e.pos).len() <= T.SHIP_HIT_RADIUS + enemyHitR);
        if (impactedPlayer && applyShipHitTo(impactedPlayer.slot, impactedPlayer.ship, e.pos.copy(), "enemy")) return;

        const starLossR = T.STAR_RADIUS + e.r * 0.4;
        if (e.pos.len() <= starLossR) {
          loseRun("sol");
          return;
        }

        // cull far away
        if (e.pos.len() > oortOuter * 1.9) enemies.splice(i, 1);
      }

      // collisions: bullet vs enemy
      for (let bi = bullets.length - 1; bi >= 0; bi--) {
        const b = bullets[bi];
        let hit = false;
        for (let ei = enemies.length - 1; ei >= 0; ei--) {
          const e = enemies[ei];
          if (e.morphing) continue;
          const impact = findBulletEnemyImpact(b, e);
          if (!impact) continue;

          const shotDistance = impact.point.copy().sub(b.origin).len();
          bestShotDistance = Math.max(bestShotDistance, shotDistance);
          if (shotDistance >= SCORE_THRESHOLDS.longShotDistance) {
            awardCitation(shotDistance >= SCORE_THRESHOLDS.extremeLongShotDistance ? "extremeLongShot" : "longShot", "gunnery");
          }

          const overchargeSphere = e.kind === "tetra" && DOWNGRADE[e.kind] === null;
          spawnShrapnel(e, impact);
          const chargeResult = chargeMetaNodeAt(impact.point, overchargeSphere);
          if (chargeResult.newlyAwakened) {
            runAwakenedCount += 1;
            audioRef.current.sphereActivate();
            awardCitation("nodeAwakened", "geometry");
          }
          if (chargeResult.allLit && !allSpheresLitAwarded) {
            allSpheresLitAwarded = true;
            awardCitation("allSpheresLit", "geometry");
          }
          awardEnemyShellHit(e.kind, e.pos);
          const outward = e.pos.copy();
          applyEnemyImpulse(e, outward, T.ENEMY_HIT_DEFLECT_IMPULSE, T.ENEMY_HIT_DEFLECT_TANGENTIAL);
          audioRef.current.hit();
          debugLog("projectile", "projectile-hit", {
            id: b.id,
            ownerId: b.ownerId,
            targetEnemyId: e.id,
            targetKind: e.kind,
            impactX: impact.point.x,
            impactY: impact.point.y,
            authorityTick: authorityClock.tick,
          });
          b.life = -1;
          resolveBurst(b.burstId, true);
          const downgraded = downgradeEnemy(e);
          if (!downgraded) {
            debugLog("enemy", "enemy-destroyed", { enemyId: e.id, kind: e.kind, authorityTick: authorityClock.tick });
            enemies.splice(ei, 1);
          } else {
            debugLog("enemy", "enemy-morphed", { enemyId: e.id, fromKind: e.kind, toKind: e.nextKind, authorityTick: authorityClock.tick });
          }
          hit = true;
          break;
        }
        if (hit || b.life <= 0) {
          debugLog("projectile", "projectile-destroyed", {
            id: b.id,
            ownerId: b.ownerId,
            reason: hit ? "enemy-hit" : "spent",
            authorityTick: authorityClock.tick,
          }, "debug");
          bullets.splice(bi, 1);
        }
      }

      // shrapnel update
      for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.vel.add(gravityAt(s.pos, lvl.gravityGM * T.SHRAPNEL_GRAVITY_MULT).mul(dt));
        if (T.META_NODE_GRAVITY_AFFECTS_SHRAPNEL) {
          s.vel.add(activeMetaNodeGravityAt(s.pos, lvl.gravityGM * T.SHRAPNEL_GRAVITY_MULT).mul(dt));
        }
        applyActivatedSphereMediumDrag(s.vel, s.pos, dt, T.META_SPHERE_SHRAPNEL_MEDIUM_DRAG);
        s.pos.add(s.vel.copy().mul(dt));
        s.ang += s.spin * dt;
        s.life -= dt;

        const shardTarget = allAuthoritativeShips().find(({ ship }) => s.pos.copy().sub(ship.pos).len() <= T.SHIP_HIT_RADIUS + s.size + T.SHARD_HIT_RADIUS_PAD);
        if (shardTarget) {
          const destroyed = applyShipHitTo(shardTarget.slot, shardTarget.ship, s.pos.copy(), "shrapnel");
          debugLog("shrapnel", "shrapnel-destroyed", {
            id: s.id,
            sourceEnemyId: s.sourceEnemyId,
            reason: "player-hit",
            playerId: shardTarget.slot.id,
            authorityTick: authorityClock.tick,
          }, "debug");
          shards.splice(i, 1);
          if (destroyed) return;
          continue;
        }

        let shardConsumed = false;
        for (let ei = enemies.length - 1; ei >= 0; ei--) {
          const e = enemies[ei];
          if (e.morphing) continue;
          const enemyHitR = Math.max(8, e.r * T.ENEMY_HIT_RADIUS_MULT);
          if (s.pos.copy().sub(e.pos).len() > enemyHitR + s.size + T.SHARD_HIT_RADIUS_PAD) continue;

          const awayFromShard = e.pos.copy().sub(s.pos);
          const awayFromSol = e.pos.copy();
          const impulseDir = awayFromShard.len() > 0.0001
            ? awayFromShard.norm().add(awayFromSol.len() > 0.0001 ? awayFromSol.norm().mul(T.SHARD_ENEMY_SOL_BIAS) : new V2()).norm()
            : awayFromSol;
          applyEnemyImpulse(e, impulseDir, T.SHARD_ENEMY_KNOCKBACK);
          debugLog("shrapnel", "shrapnel-destroyed", {
            id: s.id,
            sourceEnemyId: s.sourceEnemyId,
            reason: "enemy-deflection",
            targetEnemyId: e.id,
            authorityTick: authorityClock.tick,
          }, "debug");
          shards.splice(i, 1);
          shardConsumed = true;
          break;
        }
        if (shardConsumed) continue;

        if (s.life <= 0 || s.pos.len() > oortOuter * 2.4) {
          debugLog("shrapnel", "shrapnel-destroyed", {
            id: s.id,
            sourceEnemyId: s.sourceEnemyId,
            reason: s.life <= 0 ? "expired" : "out-of-bounds",
            authorityTick: authorityClock.tick,
          }, "debug");
          shards.splice(i, 1);
        }
      }

      // fuel bits update
      for (let i = fuelBits.length - 1; i >= 0; i--) {
        const b = fuelBits[i];
        b.pos.add(b.vel.copy().mul(dt));
        b.life -= dt;
        if (b.life <= 0 || b.pos.len() > oortOuter * 2.2) fuelBits.splice(i, 1);
      }

      settleFuelBitsFromShards(dt);
      collectFuelBits();
      } else {
        applyInterpolatedSnapshotPresentation();
        for (let i = bullets.length - 1; i >= 0; i -= 1) {
          const bullet = bullets[i];
          if (!bullet.predicted) continue;
          bullet.prevPos = bullet.pos.copy();
          if (bullet.mass > 0) bullet.vel.add(gravityAt(bullet.pos, lvl.gravityGM * bullet.mass).mul(dt));
          bullet.pos.add(bullet.vel.copy().mul(dt));
          bullet.life -= dt;
          if (bullet.life <= 0) bullets.splice(i, 1);
        }
        predictionHeartbeatAccumulator += dt;
        if (predictionHeartbeatAccumulator >= 1) {
          predictionHeartbeatAccumulator = 0;
          guestSnapshotTimeline.logHeartbeat(localPlayerId);
        }
      }

      // Each pilot owns an independent phosphor trace. Dead ships stop sampling
      // immediately and their stored path is cleared by destroyPlayer().
      if (primaryAlive) samplePlayerTrail(trail, player.pos);
      else trail.length = 0;

      // metatron spin increases with distance; "dwell" keeps it readable near center
      const distK = clamp(player.pos.len() / Math.max(1, metaRadius), 0, 8);
      const spin = (T.META_BASE_SPIN + T.META_SPIN_GAIN * distK) * dt;

      metaAz += spin;
      metaAx += spin * 0.62;
      metaAy += spin * 0.44;

      const dwell = T.META_DWELL / (1 + T.META_DWELL * distK * 0.9);
      metaAx -= metaAx * dwell * dt;
      metaAy -= metaAy * dwell * dt;
      metaAz -= metaAz * dwell * 0.35 * dt; // let az keep motion
      updateMetaAlignment(dt);
      syncMetaNodeWorldPositions();

      if (authorityClock.mode !== "client-mirror" && waveActive && enemies.length === 0 && shards.length === 0) {
        const waveNumber = getLevel(levelIdxRef.current).wave;
        awardPoints(scoreForWaveClear(waveNumber), "wave", {
          showAlert: true,
          label: `WAVE ${waveNumber} CLEARED`,
          subtitle: waveDamageTaken <= 0 ? "PERFECT DEFLECTION WINDOW" : "ALIGNMENT WINDOW OPEN",
          severity: "info",
          duration: 1.8,
        });
        if (waveDamageTaken <= 0) {
          awardPoints(scoreForPerfectWave(waveNumber), "wave", {
            showAlert: true,
            label: "PERFECT WAVE",
            subtitle: "NO HITS TAKEN",
            severity: "warning",
            duration: 1.8,
          });
        }
        debugLog("wave", "wave-cleared", {
          wave: waveNumber,
          score: Math.round(score),
          perfect: waveDamageTaken <= 0,
          awakenedNodes: getAwakenedMetaNodeCount(),
        });
        respawnPendingPlayersAtWaveBoundary();
        audioRef.current.levelUp();
        queueWaveBanner(levelIdxRef.current + 1);
      }

      publishAuthoritySnapshotIfDue(dt);

      // camera remains Sol-centered, fitting the local couch constellation within a bounded scope.
      const cameraShips = authorityClock.mode === "client-mirror"
        ? [{ pos: player.pos, vel: player.vel }]
        : allAuthoritativeShips().filter(({ slot }) => localPlayerIds.has(slot.id)).map(({ ship }) => ({ pos: ship.pos, vel: ship.vel }));
      updateCamera(camera, canvas, dpr, cameraShips.length > 0 ? cameraShips : [{ pos: player.pos, vel: player.vel }], horizonR);
      // audio continuous
      audioRef.current.updateDrones(modeRef.current as GameMode, enemies, player, T.STAR_RADIUS, oortOuter);
      audioRef.current.setThrust(Math.max(0, player.thrust) * (player.fuel > 0 ? 1 : 0));

      hudPublishAccumulator += dt;
      if (hudPublishAccumulator >= HUD_UPDATE_INTERVAL) {
        hudPublishAccumulator = 0;
        const effectiveShipResilience = Math.max(1, T.SHIP_RESILIENCE);
        const shieldsPct = clamp(((effectiveShipResilience - player.hitsTaken) * 100) / effectiveShipResilience, 0, 100);
        const hitsRemaining = Math.max(0, Math.ceil(effectiveShipResilience - player.hitsTaken));
        const speed = player.vel.len();
        const radialDir = player.pos.copy().norm();
        const closureRate = enemies.length > 0
          ? enemies.reduce((best, e) => {
              const toPlayer = player.pos.copy().sub(e.pos);
              const dist = toPlayer.len() || 1;
              const towardPlayer = toPlayer.copy().mul(1 / dist);
              const relVel = player.vel.copy().sub(e.vel);
              const close = relVel.dot(towardPlayer);
              return close > best ? close : best;
            }, -Infinity)
          : 0;
        const nearestRange = enemies.length > 0
          ? enemies.reduce((best, e) => Math.min(best, e.pos.copy().sub(player.pos).len()), Infinity)
          : 0;
        const radarContacts = enemies.slice(0, 10).map((e) => {
          const rel = e.pos.copy().sub(player.pos);
          return {
            bearingRad: Math.atan2(rel.y, rel.x),
            distanceNorm: clamp(rel.len() / (oortOuter * 1.2), 0.08, 1),
            kind: e.kind,
            threat: 1 + (e.kind === "icosa" ? 3 : e.kind === "dodeca" ? 2 : 1),
          };
        });
        let alertText = "SYSTEM STABLE";
        let alertSeverity: HUDState["alert"]["severity"] = "info";
        let alertSubtitle = "Hold your line and let the field do the work.";
        let flashing = false;
        if (activeScoringAlert) {
          alertText = activeScoringAlert.text;
          alertSeverity = activeScoringAlert.severity;
          alertSubtitle = activeScoringAlert.subtitle ?? alertSubtitle;
          flashing = activeScoringAlert.flashing ?? false;
        } else if (waveBannerTimer > 0 && waveBannerText) {
          alertText = waveBannerText;
          alertSubtitle = "Establish your next approach.";
        } else if (shieldsPct <= 25) {
          alertText = "SHIELDS CRITICAL";
          alertSeverity = "critical";
          alertSubtitle = "Break contact or hold a charged sphere.";
          flashing = true;
        } else if (player.pos.len() < horizonR * 0.9) {
          alertText = "APPROACHING INNER ORBIT";
          alertSeverity = "warning";
          alertSubtitle = "Mind your periapsis.";
        } else if (enemies.length > 0) {
          alertText = `HOSTILES INBOUND × ${enemies.length}`;
          alertSeverity = "warning";
          alertSubtitle = "Keep the flight chain alive.";
        }
        const trimVec = V2.fromAngle(player.angle, 1);
        const trimDeg = Math.atan2(trimVec.x * radialDir.y - trimVec.y * radialDir.x, trimVec.dot(radialDir)) * 180 / Math.PI;
        setHUDState({
          title: `Metatron Vector FOIL · SCORE ${Math.round(score).toLocaleString()}`,
          controlsText: getGamepadControlsHint(gamepadInput),
          alert: { text: alertText, severity: alertSeverity, flashing, subtitle: alertSubtitle },
          player: {
            shieldsPct,
            fuelPct: clamp((player.fuel / T.FUEL_MAX) * 100, 0, 100),
            hitsRemaining,
            speed,
            driftSpeed: Math.abs(player.vel.dot(radialDir)),
            trimDeg,
            gravFieldStrength: gravityAt(player.pos, slidersRef.current.gravity).len(),
            phaseState: player.pos.len() < horizonR ? "INNER" : (player.pos.len() < oortInner ? "TRANSFER" : "OUTER"),
          },
          tactical: {
            waveNumber: getLevel(levelIdxRef.current).wave,
            currentEnemyLabel: getLevel(levelIdxRef.current).enemyKind,
            incomingCount: getLevel(levelIdxRef.current).enemyCount,
            bullets: bullets.length,
            enemies: enemies.length,
            shards: shards.length,
            closureRate: Number.isFinite(closureRate) ? closureRate : 0,
            nearestRange: Number.isFinite(nearestRange) ? nearestRange : 0,
            score: Math.round(score),
            chainMultiplier,
            bestChainMultiplier,
            citationCount,
          },
          radar: {
            contacts: radarContacts,
            placeholderSweepDeg: ((performance.now() / 22) % 360),
            enabled: true,
          },
        });
      }
    };

    function loop() {
      const t = performance.now();
      const dt = (t - last) / 1000;
      last = t;

      acc = Math.min(0.25, acc + dt);
      const steps = Math.min(T.SUBSTEPS_MAX, Math.floor(acc / T.FIXED_DT));
      for (let i = 0; i < steps; i++) {
        step(T.FIXED_DT);
        acc -= T.FIXED_DT;
      }

      const localPlayerIdForRender = playerSlots[0]?.id ?? LOCAL_SOLO_PLAYER_ID;
      const transportStateForRender = transport.getState();
      const renderPlayers: RenderMultiplayerPlayer[] = playerSlots.map((slot) => {
        const mirror = remotePlayerMirrors[slot.id];
        const isPrimaryLocal = slot.id === localPlayerIdForRender;
        const useInterpolatedMirror = authorityClock.mode === "client-mirror" && !isPrimaryLocal;
        const renderX = isPrimaryLocal
          ? displayedLocalPlayer.x
          : useInterpolatedMirror
            ? (mirror?.displayedX ?? mirror?.pos.x ?? 0)
            : (mirror?.pos.x ?? 0);
        const renderY = isPrimaryLocal
          ? displayedLocalPlayer.y
          : useInterpolatedMirror
            ? (mirror?.displayedY ?? mirror?.pos.y ?? 0)
            : (mirror?.pos.y ?? 0);
        const renderAngle = isPrimaryLocal
          ? displayedLocalPlayer.angle
          : useInterpolatedMirror
            ? (mirror?.displayedAngle ?? mirror?.angle ?? 0)
            : (mirror?.angle ?? 0);
        return {
          id: slot.id,
          slot: slot.slot,
          role: slot.role,
          callsign: slot.callsign ?? null,
          lifeState: slot.lifeState,
          connected: slot.connected,
          isLocal: localPlayerIds.has(slot.id),
          x: renderX,
          y: renderY,
          vx: isPrimaryLocal ? player.vel.x : (mirror?.vel.x ?? 0),
          vy: isPrimaryLocal ? player.vel.y : (mirror?.vel.y ?? 0),
          angle: renderAngle,
          angularVelocity: isPrimaryLocal ? player.angularVel : (mirror?.angularVel ?? 0),
          fuel: isPrimaryLocal ? player.fuel : (mirror?.fuel ?? T.FUEL_MAX),
          hitsTaken: isPrimaryLocal ? player.hitsTaken : (mirror?.hitsTaken ?? 0),
          thrustGlow: isPrimaryLocal ? player.thrustGlow : (mirror?.thrustGlow ?? 0),
          trail: isPrimaryLocal ? trail : (mirror?.trail ?? []),
          lastInputSeq: slot.lastInputSeq,
        };
      });
      const playerForRender: PlayerShipState = {
        ...player,
        pos: new V2(displayedLocalPlayer.x, displayedLocalPlayer.y),
        vel: player.vel,
        angle: displayedLocalPlayer.angle,
      };

      render(ctx, canvas, dpr, {
        mode: modeRef.current,
        level: getLevel(levelIdxRef.current),
        player: playerForRender, camera,
        meta: { ax: metaAx, ay: metaAy, az: metaAz, alignT: metaAlignT, centers3, nodes: metaNodes, pulseClock: metaPulseClock },
        oort: { clusters: oortClusters, timeSec: metaPulseClock },
        entities: { bullets, enemies, shards, fuelBits, trail },
        toggles: togglesRef.current,
        horizonR, oortInner, oortOuter,
        waveBannerTimer,
        waveBannerText,
        multiplayer: {
          role: transportLaunch.role,
          roomId: transportLaunch.roomId,
          localPlayerId: localPlayerIdForRender,
          showRoster: transportLaunch.showRoster || playerSlots.length > 1,
          transportPeers: transportStateForRender.peers.length,
          queuedInbound: transportStateForRender.queuedInbound,
          sent: transportStateForRender.stats.sent,
          received: transportStateForRender.stats.received,
          players: renderPlayers,
        },
        debrief: {
          phase: debriefPhase,
          phaseElapsedMs: debriefPhaseElapsedMs,
          snapshot: debriefSnapshot,
        },
      });

      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);

    return () => {
      resetToMenuRef.current = null;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown as any);
      window.removeEventListener("keyup", onKeyUp as any);
      window.removeEventListener("pointerdown", onPointerDown as any);
      transport.dispose();
      if (multiplayerTransportRef.current === transport) multiplayerTransportRef.current = null;
      audioRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===================== UI =====================
  const debriefHudFade = mode === "debrief"
    ? Math.max(0, 1 - (debriefUI.phase === "burn_fade" ? debriefUI.phaseElapsedMs / DEBRIEF_SEQUENCE.burnFadeMs : 1))
    : 1;
  const menuFlightHint = flightHints[menuHintIdx] ?? DEFAULT_FLIGHT_HINTS[0];
  const menuFlightDetail = flightHintDetail(menuFlightHint);
  const menuHintElapsedMs = menuHintTick * MENU_HINT_TICK_MS;
  const menuHintBlinking = menuHintElapsedMs >= MENU_HINT_STABLE_MS;
  const menuHintBlinkVisible = !menuHintBlinking || Math.floor((menuHintElapsedMs - MENU_HINT_STABLE_MS) / 120) % 2 === 0;
  const menuHintHeadlineChars = Math.min(menuFlightHint.length, Math.max(0, Math.floor(menuHintElapsedMs / MENU_HINT_TYPE_MS)));
  const menuHintDetailStartMs = menuFlightHint.length * MENU_HINT_TYPE_MS + MENU_HINT_DETAIL_DELAY_MS;
  const menuHintDetailChars = Math.min(menuFlightDetail.length, Math.max(0, Math.floor((menuHintElapsedMs - menuHintDetailStartMs) / MENU_HINT_DETAIL_TYPE_MS)));
  const typedMenuFlightHint = menuFlightHint.slice(0, menuHintHeadlineChars);
  const typedMenuFlightDetail = menuFlightDetail.slice(0, menuHintDetailChars);
  const menuHintCursorOn = !menuHintBlinking && Math.floor(menuHintElapsedMs / 320) % 2 === 0;
  const menuHintTypingHeadline = menuHintHeadlineChars < menuFlightHint.length;
  const menuHintTypingDetail = !menuHintTypingHeadline && menuHintDetailChars < menuFlightDetail.length;
  const menuHintOpacity = menuHintBlinkVisible ? 1 : 0.16;
  const menuHintCount = Math.max(1, flightHints.length || DEFAULT_FLIGHT_HINTS.length);
  const menuHintCounter = `${String((menuHintIdx % menuHintCount) + 1).padStart(2, "0")}/${String(menuHintCount).padStart(2, "0")}`;
  const publicBoardStatus = playerIdentity.callsign
    ? `PILOT ${playerIdentity.callsign} // PUBLIC BOARD ACTIVE`
    : playerIdentity.authenticated
      ? "CALLSIGN OPEN // PUBLIC BOARD STANDBY"
      : "ANONYMOUS FLIGHT // LOCAL SCORE ONLY";

  const effectiveStartPanelFocus: StartPanelFocus = startPanelFocus ?? "multiplayer";
  const startPanelFocusEngaged = effectiveStartPanelFocus !== null;
  const identityPanelExpanded = !startPanelFocusEngaged || effectiveStartPanelFocus === "identity";
  const multiplayerPanelExpanded = !startPanelFocusEngaged || effectiveStartPanelFocus === "multiplayer";
  const flightPanelExpanded = !startPanelFocusEngaged || effectiveStartPanelFocus === "flight";
  const startPanelColumns = effectiveStartPanelFocus === "identity"
    ? "minmax(320px, 1.58fr) minmax(230px, 0.82fr) minmax(230px, 0.82fr)"
    : effectiveStartPanelFocus === "multiplayer"
      ? "minmax(240px, 0.82fr) minmax(350px, 1.68fr) minmax(240px, 0.82fr)"
      : "minmax(230px, 0.82fr) minmax(230px, 0.82fr) minmax(320px, 1.58fr)";
  const identityPanelSummary = playerIdentity.callsign
    ? `PILOT ${playerIdentity.callsign} // ${leaderboard.length} BOARD ECHOES`
    : playerIdentity.authenticated
      ? "CALLSIGN OPEN // CLAIM TRACE"
      : "ANONYMOUS // LOCAL SCORE";
  const multiplayerPanelSummary = "CARRIER ROOM // HAIL VECTOR";
  const flightPanelSummary = `${menuFlightHint.slice(0, 34)}${menuFlightHint.length > 34 ? "..." : ""}`;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
        background: "#05060a",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />
            <div style={{ opacity: debriefHudFade, pointerEvents: debriefHudFade <= 0.001 ? "none" : undefined }}>
        <HUDRoot state={hudState} config={hudConfig} />
      </div>

      {/* Start screen */}
      {mode === "menu" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: "clamp(14px, 2.5vw, 26px)",
            color: "rgba(210,238,255,0.92)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            background: "radial-gradient(circle at 50% 45%, rgba(28,72,104,0.12), rgba(0,0,0,0.34) 44%, rgba(0,0,0,0.62) 100%)",
          }}
        >
          <style>{`
            @keyframes mvfScopeSweep {
              0% { transform: translateX(-125vw) rotate(12deg); opacity: 0; }
              14% { opacity: 0.24; }
              48% { opacity: 0.08; }
              100% { transform: translateX(125vw) rotate(12deg); opacity: 0; }
            }
            @keyframes mvfTitlePhosphor {
              0%, 100% { opacity: 0.96; filter: brightness(1.02); text-shadow: 0 0 20px rgba(176,230,255,0.28), 0 0 58px rgba(160,220,255,0.12), 0 0 104px rgba(140,210,255,0.05); }
              24% { opacity: 1; filter: brightness(1.12); text-shadow: 0 0 28px rgba(198,242,255,0.34), 0 0 76px rgba(168,228,255,0.18), 0 0 132px rgba(140,210,255,0.08); }
              48% { opacity: 0.90; filter: brightness(0.98); text-shadow: 0 0 14px rgba(160,220,255,0.18), 0 0 42px rgba(160,220,255,0.08); }
              61% { opacity: 1; filter: brightness(1.72); text-shadow: 0 0 7px rgba(244,252,255,0.92), 0 0 28px rgba(206,244,255,0.70), 0 0 92px rgba(176,230,255,0.34), 0 0 164px rgba(140,210,255,0.16); }
              62.4% { opacity: 0.80; filter: brightness(0.84); text-shadow: 0 0 10px rgba(160,220,255,0.12), 0 0 26px rgba(160,220,255,0.06); }
              64% { opacity: 1; filter: brightness(1.34); text-shadow: 0 0 24px rgba(198,242,255,0.42), 0 0 84px rgba(150,220,255,0.22), 0 0 148px rgba(140,210,255,0.10); }
            }
            @keyframes mvfSubtitlePhosphor {
              0%, 100% { opacity: 0.82; filter: brightness(1.02); text-shadow: 0 0 14px rgba(243,214,152,0.18), 0 0 38px rgba(243,214,152,0.08); }
              38% { opacity: 0.96; filter: brightness(1.12); text-shadow: 0 0 22px rgba(243,214,152,0.30), 0 0 54px rgba(243,214,152,0.12); }
              71% { opacity: 1; filter: brightness(1.52); text-shadow: 0 0 6px rgba(255,235,184,0.76), 0 0 30px rgba(243,214,152,0.40), 0 0 84px rgba(243,214,152,0.16); }
              72.3% { opacity: 0.66; filter: brightness(0.86); text-shadow: 0 0 9px rgba(243,214,152,0.10); }
              74% { opacity: 0.90; filter: brightness(1.08); text-shadow: 0 0 16px rgba(243,214,152,0.22), 0 0 42px rgba(243,214,152,0.08); }
            }
            @keyframes mvfLaunchPhosphor {
              0%, 100% { opacity: 0.84; transform: scale(1); text-shadow: 0 0 14px rgba(176,255,218,0.24), 0 0 40px rgba(176,255,218,0.10), 0 0 86px rgba(176,255,218,0.05); }
              42% { opacity: 1; transform: scale(1.016); text-shadow: 0 0 24px rgba(176,255,218,0.42), 0 0 68px rgba(176,255,218,0.18), 0 0 108px rgba(176,255,218,0.07); }
              79% { opacity: 1; transform: scale(1.022); filter: brightness(1.62); text-shadow: 0 0 6px rgba(234,255,246,0.76), 0 0 30px rgba(176,255,218,0.58), 0 0 96px rgba(176,255,218,0.28), 0 0 140px rgba(176,255,218,0.10); }
              80.5% { opacity: 0.58; transform: scale(0.998); filter: brightness(0.80); text-shadow: 0 0 8px rgba(176,255,218,0.12); }
              82% { opacity: 1; transform: scale(1.010); filter: brightness(1.18); text-shadow: 0 0 20px rgba(176,255,218,0.34), 0 0 60px rgba(176,255,218,0.14); }
            }
            @keyframes mvfTraceFlicker {
              0%, 100% { opacity: 0.72; }
              6% { opacity: 0.42; }
              8% { opacity: 0.9; }
              38% { opacity: 0.64; }
              41% { opacity: 0.84; }
            }
            @keyframes mvfPanelStarshine {
              0%, 100% { opacity: 0.22; filter: brightness(1); transform: translateX(-120%) skewX(-16deg); }
              38% { opacity: 0.78; filter: brightness(1.45); }
              58% { opacity: 0.18; filter: brightness(0.82); }
              74% { opacity: 0.62; filter: brightness(1.22); }
              100% { transform: translateX(138%) skewX(-16deg); opacity: 0; }
            }
            .mvfStartPanelScroll {
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            .mvfStartPanelScroll::-webkit-scrollbar {
              width: 0;
              height: 0;
            }

            @keyframes mvfHintSignal {
              0% { transform: translateX(-110%); opacity: 0; }
              16% { opacity: 0.78; }
              58% { opacity: 0.26; }
              100% { transform: translateX(112%); opacity: 0; }
            }
            @keyframes mvfHintCursor {
              0%, 48% { opacity: 0.95; }
              49%, 100% { opacity: 0.16; }
            }
            @keyframes mvfMetatronGhost {
              0%, 100% { opacity: 0.58; filter: brightness(1); }
              50% { opacity: 0.84; filter: brightness(1.18); }
            }
            @keyframes mvfPlatonicPulseA {
              0%, 100% { opacity: 0.30; }
              18%, 24% { opacity: 0.96; }
              58% { opacity: 0.44; }
            }
            @keyframes mvfPlatonicPulseB {
              0%, 100% { opacity: 0.26; }
              34%, 40% { opacity: 0.92; }
              75% { opacity: 0.40; }
            }
            @keyframes mvfPlatonicPulseC {
              0%, 100% { opacity: 0.22; }
              64%, 70% { opacity: 0.98; }
              82% { opacity: 0.36; }
            }
            @keyframes mvfMysticSolPulse {
              0%, 100% { opacity: 0.78; filter: brightness(1); transform: scale(1); }
              34% { opacity: 0.94; filter: brightness(1.18); transform: scale(1.035); }
              59% { opacity: 1; filter: brightness(1.55); transform: scale(1.07); }
              61% { opacity: 0.58; filter: brightness(0.82); transform: scale(0.99); }
              64% { opacity: 0.96; filter: brightness(1.22); transform: scale(1.025); }
            }
            @keyframes mvfMysticSolRings {
              0% { opacity: 0.16; stroke-dashoffset: 42; transform: scale(0.92); }
              42% { opacity: 0.62; }
              100% { opacity: 0.10; stroke-dashoffset: -42; transform: scale(1.22); }
            }
            @keyframes mvfMysticSolSweep {
              0% { opacity: 0; transform: rotate(0deg); }
              16% { opacity: 0.68; }
              62% { opacity: 0.20; }
              100% { opacity: 0; transform: rotate(360deg); }
            }
          `}</style>
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              opacity: 0.18,
              backgroundImage: [
                "linear-gradient(rgba(150,205,255,0.12) 1px, transparent 1px)",
                "linear-gradient(90deg, rgba(150,205,255,0.10) 1px, transparent 1px)",
                "repeating-linear-gradient(180deg, rgba(176,225,255,0.16) 0px, rgba(176,225,255,0.16) 1px, transparent 1px, transparent 4px)",
                "radial-gradient(circle at center, transparent 0 28%, rgba(150,205,255,0.13) 28.2%, transparent 28.8%, transparent 45%, rgba(150,205,255,0.09) 45.2%, transparent 45.8%)",
              ].join(", "),
              backgroundSize: "48px 48px, 48px 48px, 100% 4px, 100% 100%",
              mixBlendMode: "screen",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: "-20vh",
              bottom: "-20vh",
              left: "48%",
              width: 2,
              pointerEvents: "none",
              background: "linear-gradient(180deg, transparent, rgba(176,255,218,0.56), transparent)",
              filter: "blur(1px)",
              animation: "mvfScopeSweep 5.8s linear infinite",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 14,
              pointerEvents: "none",
              border: "1px solid rgba(152,206,255,0.10)",
              boxShadow: "inset 0 0 42px rgba(90,150,210,0.08), 0 0 30px rgba(90,150,210,0.05)",
            }}
          />

          <div style={{ position: "relative", zIndex: 2, display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", height: "100%", gap: "clamp(10px, 2vh, 18px)" }}>
            <div style={{ display: "grid", justifyItems: "center", gap: 7, textAlign: "center" }}>
              <div style={{ fontSize: 10, letterSpacing: "0.42em", textTransform: "uppercase", color: "rgba(144,198,245,0.68)", animation: "mvfTraceFlicker 3.4s linear infinite" }}>
                Live vector scope // attract mode
              </div>
              <div
                style={{
                  fontSize: "clamp(28px, 5.6vw, 52px)",
                  letterSpacing: "0.20em",
                  textTransform: "uppercase",
                  color: "rgba(218,244,255,0.96)",
                  textShadow: "0 0 22px rgba(176,230,255,0.28), 0 0 62px rgba(160,220,255,0.14), 0 0 112px rgba(140,210,255,0.06)",
                  lineHeight: 1.05,
                  animation: "mvfTitlePhosphor 8.7s ease-in-out infinite",
                }}
              >
                Metatron Vector Foil
              </div>
              <div style={{ fontSize: "clamp(10px, 1.55vw, 13px)", letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(243,214,152,0.78)", textShadow: "0 0 16px rgba(243,214,152,0.16), 0 0 42px rgba(243,214,152,0.08)", animation: "mvfSubtitlePhosphor 9.9s ease-in-out infinite" }}>
                Defend Sol // Awaken the Tree // Surf the gravity well
              </div>
              <div style={{ marginTop: 4, display: "grid", justifyItems: "center", gap: 6 }}>
                <div style={{ fontSize: "clamp(16px, 2.8vw, 24px)", letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(176,255,218,0.98)", textShadow: "0 0 16px rgba(176,255,218,0.22), 0 0 48px rgba(176,255,218,0.10)", animation: "mvfLaunchPhosphor 5.6s ease-in-out infinite", transformOrigin: "50% 50%" }}>
                  Press Enter to Launch
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", alignItems: "center", fontSize: 11, letterSpacing: "0.10em", color: "rgba(202,230,248,0.78)" }}>
                  <Keycap>A/D</Keycap><span>Rotate</span>
                  <Keycap>W</Keycap><span>Thrust</span>
                  <Keycap>S</Keycap><span>Brake</span>
                  <Keycap>Space</Keycap><span>Fire</span>
                  <Keycap>P</Keycap><span>Pause</span>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", placeItems: "center", minHeight: 0 }}>
              <div style={{ width: "min(1280px, 98vw)", display: "grid", gridTemplateColumns: startPanelColumns, gap: "clamp(12px, 2vw, 20px)", alignItems: "end" }}>
                <StartFocusPanel panel="identity" title="PILOT // IDENTITY TRACE" summary={identityPanelSummary} focus={effectiveStartPanelFocus} onFocusChange={setStartPanelFocus}>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontSize: 15, lineHeight: 1.3, letterSpacing: "0.13em", textTransform: "uppercase", color: "rgba(176,255,218,0.86)", textShadow: "0 0 12px rgba(145,255,212,0.12)" }}>
                      {publicBoardStatus}
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.55, letterSpacing: "0.08em", color: "rgba(188,220,244,0.72)" }}>
                      Fly now. Sign in only when you want a three-character callsign engraved on the public honor board.
                    </div>
                  </div>

                  <CallsignConsole
                    value={callsignInput}
                    current={playerIdentity.callsign}
                    authenticated={playerIdentity.authenticated}
                    authProvider={playerIdentity.authProvider}
                    canChoose={playerIdentity.canChooseCallsign}
                    googleAuthEnabled={googleAuthEnabled}
                    devAuthEnabled={devAuthEnabled}
                    devHandle={devHandle}
                    message={callsignMessage}
                    onChange={setCallsignInput}
                    onSubmit={submitCallsign}
                    onGoogleLogin={googleLogin}
                    onDevHandleChange={setDevHandle}
                    onDevLogin={devLogin}
                    onLogout={logoutPlayer}
                  />

                  <LeaderboardConsole entries={leaderboard} status={scoreSubmitStatus} compact />
                </StartFocusPanel>

                <StartFocusPanel panel="multiplayer" title="CONSTELLATION DEFENSE // MULTIPLAYER" summary={multiplayerPanelSummary} focus={effectiveStartPanelFocus} onFocusChange={setStartPanelFocus}>
                  <MultiplayerStartConsole
                    featuredGlow={featuredGlow}
                    featuredOpacity={featuredOpacity}
                    featuredHeadline={featuredHeadline}
                    featuredSubline={featuredSubline}
                  />
                </StartFocusPanel>

                <StartFocusPanel panel="flight" title="FLIGHT SCHOOL // ORBITAL TRACE" summary={flightPanelSummary} focus={effectiveStartPanelFocus} onFocusChange={setStartPanelFocus}>
                  <div
                    style={{
                      position: "relative",
                      overflow: "hidden",
                      minHeight: 162,
                      padding: "13px 14px 15px",
                      border: "1px solid rgba(150,205,255,0.14)",
                      background: "linear-gradient(180deg, rgba(6,18,28,0.58), rgba(0,0,0,0.18))",
                      boxShadow: "inset 0 0 34px rgba(110,190,255,0.055), 0 0 18px rgba(110,190,255,0.035)",
                      opacity: menuHintOpacity,
                      transition: "opacity 80ms linear",
                    }}
                  >
                    <div
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: 2,
                        background: "linear-gradient(90deg, transparent, rgba(176,255,218,0.72), transparent)",
                        animation: "mvfHintSignal 2.25s linear infinite",
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginBottom: 12 }}>
                      <div style={{ fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(150,205,255,0.62)" }}>
                        Guidance teletype
                      </div>
                      <div style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: menuHintBlinking ? "rgba(243,214,152,0.84)" : "rgba(176,255,218,0.58)" }}>
                        {menuHintBlinking ? "Cycling trace" : menuHintCounter}
                      </div>
                    </div>
                    <div style={{ minHeight: 70, display: "flex", alignItems: "center" }}>
                      <div style={{ fontSize: "clamp(22px, 2.75vw, 31px)", lineHeight: 1.18, letterSpacing: "0.025em", color: "rgba(255,226,158,0.98)", textShadow: "0 0 14px rgba(243,214,152,0.19), 0 0 30px rgba(243,214,152,0.06)" }}>
                        {typedMenuFlightHint}
                        {menuHintTypingHeadline && menuHintCursorOn ? <span style={{ color: "rgba(176,255,218,0.92)", animation: "mvfHintCursor 640ms steps(1, end) infinite" }}>▌</span> : null}
                      </div>
                    </div>
                    <div style={{ minHeight: 42, marginTop: 12, paddingTop: 11, borderTop: "1px solid rgba(150,205,255,0.11)", fontSize: "clamp(12px, 1.2vw, 14px)", lineHeight: 1.55, color: "rgba(213,235,249,0.82)", letterSpacing: "0.075em" }}>
                      {typedMenuFlightDetail}
                      {menuHintTypingDetail && menuHintCursorOn ? <span style={{ color: "rgba(176,255,218,0.76)", animation: "mvfHintCursor 640ms steps(1, end) infinite" }}>▌</span> : null}
                    </div>
                  </div>

                  <div style={{ marginTop: 15, display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                    <VectorTelemetry label="Tree Status" value="DORMANT // AWAKEN WHAT YOU TOUCH" />
                    <VectorTelemetry label="Scope Signal" value={featuredSubline} />
                  </div>
                </StartFocusPanel>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap", fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(140,198,244,0.56)" }}>
              <span>Graticule stable</span>
              <span>Solution envelope nominal</span>
              <span>Further in. Faster through.</span>
            </div>
          </div>
        </div>
      )}

      {mode === "debrief" && debriefUI.snapshot && (
        <DebriefOverlay
          ui={debriefUI}
          headline={gameOverLines[0] ?? DEFAULT_GAME_OVER_LINES[0]}
          subline={gameOverLines[1] ?? DEFAULT_GAME_OVER_LINES[1]}
          footer={gameOverLines[3] ?? DEFAULT_GAME_OVER_LINES[3]}
          tertiary={gameOverLines[2] ?? DEFAULT_GAME_OVER_LINES[2]}
        />
      )}

      {/* Pause menu */}
      {mode === "paused" && (
        <Overlay>
          <h2 style={{ margin: 0 }}>Paused</h2>
          <p style={{ opacity: 0.85, marginTop: 6 }}>Tune the universe. Press <b>P</b> to resume.</p>

          <div style={{ width: "min(720px, 92vw)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <SliderRow
              label="Gravity (GM)"
              value={sliders.gravity}
              min={300_000} max={2_200_000} step={10_000}
              onChange={(v) => setSliders((s) => ({ ...s, gravity: v }))}
            />
            <SliderRow
              label="Thrust"
              value={sliders.thrust}
              min={600} max={3400} step={20}
              onChange={(v) => setSliders((s) => ({ ...s, thrust: v }))}
            />
            <SliderRow
              label="Trail length"
              value={sliders.trail}
              min={400} max={5200} step={50}
              onChange={(v) => setSliders((s) => ({ ...s, trail: v }))}
            />
            <SliderRow
              label="Solar pressure"
              value={sliders.solar}
              min={60_000} max={420_000} step={5_000}
              onChange={(v) => setSliders((s) => ({ ...s, solar: v }))}
            />
            <SliderRow
              label="Master volume"
              value={sliders.master}
              min={0} max={1} step={0.01}
              onChange={(v) => setSliders((s) => ({ ...s, master: v }))}
            />
            <SliderRow
              label="HUD scale"
              value={sliders.hudScale}
              min={0.7} max={1.4} step={0.01}
              onChange={(v) => setSliders((s) => ({ ...s, hudScale: v }))}
            />
            <SliderRow
              label="HUD opacity"
              value={sliders.hudOpacity}
              min={0.35} max={1} step={0.01}
              onChange={(v) => setSliders((s) => ({ ...s, hudOpacity: v }))}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Toggle label="Metatron" checked={toggles.metatron} onChange={() => setToggles(t => ({...t, metatron: !t.metatron}))} />
              <Toggle label="Trails" checked={toggles.trails} onChange={() => setToggles(t => ({...t, trails: !t.trails}))} />
              <Toggle label="Debug" checked={toggles.debug} onChange={() => setToggles(t => ({...t, debug: !t.debug}))} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={() => { modeRef.current = "playing"; debugLog("lifecycle", "resume-from-pause"); setMode("playing"); }} style={btnStyle}>Resume</button>
            <button onClick={() => {
              resetToMenuRef.current?.();
            }} style={btnStyle}>Back to title</button>
            <button onClick={() => {
              const filename = exportDebugBundle({
                trigger: "pause-menu",
                mode,
                levelIdx,
                toggles,
                sliders,
                transport: multiplayerTransportRef.current?.getState() ?? null,
              });
              debugLog("lifecycle", "debug-export-complete", { trigger: "pause-menu", filename });
            }} style={btnStyle}>Export flight recorder</button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, opacity: 0.72, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Debug export hotkey: Ctrl/⌘ + Shift + L
          </div>
        </Overlay>
      )}
    </div>
  );
}

// ===================== UI COMPONENTS =====================
function GhostMetatronCube({ glow, opacity, headline, subline }: { glow: number; opacity: number; headline: string; subline: string }) {
  const outer = [
    [0, -110],
    [95, -55],
    [95, 55],
    [0, 110],
    [-95, 55],
    [-95, -55],
  ] as const;
  const inner = [
    [0, -64],
    [55, -32],
    [55, 32],
    [0, 64],
    [-55, 32],
    [-55, -32],
  ] as const;
  const cubeFront = [
    [-48, -48],
    [48, -48],
    [48, 48],
    [-48, 48],
  ] as const;
  const cubeBack = [
    [-12, -82],
    [82, -12],
    [12, 82],
    [-82, 12],
  ] as const;
  const tetra = [outer[0], outer[2], outer[4]] as const;
  const octa = [outer[0], outer[1], outer[3], outer[5]] as const;
  const line = (a: readonly [number, number], b: readonly [number, number], key: string, stroke: string, strokeWidth: number, extra?: React.CSSProperties) => (
    <line key={key} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={stroke} strokeWidth={strokeWidth} style={extra} />
  );
  const ringLines = outer.map((p, i) => line(p, outer[(i + 1) % outer.length], `outer-${i}`, "rgba(158,214,255,0.24)", 1.1));
  const innerLines = inner.map((p, i) => line(p, inner[(i + 1) % inner.length], `inner-${i}`, "rgba(176,255,218,0.28)", 1.0));
  const spokes = inner.map((p, i) => line([0, 0], p, `spoke-${i}`, "rgba(150,205,255,0.22)", 1.0));
  const connectors = outer.flatMap((p, i) => [
    line(p, inner[i], `connector-a-${i}`, "rgba(150,205,255,0.20)", 0.95),
    line(p, inner[(i + outer.length - 1) % inner.length], `connector-b-${i}`, "rgba(150,205,255,0.16)", 0.9),
  ]);
  const star = [0, 1].flatMap(offset => outer.map((p, i) => line(p, outer[(i + 2 + offset) % outer.length], `star-${offset}-${i}`, "rgba(150,205,255,0.10)", 0.9)));
  return (
    <div
      style={{
        position: "relative",
        width: "min(29vw, 290px)",
        minWidth: 110,
        aspectRatio: "1 / 1",
        opacity: 0.54 + opacity * 0.34,
        transform: "translateY(clamp(-82px, -8.8vh, -54px))",
        filter: `drop-shadow(0 0 ${18 + glow * 18}px rgba(140,210,255,0.14)) drop-shadow(0 0 ${42 + glow * 28}px rgba(176,255,218,0.08))`,
      }}
    >
      <svg viewBox="-140 -140 280 280" style={{ width: "100%", height: "100%", overflow: "visible" }}>
        <defs>
          <filter id="mvfMetaGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="mvfMysticSolCore" cx="45%" cy="38%" r="62%">
            <stop offset="0%" stopColor="rgba(255,255,244,1)" />
            <stop offset="24%" stopColor="rgba(255,231,164,0.96)" />
            <stop offset="48%" stopColor="rgba(255,184,92,0.54)" />
            <stop offset="76%" stopColor="rgba(176,255,218,0.18)" />
            <stop offset="100%" stopColor="rgba(176,255,218,0)" />
          </radialGradient>
          <radialGradient id="mvfMysticSolAura" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,244,206,0.58)" />
            <stop offset="35%" stopColor="rgba(255,203,112,0.20)" />
            <stop offset="70%" stopColor="rgba(176,255,218,0.10)" />
            <stop offset="100%" stopColor="rgba(144,206,255,0)" />
          </radialGradient>
        </defs>
        <g fill="none" strokeLinecap="round" filter="url(#mvfMetaGlow)" style={{ mixBlendMode: "screen" }}>
          <g style={{ animation: "mvfMetatronGhost 8.6s ease-in-out infinite" }} opacity={0.42 + glow * 0.16}>
            {ringLines}
            {innerLines}
            {spokes}
            {connectors}
            {star}
          </g>
          <g style={{ animation: "mvfPlatonicPulseA 7.2s ease-in-out infinite" }}>
            {line(tetra[0], tetra[1], "tetra-a", "rgba(255,224,164,0.92)", 1.8)}
            {line(tetra[1], tetra[2], "tetra-b", "rgba(255,224,164,0.92)", 1.8)}
            {line(tetra[2], tetra[0], "tetra-c", "rgba(255,224,164,0.92)", 1.8)}
            {line([0, 0], tetra[0], "tetra-d", "rgba(255,238,196,0.84)", 1.45)}
            {line([0, 0], tetra[1], "tetra-e", "rgba(255,238,196,0.84)", 1.45)}
            {line([0, 0], tetra[2], "tetra-f", "rgba(255,238,196,0.84)", 1.45)}
          </g>
          <g style={{ animation: "mvfPlatonicPulseB 8.4s ease-in-out infinite" }}>
            {cubeFront.map((p, i) => line(p, cubeFront[(i + 1) % cubeFront.length], `cube-front-${i}`, "rgba(178,236,255,0.92)", 1.75))}
            {cubeBack.map((p, i) => line(p, cubeBack[(i + 1) % cubeBack.length], `cube-back-${i}`, "rgba(178,236,255,0.72)", 1.55))}
            {cubeFront.map((p, i) => line(p, cubeBack[i], `cube-link-${i}`, "rgba(178,236,255,0.78)", 1.45))}
          </g>
          <g style={{ animation: "mvfPlatonicPulseC 9.1s ease-in-out infinite" }}>
            {line(octa[0], octa[1], "oct-a", "rgba(176,255,218,0.90)", 1.7)}
            {line(octa[1], octa[2], "oct-b", "rgba(176,255,218,0.90)", 1.7)}
            {line(octa[2], octa[3], "oct-c", "rgba(176,255,218,0.90)", 1.7)}
            {line(octa[3], octa[0], "oct-d", "rgba(176,255,218,0.90)", 1.7)}
            {line([0, 0], octa[0], "oct-e", "rgba(176,255,218,0.72)", 1.35)}
            {line([0, 0], octa[1], "oct-f", "rgba(176,255,218,0.72)", 1.35)}
            {line([0, 0], octa[2], "oct-g", "rgba(176,255,218,0.72)", 1.35)}
            {line([0, 0], octa[3], "oct-h", "rgba(176,255,218,0.72)", 1.35)}
          </g>
        </g>
        <g style={{ transformOrigin: "0px 0px", animation: "mvfMysticSolPulse 6.4s ease-in-out infinite" }}>
          <circle cx="0" cy="0" r="34" fill="url(#mvfMysticSolAura)" opacity={0.72 + glow * 0.16} />
          <circle cx="0" cy="0" r="15" fill="url(#mvfMysticSolCore)" opacity={0.96} />
          <circle cx="0" cy="0" r="8" fill="rgba(255,255,236,0.94)" />
          <g fill="none" strokeLinecap="round" style={{ mixBlendMode: "screen" }}>
            <circle cx="0" cy="0" r="24" stroke="rgba(255,230,166,0.34)" strokeWidth="1.05" strokeDasharray="2 6" style={{ transformOrigin: "0px 0px", animation: "mvfMysticSolRings 5.2s linear infinite" }} />
            <circle cx="0" cy="0" r="32" stroke="rgba(176,255,218,0.20)" strokeWidth="0.85" strokeDasharray="8 10" style={{ transformOrigin: "0px 0px", animation: "mvfMysticSolRings 6.8s linear infinite reverse" }} />
            <line x1="-39" y1="0" x2="-20" y2="0" stroke="rgba(255,234,178,0.32)" strokeWidth="0.9" />
            <line x1="20" y1="0" x2="39" y2="0" stroke="rgba(255,234,178,0.32)" strokeWidth="0.9" />
            <line x1="0" y1="-39" x2="0" y2="-20" stroke="rgba(176,255,218,0.28)" strokeWidth="0.9" />
            <line x1="0" y1="20" x2="0" y2="39" stroke="rgba(176,255,218,0.28)" strokeWidth="0.9" />
          </g>
          <g fill="none" strokeLinecap="round" stroke="rgba(244,252,255,0.42)" strokeWidth="1.1" style={{ transformOrigin: "0px 0px", animation: "mvfMysticSolSweep 3.7s linear infinite" }}>
            <path d="M 0 -45 C 10 -30 10 -15 0 0 C -10 15 -10 30 0 45" />
            <path d="M -45 0 C -30 -10 -15 -10 0 0 C 15 10 30 10 45 0" />
          </g>
        </g>
      </svg>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at center, rgba(144,206,255,0.06), transparent 52%)", animation: "mvfMetatronGhost 8.6s ease-in-out infinite" }} />
      <div style={{ position: "absolute", left: "50%", bottom: -20, transform: "translateX(-50%)", width: 230, maxWidth: "72vw", textAlign: "center", fontSize: 9, letterSpacing: "0.28em", textTransform: "uppercase", color: `rgba(174,233,255,${0.46 + glow * 0.22})`, textShadow: "0 0 12px rgba(160,220,255,0.16)" }}>
        Sol-Centered Metatron Trace
      </div>
      <div style={{ position: "absolute", left: "50%", bottom: -36, transform: "translateX(-50%)", width: 230, maxWidth: "72vw", textAlign: "center", fontSize: 8, letterSpacing: "0.20em", textTransform: "uppercase", color: `rgba(202,230,248,${0.38 + glow * 0.16})` }}>
        {headline} // {subline}
      </div>
    </div>
  );
}


function StartFocusPanel({
  panel,
  title,
  summary,
  focus,
  onFocusChange,
  urgent = false,
  children,
}: {
  panel: StartPanelId;
  title: string;
  summary: string;
  focus: StartPanelFocus;
  onFocusChange: (panel: StartPanelFocus) => void;
  urgent?: boolean;
  children: React.ReactNode;
}) {
  const focusEngaged = focus !== null;
  const focused = focus === panel;
  const active = !focusEngaged || focused;
  const compressed = focusEngaged && !focused;
  const accent = panel === "identity"
    ? "rgba(150,205,255,0.76)"
    : panel === "multiplayer"
      ? "rgba(176,255,218,0.82)"
      : "rgba(243,214,152,0.78)";
  const glow = panel === "multiplayer"
    ? "rgba(98,220,180,0.075)"
    : panel === "flight"
      ? "rgba(243,214,152,0.055)"
      : "rgba(110,190,255,0.060)";

  return (
    <section
      tabIndex={0}
      onMouseEnter={() => onFocusChange(panel)}
      onMouseLeave={() => onFocusChange(null)}
      onFocus={() => onFocusChange(panel)}
      onBlur={() => onFocusChange(null)}
      style={{
        position: "relative",
        alignSelf: "stretch",
        minHeight: compressed ? 252 : 330,
        overflow: "hidden",
        border: `1px solid ${focused ? accent : "rgba(150,205,255,0.16)"}`,
        background: `linear-gradient(180deg, rgba(4,13,20,${focused ? 0.78 : 0.58}), rgba(0,0,0,0.22))`,
        boxShadow: focused
          ? `inset 0 0 34px ${glow}, 0 0 28px ${glow}`
          : `inset 0 0 24px rgba(110,190,255,0.035), 0 0 16px rgba(110,190,255,0.020)`,
        color: "rgba(218,244,255,0.86)",
        padding: compressed ? "11px 12px" : "13px 14px",
        opacity: active ? 1 : 0.56,
        transform: focused ? "translateY(-8px)" : "translateY(0)",
        transition: "grid-template-columns 340ms ease, transform 260ms ease, opacity 220ms ease, min-height 260ms ease, border-color 220ms ease, box-shadow 260ms ease, padding 240ms ease",
        outline: "none",
      }}
    >
      <div aria-hidden style={{ position: "absolute", inset: 0, opacity: focused ? 0.16 : 0.09, backgroundImage: "linear-gradient(rgba(150,205,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(150,205,255,0.08) 1px, transparent 1px)", backgroundSize: "18px 18px", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, opacity: focused ? 0.82 : 0.32, pointerEvents: "none" }} />
      {(focused || urgent) && (
        <div aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: "-42%", width: "34%", background: "linear-gradient(90deg, transparent, rgba(255,244,206,0.18), rgba(176,255,218,0.08), transparent)", animation: "mvfPanelStarshine 1.35s ease-out 1", pointerEvents: "none" }} />
      )}

      <div style={{ position: "relative", zIndex: 1, display: "grid", gap: compressed ? 8 : 11, height: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: accent, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </div>
          <div style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(190,224,248,0.52)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: focused ? 170 : 76 }}>
            {summary}
          </div>
        </div>

        <div
          className="mvfStartPanelScroll"
          style={{
            minHeight: 0,
            maxHeight: focused ? "min(56vh, 520px)" : compressed ? 238 : "min(46vh, 430px)",
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 2,
            transition: "max-height 280ms ease",
          }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}

function VectorFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      position: "relative",
      minHeight: 248,
      border: "1px solid rgba(150,205,255,0.18)",
      boxShadow: "inset 0 0 34px rgba(100,170,230,0.055), 0 0 20px rgba(100,170,230,0.045)",
      background: "linear-gradient(180deg, rgba(5,13,22,0.52), rgba(2,7,12,0.28))",
      padding: "15px 17px 17px 17px",
      overflow: "hidden",
    }}>
      <div aria-hidden style={{ position: "absolute", inset: 8, border: "1px solid rgba(150,205,255,0.065)", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.13, pointerEvents: "none", backgroundImage: "linear-gradient(rgba(150,205,255,0.17) 1px, transparent 1px), linear-gradient(90deg, rgba(150,205,255,0.12) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
      <div aria-hidden style={{ position: "absolute", left: 0, top: 0, width: 32, height: 32, borderLeft: "1px solid rgba(176,255,218,0.30)", borderTop: "1px solid rgba(176,255,218,0.30)" }} />
      <div aria-hidden style={{ position: "absolute", right: 0, bottom: 0, width: 32, height: 32, borderRight: "1px solid rgba(243,214,152,0.24)", borderBottom: "1px solid rgba(243,214,152,0.24)" }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ marginBottom: 13, fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: "rgba(150,205,255,0.68)" }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function VectorTelemetry({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 4, borderTop: "1px solid rgba(150,205,255,0.14)", paddingTop: 8 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(150,205,255,0.56)" }}>{label}</div>
      <div style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(214,242,255,0.86)" }}>{value}</div>
    </div>
  );
}


function sanitizeMultiplayerRoomInput(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
}

function fallbackMultiplayerRoomId(value: string) {
  const clean = sanitizeMultiplayerRoomInput(value);
  return clean || "local-carrier";
}

function normalizeHailCallsign(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
}

function MultiplayerStartConsole({
  featuredGlow,
  featuredOpacity,
  featuredHeadline,
  featuredSubline,
}: {
  featuredGlow: number;
  featuredOpacity: number;
  featuredHeadline: string;
  featuredSubline: string;
}) {
  const [roomId, setRoomId] = useState(() => {
    if (typeof window === "undefined") return "mvf-carrier";
    const params = new URLSearchParams(window.location.search);
    return sanitizeMultiplayerRoomInput(params.get("mvfRoom") ?? `mvf-${Math.random().toString(36).slice(2, 7)}`);
  });
  const [hailCallsign, setHailCallsign] = useState("");
  const [hailSlot, setHailSlot] = useState<1 | 2 | 3>(1);
  const [hailStatus, setHailStatus] = useState("CARRIER COLD // NAME ROOM THEN HAIL A PILOT");
  const [connectedPads, setConnectedPads] = useState(() => getConnectedGamepadDescriptors());
  const localCountTouchedRef = useRef(false);
  const [selectedLocalCount, setSelectedLocalCount] = useState<1 | 2 | 3 | 4>(() => {
    if (typeof window !== "undefined") {
      const configured = Number(new URLSearchParams(window.location.search).get("mvfLocalPlayers"));
      if (configured === 1 || configured === 2 || configured === 3 || configured === 4) return configured;
    }
    return Math.max(1, Math.min(4, getConnectedGamepadDescriptors().length)) as 1 | 2 | 3 | 4;
  });

  useEffect(() => {
    const refresh = () => {
      const next = getConnectedGamepadDescriptors();
      setConnectedPads(next);
      const availableCount = Math.max(1, Math.min(4, next.length)) as 1 | 2 | 3 | 4;
      const configured = typeof window === "undefined" ? 0 : Number(new URLSearchParams(window.location.search).get("mvfLocalPlayers"));
      const hasConfiguredCount = configured === 1 || configured === 2 || configured === 3 || configured === 4;
      setSelectedLocalCount((current) => {
        if (!localCountTouchedRef.current && !hasConfiguredCount) return availableCount;
        return Math.min(current, availableCount) as 1 | 2 | 3 | 4;
      });
    };
    refresh();
    window.addEventListener("gamepadconnected", refresh);
    window.addEventListener("gamepaddisconnected", refresh);
    const timer = window.setInterval(refresh, 1000);
    return () => {
      window.removeEventListener("gamepadconnected", refresh);
      window.removeEventListener("gamepaddisconnected", refresh);
      window.clearInterval(timer);
    };
  }, []);

  const baseUrl = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";
  const safeRoom = fallbackMultiplayerRoomId(roomId);

  const launchUrl = (role: "host" | "guest" | "solo", slot?: 1 | 2 | 3, localPlayers: 1 | 2 | 3 | 4 = 1, autoStart = false) => {
    const params = new URLSearchParams();
    params.set("mvfRole", role);
    params.set("mvfRoom", safeRoom);
    params.set("mvfRoster", "1");
    params.set("mvfBroadcast", "0");
    params.set("mvfLocalPlayers", String(role === "guest" ? 1 : localPlayers));
    if (autoStart) params.set("mvfAutostart", "1");
    if (slot !== undefined) params.set("mvfSlot", String(slot));
    return `${baseUrl}?${params.toString()}`;
  };

  const multiplayerInputStyle: React.CSSProperties = {
    padding: "6px 8px",
    border: "1px solid rgba(150,205,255,0.24)",
    borderRadius: 0,
    background: "rgba(0,0,0,0.36)",
    color: "rgba(232,248,255,0.94)",
    fontFamily: "ui-monospace, Menlo, monospace",
    outline: "none",
  };

  const copyText = async (value: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  };

  const openHost = () => {
    if (typeof window === "undefined") return;
    setHailStatus(`HOST CARRIER ARMING // ROOM ${safeRoom}`);
    window.location.assign(launchUrl("host", undefined, selectedLocalCount));
  };

  const openLocal = (count: 1 | 2 | 3 | 4) => {
    if (typeof window === "undefined") return;
    localCountTouchedRef.current = true;
    window.location.assign(launchUrl("solo", undefined, count, true));
  };

  const hailPilot = async () => {
    const callsign = normalizeHailCallsign(hailCallsign);
    if (callsign.length !== 3) {
      setHailStatus("HAIL REJECTED // ENTER THREE-CHARACTER CALLSIGN");
      return;
    }

    const href = launchUrl("guest", hailSlot);
    const copied = await copyText(href);
    setHailStatus(copied
      ? `HAIL VECTOR READY // ${callsign} // P${hailSlot + 1} // LINK COPIED`
      : `HAIL VECTOR READY // ${callsign} // P${hailSlot + 1} // CLIPBOARD BLOCKED`);

    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "Metatron Vector Foil carrier hail",
          text: `${callsign}, join carrier room ${safeRoom} as P${hailSlot + 1}.`,
          url: href,
        });
        setHailStatus(`HAIL SENT // ${callsign} // P${hailSlot + 1}`);
      } catch {
        // User cancelled share or platform does not permit it. The copied link is still useful.
      }
    }
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div aria-hidden style={{ pointerEvents: "none", display: "grid", placeItems: "center", maxHeight: 112, overflow: "hidden", opacity: 0.72 }}>
        <GhostMetatronCube glow={featuredGlow} opacity={featuredOpacity} headline={featuredHeadline} subline={featuredSubline} />
      </div>

      <div style={{
        display: "grid",
        gap: 8,
        padding: 10,
        border: "1px solid rgba(150,205,255,0.18)",
        background: "linear-gradient(180deg, rgba(5,12,24,0.58), rgba(0,0,0,0.18))",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(150,205,255,0.76)" }}>Local Phosphor Bus</div>
          <div style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(243,214,152,0.72)" }}>{connectedPads.length} CONTROL TRACE{connectedPads.length === 1 ? "" : "S"}</div>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          {connectedPads.length === 0 ? (
            <div style={{ fontSize: 9, letterSpacing: "0.10em", color: "rgba(180,215,235,0.58)" }}>PRESS A BUTTON TO WAKE EACH CONTROLLER TRACE</div>
          ) : connectedPads.slice(0, 4).map((pad, index) => (
            <div key={`${pad.index}-${pad.id}`} style={{ display: "grid", gridTemplateColumns: "3ch 1fr auto", gap: 7, fontSize: 9, letterSpacing: "0.08em", color: "rgba(210,238,250,0.72)" }}>
              <span>P{index + 1}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pad.id}</span><span>READY</span>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6 }}>
          {([1, 2, 3, 4] as const).map((count) => {
            const enabled = count === 1 || connectedPads.length >= count;
            return (
              <button
                key={count}
                type="button"
                disabled={!enabled}
                onClick={() => { setSelectedLocalCount(count); openLocal(count); }}
                style={{ ...btnStyle, padding: "7px 5px", fontSize: 9, opacity: enabled ? 1 : 0.32, borderColor: count === selectedLocalCount ? "rgba(176,255,218,0.42)" : "rgba(150,205,255,0.20)" }}
              >
                {count === 1 ? "SOLO" : `${count}-PILOT`}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 8, letterSpacing: "0.10em", color: "rgba(176,255,218,0.66)" }}>{selectedLocalCount === 1 ? "SOLO TRACE ARMED" : `${selectedLocalCount}-PILOT CONSTELLATION ARMED`} // ENTER COMMITS THIS CONFIGURATION</div>
        <div style={{ fontSize: 8, letterSpacing: "0.10em", color: "rgba(150,205,255,0.50)" }}>CONTROLLERS ARE ASSIGNED P1→P4 IN BROWSER GAMEPAD ORDER FOR THIS RUN</div>
      </div>

      <div style={{
        display: "grid",
        gap: 8,
        padding: 10,
        border: "1px solid rgba(176,255,218,0.16)",
        background: "linear-gradient(180deg, rgba(4,17,20,0.56), rgba(0,0,0,0.18))",
        boxShadow: "inset 0 0 24px rgba(98,220,180,0.055), 0 0 18px rgba(98,220,180,0.035)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(176,255,218,0.72)" }}>
            Carrier Room
          </div>
          <div style={{ fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(243,214,152,0.70)" }}>
            {safeRoom}
          </div>
        </div>

        <input
          value={roomId}
          maxLength={24}
          spellCheck={false}
          autoComplete="off"
          aria-label="Carrier room name"
          placeholder="name carrier room"
          onChange={(e) => setRoomId(sanitizeMultiplayerRoomInput(e.target.value))}
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "7px 8px",
            border: "1px solid rgba(150,205,255,0.22)",
            borderRadius: 0,
            background: "rgba(0,0,0,0.34)",
            color: "rgba(232,248,255,0.94)",
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: 12,
            letterSpacing: "0.10em",
            outline: "none",
          }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 7, alignItems: "center" }}>
          <select value={selectedLocalCount} onChange={(event) => {
            localCountTouchedRef.current = true;
            setSelectedLocalCount(Number(event.target.value) as 1 | 2 | 3 | 4);
          }} style={{ ...multiplayerInputStyle, padding: "7px 6px", fontSize: 10 }}>
            {([1, 2, 3, 4] as const).filter((count) => count === 1 || connectedPads.length >= count).map((count) => <option key={count} value={count}>{count} LOCAL</option>)}
          </select>
          <button type="button" onClick={openHost} style={{ ...btnStyle, padding: "7px 9px", fontSize: 10, borderColor: "rgba(176,255,218,0.28)", color: "rgba(212,255,230,0.92)" }}>
            Open Host Carrier
          </button>
          <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(150,205,255,0.56)" }}>
            P1 AUTHORITY
          </span>
        </div>

        <div style={{ display: "grid", gap: 6, paddingTop: 7, borderTop: "1px solid rgba(150,205,255,0.10)" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(176,255,218,0.66)" }}>
            Hail Pilot
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "64px 76px 1fr", gap: 7, alignItems: "center" }}>
            <input
              value={hailCallsign}
              maxLength={3}
              spellCheck={false}
              autoComplete="off"
              aria-label="Hail callsign"
              placeholder="ABC"
              onChange={(e) => setHailCallsign(normalizeHailCallsign(e.target.value))}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  void hailPilot();
                }
              }}
              style={{
                ...multiplayerInputStyle,
                width: 64,
                boxSizing: "border-box",
                fontSize: 14,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            />

            <select
              value={hailSlot}
              aria-label="Guest player slot"
              onChange={(e) => setHailSlot(Number(e.target.value) as 1 | 2 | 3)}
              onKeyDown={(e) => e.stopPropagation()}
              style={{
                ...multiplayerInputStyle,
                width: 76,
                boxSizing: "border-box",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              <option value={1}>P2</option>
              <option value={2}>P3</option>
              <option value={3}>P4</option>
            </select>

            <button type="button" onClick={() => void hailPilot()} style={{ ...btnStyle, padding: "7px 9px", fontSize: 10, borderColor: "rgba(243,214,152,0.28)", color: "rgba(255,235,184,0.92)" }}>
              Hail
            </button>
          </div>
        </div>

        <div style={{ fontSize: 9, lineHeight: 1.42, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(190,224,248,0.60)" }}>
          {hailStatus}
        </div>
      </div>
    </div>
  );
}

function CallsignConsole({
  value,
  current,
  authenticated,
  authProvider,
  canChoose,
  googleAuthEnabled,
  devAuthEnabled,
  devHandle,
  message,
  onChange,
  onSubmit,
  onGoogleLogin,
  onDevHandleChange,
  onDevLogin,
  onLogout,
}: {
  value: string;
  current: string | null;
  authenticated: boolean;
  authProvider: string;
  canChoose: boolean;
  googleAuthEnabled: boolean;
  devAuthEnabled: boolean;
  devHandle: string;
  message: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onGoogleLogin: () => void;
  onDevHandleChange: (value: string) => void;
  onDevLogin: () => void;
  onLogout: () => void;
}) {
  const canSubmit = authenticated && canChoose && /^[A-Za-z0-9]{3}$/.test(value);
  const status = current
    ? `CALLSIGN ${current}`
    : authenticated
      ? "READY TO CLAIM"
      : "ANONYMOUS";
  const guidance = current
    ? "Public runs publish under this callsign."
    : authenticated
      ? "Choose exactly three letters or digits."
      : "Local runs start immediately; public runs need sign-in.";
  const authLine = authenticated ? `Signed in // ${authProvider}` : "Public board optional";
  const showMessage = Boolean(message)
    && !message.toLowerCase().startsWith("log in before")
    && !message.toLowerCase().includes("public board stores");
  return (
    <div style={{ marginTop: 14, display: "grid", gap: 9, padding: 10, border: "1px solid rgba(150,205,255,0.12)", background: "rgba(0,0,0,0.20)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(150,205,255,0.58)" }}>Callsign</div>
        <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: current ? "rgba(176,255,218,0.84)" : authenticated ? "rgba(243,214,152,0.72)" : "rgba(170,214,248,0.64)" }}>
          {status}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "rgba(170,214,248,0.60)" }}>
        <span>{authLine}</span>
        {authenticated && <button type="button" onClick={onLogout} style={{ ...btnStyle, padding: "4px 7px", fontSize: 10 }}>Logout</button>}
      </div>

      <div style={{ fontSize: 10, lineHeight: 1.45, letterSpacing: "0.08em", color: "rgba(190,224,248,0.70)" }}>
        {guidance}
      </div>

      {devAuthEnabled && !authenticated && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, border: "1px dashed rgba(243,214,152,0.22)", background: "rgba(243,214,152,0.035)" }}>
          <input
            value={devHandle}
            maxLength={48}
            spellCheck={false}
            autoComplete="off"
            aria-label="Development login handle"
            onChange={(e) => onDevHandleChange(e.target.value.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 48))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                onDevLogin();
              }
            }}
            style={{
              width: 132,
              padding: "5px 7px",
              border: "1px solid rgba(243,214,152,0.24)",
              borderRadius: 0,
              background: "rgba(0,0,0,0.36)",
              color: "rgba(232,248,255,0.94)",
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 12,
              outline: "none",
            }}
          />
          <button type="button" onClick={onDevLogin} style={{ ...btnStyle, padding: "5px 8px", fontSize: 10 }}>Dev login</button>
        </div>
      )}

      {!authenticated ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {googleAuthEnabled ? (
            <button
              type="button"
              onClick={onGoogleLogin}
              style={{
                ...btnStyle,
                padding: "7px 11px",
                fontSize: 10,
                borderColor: "rgba(176,255,218,0.30)",
                color: "rgba(212,255,230,0.92)",
                boxShadow: "0 0 16px rgba(145,255,212,0.08)",
              }}
            >
              Sign in for board
            </button>
          ) : (
            <button
              type="button"
              disabled
              style={{ ...btnStyle, opacity: 0.42, cursor: "not-allowed" }}
            >
              Board offline
            </button>
          )}
          <span style={{ fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "rgba(170,214,248,0.56)" }}>
            Play remains available.
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={value}
            maxLength={3}
            spellCheck={false}
            autoComplete="off"
            inputMode="text"
            aria-label="Three character callsign"
            disabled={!canChoose}
            onChange={(e) => onChange(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 3))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
            style={{
              width: 76,
              padding: "6px 8px",
              border: "1px solid rgba(150,205,255,0.24)",
              borderRadius: 0,
              background: "rgba(0,0,0,0.36)",
              color: "rgba(232,248,255,0.94)",
              fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 24,
              letterSpacing: "0.14em",
              textTransform: "none",
              outline: "none",
              opacity: canChoose ? 1 : 0.46,
            }}
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            style={{ ...btnStyle, opacity: canSubmit ? 1 : 0.44, cursor: canSubmit ? "pointer" : "not-allowed" }}
          >
            Claim
          </button>
        </div>
      )}

      <div style={{ fontSize: 9, lineHeight: 1.45, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(170,214,248,0.52)" }}>
        {showMessage ? message : "Public board stores callsign and score only."}
      </div>
    </div>
  );
}

function LeaderboardConsole({ entries, status, compact = false }: { entries: LeaderboardEntry[]; status: ScoreSubmitStatus; compact?: boolean }) {
  const statusText = status === "submitted"
    ? "LAST RUN PUBLISHED"
    : status === "submitting"
      ? "TRANSMITTING LAST RUN"
      : status === "needs_login"
        ? "LOGIN TO PUBLISH RUNS"
        : status === "needs_callsign"
          ? "SET CALLSIGN TO PUBLISH RUNS"
          : status === "error"
          ? "LAST RUN NOT ACCEPTED"
          : "PUBLIC HONOR BOARD";
  return (
    <div style={{ marginTop: compact ? 14 : 18, display: "grid", gap: compact ? 6 : 8, paddingTop: compact ? 10 : 12, borderTop: "1px solid rgba(150,205,255,0.12)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.24em", textTransform: "uppercase", color: "rgba(150,205,255,0.56)" }}>Top Callsigns</div>
        <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(243,214,152,0.68)" }}>{statusText}</div>
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(214,242,255,0.64)", padding: "7px 0" }}>
          No public transmissions logged.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 5 }}>
          {entries.slice(0, compact ? 3 : 5).map((entry) => (
            <div key={`${entry.rank}-${entry.callsign}-${entry.score}`} style={{ display: "grid", gridTemplateColumns: compact ? "2.2ch 4ch 1fr 4.5ch" : "2.5ch 4ch 1fr 5ch 6ch", gap: compact ? 6 : 8, alignItems: "baseline", fontSize: compact ? 11 : 12, letterSpacing: "0.08em", color: "rgba(222,242,255,0.82)" }}>
              <span style={{ color: "rgba(150,205,255,0.48)" }}>{entry.rank}</span>
              <span style={{ color: "rgba(176,255,218,0.9)", fontWeight: 700 }}>{entry.callsign}</span>
              <span style={{ textAlign: "right" }}>{entry.score.toLocaleString()}</span>
              <span style={{ color: "rgba(243,214,152,0.72)" }}>W{entry.wave}</span>
              {!compact ? <span style={{ color: "rgba(150,205,255,0.58)" }}>{formatLeaderboardTime(entry.survivalTimeSec)}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlotField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 6, paddingBottom: 12, borderBottom: "1px solid rgba(150,205,255,0.1)" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.26em", textTransform: "uppercase", color: "rgba(146,198,242,0.52)" }}>{label}</div>
      <div style={{ fontSize: 18, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(222,242,255,0.9)", textShadow: "0 0 12px rgba(165,220,255,0.14)" }}>{value}</div>
    </div>
  );
}

function DebriefOverlay({
  ui,
  headline,
  subline,
  footer,
  tertiary,
}: {
  ui: DebriefUIState;
  headline: string;
  subline: string;
  footer: string;
  tertiary: string;
}) {
  const snapshot = ui.snapshot;
  if (!snapshot) return null;
  const holdTitle = ui.phase === "game_over_hold" || ui.phase === "plotting" || ui.phase === "ready";
  const rows = [
    { label: "Cause of Loss", value: snapshot.causeLabel },
    { label: "Final Score", value: snapshot.score.toLocaleString() },
    { label: "Wave Reached", value: String(snapshot.wave) },
    { label: "Survival Time", value: formatDurationClock(snapshot.survivalTimeSec) },
    { label: "Best Flight Chain", value: `${snapshot.bestChain.toFixed(2)}x` },
    { label: "Top Citation", value: snapshot.topCitation },
    { label: "Spheres Awakened", value: `${snapshot.spheresAwakened} // TREE LIT ${snapshot.totalSpheresLit}/12` },
    { label: "Flight Trace", value: `${snapshot.bestShotDistance.toFixed(0)}M SHOT // ${snapshot.peakPseudoG.toFixed(1)}G PEAK // ${snapshot.furthestRadius.toFixed(0)}R OUT` },
  ];
  const visibleRows = rows.slice(0, ui.visibleRows);
  const promptVisible = ui.phase === "ready";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        color: "rgba(220,242,255,0.92)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: "8vh 8vw",
        display: "grid",
        alignContent: "center",
        justifyItems: "center",
        gap: 18,
      }}
    >
      {holdTitle && (
        <div style={{ display: "grid", gap: 12, textAlign: "center", justifyItems: "center", minHeight: 120 }}>
          <div style={{ fontSize: 44, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(234,246,255,0.94)", textShadow: "0 0 18px rgba(170,220,255,0.2)" }}>{headline}</div>
          <div style={{ fontSize: 12, letterSpacing: "0.32em", textTransform: "uppercase", color: "rgba(244,216,160,0.76)", textShadow: "0 0 12px rgba(244,216,160,0.12)" }}>{subline}</div>
        </div>
      )}

      {(ui.phase === "plotting" || ui.phase === "ready") && (
        <div style={{ width: "min(760px, 72vw)", display: "grid", gap: 14 }}>
          {visibleRows.map((row) => <PlotField key={row.label} label={row.label} value={row.value} />)}
        </div>
      )}

      {promptVisible && (
        <div style={{ marginTop: 24, display: "grid", gap: 8, justifyItems: "center", textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.26em", textTransform: "uppercase", color: "rgba(146,198,242,0.52)" }}>{tertiary}</div>
          <div style={{ fontSize: 16, letterSpacing: "0.22em", textTransform: "uppercase", color: "rgba(176,255,218,0.86)", textShadow: "0 0 14px rgba(145,255,212,0.18)" }}>{footer}</div>
        </div>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,.45)", backdropFilter: "blur(10px)",
      color: "rgba(255,255,255,.92)",
      padding: 18,
    }}>
      <div style={{
        width: "min(860px, 94vw)",
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,.12)",
        background: "rgba(255,255,255,.06)",
        boxShadow: "0 24px 80px rgba(0,0,0,.55)",
        padding: 18,
      }}>
        {children}
      </div>
    </div>
  );
}

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: "2px 8px",
      borderRadius: 8,
      border: "1px solid rgba(255,255,255,.18)",
      background: "rgba(0,0,0,.25)",
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 12,
    }}>
      {children}
    </span>
  );
}

function SliderRow(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.9 }}>
        <span>{props.label}</span>
        <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{formatNum(props.value)}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <input type="checkbox" checked={props.checked} onChange={props.onChange} />
      <span style={{ opacity: 0.9 }}>{props.label}</span>
    </label>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,.16)",
  background: "rgba(0,0,0,.35)",
  color: "rgba(255,255,255,.92)",
  cursor: "pointer",
};

type RenderMultiplayerPlayer = {
  id: PlayerId;
  slot: PlayerSlotIndex;
  role: MultiplayerRole;
  callsign?: string | null;
  lifeState: PlayerLifeState;
  connected: boolean;
  isLocal: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  fuel: number;
  hitsTaken: number;
  thrustGlow: number;
  trail: V2[];
  lastInputSeq: number;
};

type RenderMultiplayerState = {
  role: MultiplayerRole;
  roomId: string;
  localPlayerId: PlayerId;
  showRoster: boolean;
  transportPeers: number;
  queuedInbound: number;
  sent: number;
  received: number;
  players: RenderMultiplayerPlayer[];
};

// ===================== RENDERING + CAMERA =====================
function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dpr: number,
  S: {
    mode: GameMode;
    level: Level;
    player: { pos: V2; vel: V2; angle: number; angularVel: number; thrust: number; brakeAnim: number; thrustGlow: number; inActivatedSphere: boolean; fuel: number; stuckTime: number; hitsTaken: number; hitInvuln: number };
    camera: { pos: V2; zoom: number };
    meta: { ax: number; ay: number; az: number; alignT: number; centers3: V3[]; nodes: MetaNode[]; pulseClock: number };
    oort: { clusters: OortCluster[]; timeSec: number };
    entities: { bullets: Bullet[]; enemies: Enemy[]; shards: Shard[]; fuelBits: FuelBit[]; trail: V2[] };
    toggles: { metatron: boolean; trails: boolean; debug: boolean };
    horizonR: number;
    oortInner: number;
    oortOuter: number;
    waveBannerTimer: number;
    waveBannerText: string;
    multiplayer: RenderMultiplayerState;
    debrief: { phase: DebriefPhase; phaseElapsedMs: number; snapshot: DebriefSnapshot | null };
  }
) {
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const burnT = S.mode === "debrief" && S.debrief.phase === "burn_fade"
    ? clamp(S.debrief.phaseElapsedMs / DEBRIEF_SEQUENCE.burnFadeMs, 0, 1)
    : (S.mode === "debrief" ? 1 : 0);
  const worldAlpha = S.mode === "debrief" ? Math.pow(1 - burnT, 0.58) : 1;
  const lineAlpha = S.mode === "debrief" ? Math.pow(1 - burnT, 0.82) : 1;

  // background
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = S.mode === "debrief" ? `rgba(5,6,10,${0.22 + burnT * 0.78})` : (S.toggles.trails ? `rgba(5,6,10,${T.BG_FADE})` : "#05060a");
  ctx.fillRect(0, 0, w, h);

  // camera transform (center at star)
  ctx.setTransform(dpr * S.camera.zoom, 0, 0, dpr * S.camera.zoom, 0, 0);
  ctx.translate(w / (2 * S.camera.zoom), h / (2 * S.camera.zoom));
  ctx.translate(-S.camera.pos.x, -S.camera.pos.y);

  // rings
  ctx.save();
  ctx.globalAlpha = lineAlpha;
  ctx.lineWidth = 2 / S.camera.zoom;
  ctx.strokeStyle = "rgba(255,160,180,0.22)";
  ctx.beginPath(); arcSafe(ctx, 0, 0, S.horizonR); ctx.stroke();
  ctx.restore();

  // oort band hint
  ctx.save();
  ctx.globalAlpha = lineAlpha * 0.85;
  ctx.lineWidth = 1 / S.camera.zoom;
  ctx.strokeStyle = "rgba(190,225,255,0.06)";
  ctx.beginPath(); arcSafe(ctx, 0, 0, S.oortOuter); ctx.stroke();
  ctx.restore();

  // procedural Oort cloud: hundreds of cheap three-node orbiting constellations.
  // They look abundant, but only nearby/bullet-touched clusters are checked in the physics step.
  if (T.OORT_CONSTELLATIONS_ENABLED && S.oort.clusters.length > 0) {
    ctx.save();
    ctx.globalAlpha = lineAlpha;
    ctx.lineCap = "round";
    const timeSec = S.oort.timeSec;
    for (const c of S.oort.clusters) {
      const center = oortClusterCenter(c, timeSec);
      const dPlayer = center.copy().sub(S.player.pos).len();
      const near = 1 - smoothstep(0, T.OORT_NEAR_PLAYER_BRIGHTEN_RADIUS, dPlayer);
      const pulse = c.pulseUntil > timeSec ? clamp((c.pulseUntil - timeSec) / 0.72, 0, 1) : 0;
      const broken = c.brokenUntil > timeSec;
      const reformWindow = Math.max(0.001, T.OORT_REFORM_SECONDS * 0.30);
      const reformT = broken ? clamp(1 - (c.brokenUntil - timeSec) / reformWindow, 0, 1) : 1;
      const visibility = broken ? (0.10 + 0.32 * reformT + 0.55 * pulse) : 1;
      if (visibility <= 0.035) continue;

      const pts = oortClusterNodes(c, timeSec);
      const lineA = (T.OORT_LINE_ALPHA * c.brightness + near * 0.11 + pulse * 0.28) * visibility;
      const nodeA = (T.OORT_NODE_ALPHA * c.brightness + near * 0.24 + pulse * 0.45) * visibility;
      ctx.lineWidth = (0.62 + near * 0.45 + pulse * 1.15) / S.camera.zoom;
      ctx.strokeStyle = `hsla(${Math.round(c.hue)},95%,76%,${lineA})`;
      ctx.beginPath();
      for (const [ai, bi] of oortClusterLinks(c)) {
        const a = pts[ai];
        const b = pts[bi];
        if (!a || !b) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      for (const p of pts) {
        const r = (T.OORT_NODE_VISUAL_RADIUS + near * 1.6 + pulse * 2.6) / S.camera.zoom;
        ctx.fillStyle = `hsla(${Math.round(c.hue)},95%,80%,${nodeA})`;
        ctx.beginPath(); arcSafe(ctx, p.x, p.y, r); ctx.fill();
        if (near > 0.02 || pulse > 0.02) {
          ctx.strokeStyle = `hsla(${Math.round(c.hue)},95%,86%,${Math.min(0.52, nodeA * 0.9)})`;
          ctx.lineWidth = (0.72 + pulse * 0.85) / S.camera.zoom;
          ctx.beginPath(); arcSafe(ctx, p.x, p.y, r * (2.2 + pulse * 2.0)); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // star
  ctx.save();
  ctx.globalAlpha = worldAlpha;
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, T.STAR_RADIUS * 2.2);
  grad.addColorStop(0, "rgba(255,255,230,0.80)");
  grad.addColorStop(0.2, "rgba(255,210,150,0.25)");
  grad.addColorStop(1, "rgba(255,180,120,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); arcSafe(ctx, 0, 0, T.STAR_RADIUS); ctx.fill();
  ctx.fillStyle = "rgba(255,250,220,0.92)";
  ctx.beginPath(); arcSafe(ctx, 0, 0, T.STAR_COLLISION_RADIUS); ctx.fill();
  ctx.strokeStyle = "rgba(255,230,180,0.28)";
  ctx.lineWidth = 0.85 / S.camera.zoom;
  ctx.beginPath(); arcSafe(ctx, 0, 0, T.STAR_COLLISION_RADIUS); ctx.stroke();
  ctx.restore();

  // metatron (animated)
  if (S.toggles.metatron) {
    const alignT = smoothstep(0, 1, S.meta.alignT);
    const tiltT = 1 - alignT;
    const C2: { x: number; y: number }[] = [];
    for (const v0 of S.meta.centers3) {
      let v = new V3(v0.x, v0.y, v0.z * tiltT);
      v = rotX(v, S.meta.ax * tiltT);
      v = rotY(v, S.meta.ay * tiltT);
      v = rotZ(v, S.meta.az);
      C2.push(project(v, 1, 220 / 240));
    }

    // awakened connections: the cube is revealed by play, not merely drawn at it
    const t = S.meta.pulseClock;
    ctx.save();
    ctx.globalAlpha = lineAlpha;
    ctx.lineCap = "round";
    for (const [i, j] of MET_EDGES) {
      const nodeA = S.meta.nodes[i];
      const nodeB = S.meta.nodes[j];
      if (!isMetaNodeLit(nodeA) || !isMetaNodeLit(nodeB)) continue;
      const a = C2[i], b = C2[j];
      if (!a || !b) continue;
      const ageA = nodeA ? t - nodeA.activatedAt : Infinity;
      const ageB = nodeB ? t - nodeB.activatedAt : Infinity;
      const pulseAge = Math.min(ageA, ageB);
      const pulseT = pulseAge >= 0 && pulseAge <= T.META_LINE_PULSE_SEC
        ? 1 - pulseAge / T.META_LINE_PULSE_SEC
        : 0;
      ctx.lineWidth = (T.META_LINE_WIDTH + T.META_LINE_PULSE_WIDTH * pulseT) / S.camera.zoom;
      ctx.strokeStyle = `rgba(185,225,255,${T.META_LINE_ALPHA + T.META_LINE_PULSE_ALPHA * pulseT})`;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();

    // circles / spheres
    ctx.save();
    ctx.globalAlpha = worldAlpha;
    for (let i = 0; i < C2.length; i++) {
      const c = C2[i];
      const node = S.meta.nodes[i];
      const pulse = 0.12 + 0.05 * Math.sin((t + i * 0.37) * (TAU / T.META_SPHERE_PULSE));
      const active = isMetaNodeLit(node);
      const overcharged = !!node && node.overcharged;
      const sphereStrength = node ? clamp(node.charge / T.META_NODE_MAX_CHARGE_SEC, 0, 1) : 0;

      if (active) {
        const r = T.META_CIRCLE_RADIUS * (0.96 + pulse * 0.45);
        const isCenter = !!node && node.kind === "center";

        if (isCenter) {
          // The center node is Sol's location. Keep the geometry legible, but do not
          // draw it as another self-luminous sphere on top of the actual star.
          ctx.fillStyle = `rgba(150,190,240,${T.META_SPHERE_CENTER_FILL_ALPHA})`;
          ctx.beginPath(); arcSafe(ctx, c.x, c.y, r); ctx.fill();
          ctx.lineWidth = 1.0 / S.camera.zoom;
          ctx.strokeStyle = `rgba(205,232,255,${0.08 + sphereStrength * 0.04})`;
          ctx.beginPath(); arcSafe(ctx, c.x, c.y, r); ctx.stroke();
        } else {
          const sol = C2[0] ?? { x: 0, y: 0 };
          const lightDir = new V2(sol.x - c.x, sol.y - c.y);
          if (lightDir.len() < 0.001) lightDir.x = -1;
          lightDir.norm();

          // Directional illumination: bright toward Sol, dim and shadowed away from Sol.
          // These are not little suns; they are spheres catching the central light.
          const overchargeBoost = overcharged ? 1.18 : 1.0;
          const litAlpha = T.META_SPHERE_LIGHT_ALPHA * overchargeBoost + sphereStrength * 0.0175;
          const shadowAlpha = T.META_SPHERE_SHADOW_ALPHA + sphereStrength * 0.0125;
          const litX = c.x + lightDir.x * r;
          const litY = c.y + lightDir.y * r;
          const darkX = c.x - lightDir.x * r;
          const darkY = c.y - lightDir.y * r;

          const g = ctx.createLinearGradient(litX, litY, darkX, darkY);
          g.addColorStop(0.00, `rgba(225,244,255,${litAlpha})`);
          g.addColorStop(0.22, `rgba(175,215,245,${litAlpha * 0.58})`);
          g.addColorStop(0.52, `rgba(85,120,155,${litAlpha * 0.18})`);
          g.addColorStop(0.82, `rgba(9,15,28,${shadowAlpha * 0.74})`);
          g.addColorStop(1.00, `rgba(2,5,12,${shadowAlpha})`);
          ctx.fillStyle = g;
          ctx.beginPath(); arcSafe(ctx, c.x, c.y, r); ctx.fill();

          const shadow = ctx.createRadialGradient(
            darkX * 0.42 + c.x * 0.58,
            darkY * 0.42 + c.y * 0.58,
            r * 0.10,
            darkX * 0.18 + c.x * 0.82,
            darkY * 0.18 + c.y * 0.82,
            r * 1.06
          );
          shadow.addColorStop(0.0, `rgba(1,4,11,${shadowAlpha * 0.55})`);
          shadow.addColorStop(0.62, `rgba(1,4,11,${shadowAlpha * 0.20})`);
          shadow.addColorStop(1.0, "rgba(1,4,11,0)");
          ctx.fillStyle = shadow;
          ctx.beginPath(); arcSafe(ctx, c.x, c.y, r); ctx.fill();

          const lightAngle = Math.atan2(lightDir.y, lightDir.x);
          ctx.lineWidth = 0.95 / S.camera.zoom;
          ctx.strokeStyle = `rgba(185,225,255,${0.05 + sphereStrength * 0.04})`;
          ctx.beginPath(); arcSafe(ctx, c.x, c.y, r); ctx.stroke();

          ctx.lineWidth = 1.25 / S.camera.zoom;
          ctx.strokeStyle = `rgba(230,248,255,${T.META_SPHERE_RIM_ALPHA * overchargeBoost + sphereStrength * 0.035})`;
          ctx.beginPath(); ctx.arc(c.x, c.y, r, lightAngle - Math.PI * 0.58, lightAngle + Math.PI * 0.58); ctx.stroke();

          ctx.lineWidth = 0.85 / S.camera.zoom;
          ctx.strokeStyle = `rgba(20,35,58,${0.09 + shadowAlpha * 0.225})`;
          ctx.beginPath(); ctx.arc(c.x, c.y, r, lightAngle + Math.PI * 0.58, lightAngle + Math.PI * 1.42); ctx.stroke();
        }
      } else {
        ctx.lineWidth = 0.9 / S.camera.zoom;
        ctx.strokeStyle = `rgba(170,210,255,${0.12 + pulse * 0.6})`;
        ctx.beginPath(); arcSafe(ctx, c.x, c.y, T.META_CIRCLE_RADIUS * (1.0 + pulse * 0.15)); ctx.stroke();
      }

    }
    ctx.restore();
  }

  // fuel bits
  ctx.save();
  ctx.globalAlpha = worldAlpha;
  for (const b of S.entities.fuelBits) {
    ctx.fillStyle = `hsla(${Math.round(b.hue)},90%,70%,0.18)`;
    ctx.beginPath(); arcSafe(ctx, b.pos.x, b.pos.y, 12 / S.camera.zoom); ctx.fill();
    ctx.strokeStyle = `hsla(${Math.round(b.hue)},90%,75%,0.28)`;
    ctx.lineWidth = 1 / S.camera.zoom;
    ctx.beginPath(); arcSafe(ctx, b.pos.x, b.pos.y, 3.2 / S.camera.zoom); ctx.stroke();
  }
  ctx.restore();

  // shrapnel
  ctx.save();
  ctx.globalAlpha = worldAlpha;
  for (const s of S.entities.shards) {
    const a = clamp(s.life / s.life0, 0, 1);
    const stroke = `hsla(${Math.round(s.hue)},90%,75%,${0.22 + 0.62 * a})`;
    ctx.lineWidth = Math.max(0.8, s.size) / S.camera.zoom;
    ctx.strokeStyle = stroke;
    const tail = s.vel.copy().mul(-0.015);
    ctx.beginPath(); ctx.moveTo(s.pos.x, s.pos.y); ctx.lineTo(s.pos.x + tail.x, s.pos.y + tail.y); ctx.stroke();

    ctx.save();
    ctx.translate(s.pos.x, s.pos.y);
    ctx.rotate(s.ang);
    const sz = s.size / S.camera.zoom;
    ctx.beginPath();
    ctx.moveTo(sz, 0); ctx.lineTo(-0.6 * sz, 0.6 * sz); ctx.lineTo(-0.6 * sz, -0.6 * sz); ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // enemies
  ctx.save();
  ctx.globalAlpha = lineAlpha;
  for (const e of S.entities.enemies) {
    const proj: { x: number; y: number }[] = [];
    const squash = Math.sin(Math.PI * clamp(e.morph, 0, 1));
    const yScale = e.morphing ? (1 - 0.34 * squash) : 1;
    const zScale = e.morphing ? Math.max(0.08, 1 - 0.92 * squash) : 1;
    for (const v0 of e.mesh.verts) {
      let v = v0;
      v = rotX(v, e.ax); v = rotY(v, e.ay); v = rotZ(v, e.az);
      v = new V3(v.x, v.y * yScale, v.z * zScale);
      const p = project(v, 1, 4);
      proj.push({ x: e.pos.x + p.x, y: e.pos.y + p.y });
    }
    ctx.strokeStyle = `hsla(${e.hue},80%,70%,0.85)`;
    ctx.lineWidth = 1.15 / S.camera.zoom;
    ctx.beginPath();
    for (const [i, j] of e.mesh.edges) {
      const a = proj[i], b = proj[j];
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // bullets
  ctx.save();
  ctx.globalAlpha = worldAlpha;
  ctx.lineWidth = 2 / S.camera.zoom;
  ctx.strokeStyle = "rgba(255,255,200,0.88)";
  ctx.beginPath();
  for (const b of S.entities.bullets) {
    const tail = b.vel.copy().mul(-T.BULLET_TAIL);
    ctx.moveTo(b.pos.x, b.pos.y);
    ctx.lineTo(b.pos.x + tail.x, b.pos.y + tail.y);
  }
  ctx.stroke();
  ctx.restore();

  // Every corsair owns its own phosphor trace. The traces use the same slot
  // identity as the hulls so couch and online pilots remain distinguishable.
  for (const pilot of S.multiplayer.players) {
    if (!pilot.connected || pilot.lifeState !== "alive") continue;
    drawPlayerTrail(ctx, S.camera.zoom, pilot, worldAlpha);
  }

  // remote player ships
  ctx.save();
  ctx.globalAlpha = worldAlpha;
  for (const remote of S.multiplayer.players) {
    // P1 is rendered by the primary ship path below. Other locally controlled
    // couch ships still use this multiplayer ship renderer.
    if (remote.id === S.multiplayer.localPlayerId) continue;
    if (!remote.connected || remote.lifeState !== "alive") continue;
    drawRemotePlayerShip(ctx, S.camera.zoom, remote);
  }
  ctx.restore();

  // The primary hull is a live gameplay entity, not a permanent HUD marker.
  // Once destroyed it disappears while the surviving constellation continues.
  const primaryPilot = S.multiplayer.players.find((pilot) => pilot.id === S.multiplayer.localPlayerId);
  if (!primaryPilot || primaryPilot.lifeState === "alive") {
    ctx.save();
    ctx.globalAlpha = worldAlpha;
    ctx.translate(S.player.pos.x, S.player.pos.y);
    ctx.rotate(S.player.angle);
    ctx.lineWidth = 2.2 / S.camera.zoom;
    const hitFlash = S.player.hitInvuln > 0 && Math.floor(performance.now() / 60) % 2 === 0;
    ctx.strokeStyle = hitFlash ? "rgba(255,240,200,0.98)" : "rgba(120,255,200,0.95)";
    const brakeOpen = T.BRAKE_UNFOLD_ENABLED ? clamp(S.player.brakeAnim, 0, 1) * T.BRAKE_UNFOLD_AMOUNT : 0;
    const rearX = -10 - brakeOpen * 2.5;
    const innerX = -6 + brakeOpen * 3.5;
    const wingY = 7 + brakeOpen * 8.0;
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(rearX, -wingY); ctx.lineTo(innerX, 0); ctx.lineTo(rearX, wingY); ctx.closePath();
    ctx.stroke();

    if (brakeOpen > 0.035 && T.BRAKE_WAKE_LINES_ENABLED) {
      const wakeAlpha = T.BRAKE_WAKE_INTENSITY * brakeOpen;
      ctx.strokeStyle = `rgba(205,240,255,${0.20 * wakeAlpha})`;
      ctx.lineWidth = (1.0 + brakeOpen * 1.1) / S.camera.zoom;
      ctx.beginPath();
      ctx.moveTo(-2, -wingY * 0.55); ctx.lineTo(rearX - 10 - 6 * brakeOpen, -wingY * 1.15);
      ctx.moveTo(-2, wingY * 0.55); ctx.lineTo(rearX - 10 - 6 * brakeOpen, wingY * 1.15);
      ctx.stroke();
      ctx.strokeStyle = `rgba(120,255,220,${0.18 * wakeAlpha})`;
      ctx.beginPath();
      ctx.moveTo(rearX - 2, -wingY * 0.62); ctx.quadraticCurveTo(rearX - 15, -wingY * 0.30, rearX - 26, -wingY * 0.80);
      ctx.moveTo(rearX - 2, wingY * 0.62); ctx.quadraticCurveTo(rearX - 15, wingY * 0.30, rearX - 26, wingY * 0.80);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMultiplayerRosterOverlay(ctx, dpr, w, h, S.multiplayer);
}

function remotePlayerHue(slot: PlayerSlotIndex) {
  return [165, 205, 285, 38][slot] ?? 165;
}

function drawPlayerTrail(
  ctx: CanvasRenderingContext2D,
  cameraZoom: number,
  pilot: RenderMultiplayerPlayer,
  worldAlpha: number,
) {
  if (pilot.trail.length < 2) return;
  const hue = remotePlayerHue(pilot.slot);
  ctx.save();
  ctx.globalAlpha = worldAlpha;
  ctx.lineWidth = 1.2 / cameraZoom;
  ctx.strokeStyle = `hsla(${hue},92%,74%,${T.TRAIL_ALPHA})`;
  ctx.beginPath();
  for (let i = 0; i < pilot.trail.length; i++) {
    const point = pilot.trail[i];
    if (i === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.restore();

  if (!T.THRUST_TRAIL_GLOW_ENABLED || pilot.thrustGlow <= 0.02 || pilot.trail.length <= 2) return;
  ctx.save();
  ctx.globalAlpha = worldAlpha;
  ctx.lineCap = "round";
  const count = Math.min(T.THRUST_TRAIL_GLOW_POINTS, pilot.trail.length - 1);
  const start = pilot.trail.length - count;
  for (let i = Math.max(1, start); i < pilot.trail.length; i++) {
    const p0 = pilot.trail[i - 1];
    const p1 = pilot.trail[i];
    const k = (i - start) / Math.max(1, count);
    const alpha = pilot.thrustGlow * T.THRUST_TRAIL_GLOW_INTENSITY * Math.pow(k, 2.25);
    ctx.strokeStyle = `hsla(${hue},95%,82%,${alpha})`;
    ctx.lineWidth = (1.6 + 4.8 * pilot.thrustGlow * k) / cameraZoom;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRemotePlayerShip(ctx: CanvasRenderingContext2D, cameraZoom: number, remote: RenderMultiplayerPlayer) {
  const hue = remotePlayerHue(remote.slot);
  const alpha = 0.84;
  ctx.save();
  ctx.translate(remote.x, remote.y);
  ctx.rotate(remote.angle);
  ctx.lineWidth = 1.8 / cameraZoom;
  ctx.strokeStyle = `hsla(${hue},92%,74%,${alpha})`;
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-9, -7);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-9, 7);
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = `hsla(${hue},95%,78%,${alpha * 0.35})`;
  ctx.lineWidth = 0.9 / cameraZoom;
  ctx.beginPath();
  ctx.arc(0, 0, 18 / cameraZoom, 0, TAU);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = `${Math.max(8, 10 / cameraZoom)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillStyle = `hsla(${hue},95%,78%,${alpha})`;
  ctx.textAlign = "center";
  ctx.fillText(`P${remote.slot + 1}`, remote.x, remote.y - 20 / cameraZoom);
  ctx.restore();
}

function drawMultiplayerRosterOverlay(ctx: CanvasRenderingContext2D, dpr: number, w: number, h: number, multiplayer: RenderMultiplayerState) {
  if (!multiplayer.showRoster) return;
  const rows = multiplayer.players.slice().sort((a, b) => a.slot - b.slot);
  const x = Math.max(18, w - 330);
  const y = 18;
  const rowH = 17;
  const boxH = 58 + rows.length * rowH;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "rgba(3,8,14,0.58)";
  ctx.strokeStyle = "rgba(130,220,255,0.20)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, 312, boxH, 14);
  ctx.fill();
  ctx.stroke();

  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "rgba(210,240,255,0.88)";
  ctx.fillText(`MULTIPLAYER TEST // ${multiplayer.role.toUpperCase()} // ROOM ${multiplayer.roomId}`, x + 14, y + 20);
  ctx.fillStyle = "rgba(145,205,230,0.68)";
  ctx.fillText(`PEERS ${multiplayer.transportPeers}  SENT ${multiplayer.sent}  RECV ${multiplayer.received}  Q ${multiplayer.queuedInbound}`, x + 14, y + 38);

  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const py = y + 58 + i * rowH;
    const hue = remotePlayerHue(p.slot);
    const status = p.lifeState === "alive" ? "ONLINE" : p.lifeState === "respawn-pending" ? "RESPAWN" : p.lifeState.toUpperCase();
    ctx.fillStyle = `hsla(${hue},95%,75%,${p.connected ? 0.88 : 0.38})`;
    ctx.fillText(`P${p.slot + 1}`, x + 14, py);
    ctx.fillStyle = p.isLocal ? "rgba(176,255,218,0.92)" : "rgba(210,235,255,0.74)";
    const label = `${p.id}${p.isLocal ? " *" : ""}`.slice(0, 24);
    ctx.fillText(label, x + 48, py);
    ctx.fillStyle = "rgba(145,205,230,0.68)";
    ctx.fillText(status, x + 220, py);
  }
  ctx.restore();
}

function updateCamera(
  camera: { pos: V2; zoom: number },
  canvas: HTMLCanvasElement,
  dpr: number,
  ships: Array<{ pos: V2; vel: V2 }>,
  horizonR: number,
) {
  camera.pos.x = 0;
  camera.pos.y = 0;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const pad = T.CAMERA_PAD_PX;
  let ax = 0;
  let ay = 0;
  let furthest = ships[0] ?? { pos: new V2(0, 0), vel: new V2(0, 0) };
  for (const ship of ships) {
    ax = Math.max(ax, Math.abs(ship.pos.x));
    ay = Math.max(ay, Math.abs(ship.pos.y));
    if (ship.pos.len() > furthest.pos.len()) furthest = ship;
  }
  const zX = w / (2 * (ax + pad));
  const zY = h / (2 * (ay + pad));
  const keepZoom = clamp(Math.min(zX, zY), T.CAMERA_ZOOM_FLOOR, T.CAMERA_ZOOM_CEIL);
  const dist = furthest.pos.len();
  const base = 1 / (1 + dist / (horizonR * 0.55));
  const sp = Math.max(...ships.map((ship) => ship.vel.len()), 0);
  const spZoom = 1 / (1 + sp / (T.MAX_SPEED * 0.85));
  const aesthetic = clamp(base * 0.72 + spZoom * 0.28, T.CAMERA_ZOOM_FLOOR, T.CAMERA_ZOOM_CEIL);
  const target = Math.min(keepZoom, lerp(keepZoom, aesthetic, T.CAMERA_AESTHETIC));
  camera.zoom = clamp(lerp(camera.zoom, target, T.CAMERA_LERP), T.CAMERA_ZOOM_FLOOR, T.CAMERA_ZOOM_CEIL);
}

function formatDurationClock(totalSeconds: number) {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatNum(v: number) {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
