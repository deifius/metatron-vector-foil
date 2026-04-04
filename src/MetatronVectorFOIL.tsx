import React, { useEffect, useRef, useState } from "react";

/**
 * Metatron Vector FOIL
 * - Canvas + fixed-timestep physics
 * - Start screen, pause sliders, level progression via "alignment door"
 * - WebAudio wavetable SFX
 */

// ===================== TUNABLES =====================
const T = {
  // World
  META_RADIUS: 120,                    // central Metatron circle radius (world units)
  HORIZON_MULT: 2.0,                   // red ring radius multiplier
  OORT_INNER_MULT: 1.28,               // fuel-bit settlement inner band
  OORT_OUTER_MULT: 1.55,               // fuel-bit settlement outer band
  STAR_RADIUS: 14,                     // visible star radius (world units)
  STAR_TRAP_RADIUS: 18,                // "stuck in well" radius threshold (world units)
  STAR_TRAP_TIME: 3.0,                 // seconds stuck before explode/restart

  // Physics
  GRAVITY_GM: 1_150_000,               // gravity strength (GM)
  GRAVITY_SOFTEN: 22,                  // softening distance to avoid singularity
  MAX_SPEED: 7500,                     // hard speed clamp (world units/s)
  FIXED_DT: 1 / 120,                   // fixed timestep for stability
  SUBSTEPS_MAX: 8,                     // max fixed steps per frame to avoid spiral of death

  // Player
  SHIP_MASS: 26.0,                     // ship mass (higher = more inertia)
  ROT_SPEED: 3.6,                      // ship rotation speed (rad/s)
  THRUST_FORCE: 1900,                  // engine thrust (force units)
  BRAKE_COEFF: 0.97,                  // braking drag coefficient applied per fixed step
  DRAG: 0.0,                           // should remain 0 (user request)
  ORBIT_GAIN: 1.03,                    // initial tangential velocity multiplier
  FUEL_MAX: 100,                       // fuel capacity
  FUEL_BURN: 16.0,                     // fuel burn per second @ full thrust
  FUEL_REGEN_INNER: 10.0,              // fuel regen per second inside red ring
  FUEL_REGEN_OUTER: 0.0,               // regen outside ring (keep 0)
  FUEL_PICKUP_AMOUNT: 12.0,            // fuel gained per collected bit

  // Solar sail (light pressure)
  SOLAR_PRESSURE: 210_000,             // strength of light pressure (tune)
  SOLAR_ANGLE_GAIN: 0.55,              // how much sail angle produces tangential push (0..1)

  // Camera
  CAMERA_LERP: 0.14,                   // camera zoom smoothing
  CAMERA_ZOOM_FLOOR: 0.125,            // min zoom so scene never vanishes
  CAMERA_ZOOM_CEIL: 3.0,               // max zoom to avoid jitter
  CAMERA_PAD_PX: 56,                   // screen-space padding for keep-in-view
  CAMERA_AESTHETIC: 0.55,              // blend weight toward aesthetic zoom (0..1)

  // Visuals
  TRAIL_SAMPLES: 2400,                 // contrail length (points)
  TRAIL_ALPHA: 0.33,                   // contrail alpha
  BG_FADE: 0.16,                       // background fade strength when trails on
  DEBUG_TEXT: true,                    // show debug overlay toggle default

  // Weapons
  FIRE_RATE: 0.32,                     // seconds between shots
  BULLET_SPEED: 800,                  // bullet speed
  BULLET_LIFE: 4.2,                    // bullet lifetime seconds
  BULLET_RADIUS: 4.0,                  // bullet collision radius against wireframe edges
  BULLET_TAIL: 0.024,                  // tail length factor

  // Enemies
  ENEMY_MAX: 5,                        // max enemies on screen
  ENEMY_SPAWN_BASE: 0.9,               // base spawn interval
  ENEMY_SPAWN_MIN: 0.35,               // minimum spawn interval at higher levels
  ENEMY_SPEED: 100,                    // base enemy drift speed
  ENEMY_SPAWN_RADIUS_INNER_MULT: 1.6,  // enemy spawn shell inner radius, measured from Oort outer edge
  ENEMY_SPAWN_RADIUS_OUTER_MULT: 1.9,  // enemy spawn shell outer radius, measured from Oort outer edge
  ENEMY_STEER: 140,                    // inward acceleration toward Sol
  ENEMY_ORBIT_BIAS: 0.75,              // tendency to spiral rather than beeline
  ENEMY_PLAYER_BIAS: 0.18,             // slight ship-seeking influence while still diving inward
  ENEMY_GRAVITY_MULT: 1.1,             // extra stellar pull on enemies
  ENEMY_HIT_RADIUS_MULT: 1.25,         // player collision radius multiplier against enemies
  ENEMY_COLLAPSE_RATE: 1.25,           // solid downgrade morph speed
  SHIP_HIT_RADIUS: 10,                 // player hit radius
  SHARD_HIT_RADIUS_PAD: 2.5,           // extra shard collision padding
  SHRAPNEL_COUNT_MIN: 2,               // min shrapnel on hit
  SHRAPNEL_COUNT_MAX: 8,              // max shrapnel on hit
  SHRAPNEL_SPEED_MIN: 120,             // shrapnel speed min
  SHRAPNEL_SPEED_MAX: 300,             // shrapnel speed max
  SHRAPNEL_GRAVITY_MULT: 4.0,          // shard gravity multiplier
  SHRAPNEL_PARENT_VEL: 0.6,            // how much parent velocity shards inherit
  SHRAPNEL_LIFE_MIN: 1.9,              // shrapnel life min
  SHRAPNEL_LIFE_MAX: 10.9,              // shrapnel life max

  // Metatron animation
  META_BASE_SPIN: 0.06,                // base spin
  META_SPIN_GAIN: 0.32,                // spin increases with distance
  META_DWELL: 0.82,                    // dwell damping toward readable pose
  META_SPHERE_PULSE: 8.0,              // seconds per pulse
  META_SPHERE_CHANCE: 0.16,            // chance a circle becomes a "sphere"

  // Door / progression
  ALIGN_THRESHOLD: 0.11,               // angle error threshold for "aligned"
  ALIGN_HOLD_TIME: 0.9,                // time aligned before door arms
  DOOR_RADIUS: 22,                     // radius of the "door" when armed

  // UI / Audio
  UI_FONT: "12px ui-monospace, Menlo, monospace",
  MASTER_VOL: 0.95,                    // overall audio volume
  AUDIO_DRONE_BUS_GAIN: 0.72,          // overall level of the sustained drone layer
  AUDIO_SFX_BUS_GAIN: 0.9,             // procedural / one-shot SFX level
  AUDIO_BACKGROUND_LEVEL: 0.51,        // base 216 Hz bed level (raised so it is clearly audible)
  AUDIO_BACKGROUND_FILTER_HZ: 2400,    // tone color of the 216 Hz bed
  AUDIO_ENEMY_GAIN_FAR: 0.024,         // minimum platonic-solid drone level, even out in the Oort cloud
  AUDIO_ENEMY_GAIN_NEAR: 0.065,        // max platonic-solid drone level near Sol
  AUDIO_ENEMY_GAIN_CURVE: 1.25,        // falloff shape: lower = louder farther out, higher = quieter until close
  AUDIO_ENEMY_FILTER_FAR_HZ: 700,      // far-field tone color for platonic solids
  AUDIO_ENEMY_FILTER_NEAR_HZ: 2800,    // near-field brightness for platonic solids
  AUDIO_ENEMY_PAN_WORLD_WIDTH: 340,    // stereo pan spread relative to player position
  AUDIO_ENEMY_DEVOLVE_GLISS_SEC: 0.34, // glide time when a solid collapses to a lower order
  AUDIO_DOPPLER_SCALE: 0.0012,         // subtle pitch bend from radial motion relative to the player
  AUDIO_MODE_MENU_DRONES: 0.35,        // drone bus multiplier in menu
  AUDIO_MODE_PLAYING_DRONES: 1.0,      // drone bus multiplier while playing
  AUDIO_MODE_PAUSED_DRONES: 0.38,      // drone bus multiplier while paused
  AUDIO_MODE_TRANSITION_DRONES: 0.82,  // drone bus multiplier between waves

  AUDIO_THRUST_URL: "/static/audio/thrust.wav",
  AUDIO_BLASTER_URL: "/static/audio/blaster-fire.wav",
  AUDIO_SHIP_DESTROYED_URL: "/static/audio/ship-destroyed.wav",
  AUDIO_SOL_DESTROYED_URL: "/static/audio/sol-destroyed.wav",
  AUDIO_NEXT_WAVE_URL: "/static/audio/next-wave.wav",

  AUDIO_THRUST_SAMPLE_GAIN: 0.18,      // level of looped thrust.wav when present
  AUDIO_THRUST_RATE_MIN: 0.92,         // idle playback rate for thrust.wav
  AUDIO_THRUST_RATE_MAX: 1.24,         // full-thrust playback rate for thrust.wav
  AUDIO_THRUST_FILTER_MIN_HZ: 420,     // idle filter for thrust.wav
  AUDIO_THRUST_FILTER_MAX_HZ: 2400,    // full-thrust filter for thrust.wav

  AUDIO_BLASTER_GAIN: 0.08,            // one-shot gain for blaster-fire.wav
  AUDIO_SHIP_DESTROYED_GAIN: 0.12,     // one-shot gain for ship-destroyed.wav
  AUDIO_SOL_DESTROYED_GAIN: 0.45,      // one-shot gain for sol-destroyed.wav
  AUDIO_NEXT_WAVE_GAIN: 0.14,           // one-shot gain for next-wave.wav
};

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
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

function metatronCenters(radius: number) {
  const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6;
    pts.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) * TAU) / 6;
    pts.push({ x: Math.cos(a) * radius * 2, y: Math.sin(a) * radius * 2 });
  }
  return pts;
}
const MET_EDGES = (() => { const e: number[][] = []; for (let i = 0; i < 13; i++) for (let j = i + 1; j < 13; j++) e.push([i, j]); return e; })();

// ===================== POLYHEDRA =====================
type SolidKind = "tetra" | "cube" | "octa" | "dodeca" | "icosa";
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

const DOWNGRADE: Record<SolidKind, SolidKind | null> = {
  icosa: "dodeca",
  dodeca: "octa",
  octa: "cube",
  cube: "tetra",
  tetra: null,
};

// ===================== GAME TYPES =====================
type Bullet = { pos: V2; prevPos: V2; vel: V2; life: number };
type FuelBit = { pos: V2; vel: V2; life: number; hue: number; };
type Shard = { pos: V2; vel: V2; life: number; life0: number; hue: number; size: number; ang: number; spin: number; };

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

type Level = {
  name: string;
  wave: number;
  gravityGM: number;
  solarPressure: number;
  enemyCount: number;
  enemyKind: SolidKind;
};

// ===================== WEB AUDIO (DRONES + SFX) =====================
type GameMode = "menu" | "playing" | "paused" | "transition";

const AUDIO = {
  MASTER_GAIN: T.MASTER_VOL,
  DRONE_BUS_GAIN: T.AUDIO_DRONE_BUS_GAIN,
  SFX_BUS_GAIN: T.AUDIO_SFX_BUS_GAIN,
  BUFFER_URL: "/static/audio/drone-432.wav",
  BACKGROUND: {
    PLAYBACK_RATE: 0.5,
    GAIN: T.AUDIO_BACKGROUND_LEVEL,
    PAN: 0,
    FILTER_HZ: T.AUDIO_BACKGROUND_FILTER_HZ,
  },
  HARMONICS: {
    tetra: 1.0,
    cube: 1.5,
    octa: 2.0,
    dodeca: 2.5,
    icosa: 3.0,
  } as const,
  ENEMY: {
    MIN_GAIN: T.AUDIO_ENEMY_GAIN_FAR,
    MAX_GAIN: T.AUDIO_ENEMY_GAIN_NEAR,
    GAIN_CURVE_EXP: T.AUDIO_ENEMY_GAIN_CURVE,
    PAN_WORLD_WIDTH: T.AUDIO_ENEMY_PAN_WORLD_WIDTH,
    PAN_SMOOTH_SEC: 0.075,
    GAIN_SMOOTH_SEC: 0.09,
    FILTER_MIN_HZ: T.AUDIO_ENEMY_FILTER_FAR_HZ,
    FILTER_MAX_HZ: T.AUDIO_ENEMY_FILTER_NEAR_HZ,
    FILTER_SMOOTH_SEC: 0.1,
    RATE_SMOOTH_SEC: 0.085,
    DEVOLVE_GLISS_SEC: T.AUDIO_ENEMY_DEVOLVE_GLISS_SEC,
    SPAWN_FADE_SEC: 0.18,
    DEATH_FADE_SEC: 0.1,
  },
  DOPPLER: {
    ENABLED: true,
    SCALE: T.AUDIO_DOPPLER_SCALE,
    MIN_FACTOR: 0.985,
    MAX_FACTOR: 1.015,
  },
  THRUST: {
    BASE_FREQ: 85,
    FREQ_RANGE: 180,
    BASE_FILTER: 380,
    FILTER_RANGE: 1600,
    GAIN_MAX: 0.16,
  },
  MODE: {
    menu: T.AUDIO_MODE_MENU_DRONES,
    playing: T.AUDIO_MODE_PLAYING_DRONES,
    paused: T.AUDIO_MODE_PAUSED_DRONES,
    transition: T.AUDIO_MODE_TRANSITION_DRONES,
  } as const,
  FALLBACK_BUFFER_SECONDS: 6,
};

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

  sampleBuffers: Record<"thrust" | "blaster" | "shipDestroyed" | "solDestroyed" | "nextWave", AudioBuffer | null> = {
    thrust: null,
    blaster: null,
    shipDestroyed: null,
    solDestroyed: null,
    nextWave: null,
  };
  sampleLoads = new Set<"thrust" | "blaster" | "shipDestroyed" | "solDestroyed" | "nextWave">();

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

  private loadSample(key: keyof AudioEngine["sampleBuffers"], url: string) {
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

  private playSample(key: keyof AudioEngine["sampleBuffers"], gainValue = 0.2, playbackRate = 1): boolean {
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

  stop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    try { this.thrustGain?.gain.setTargetAtTime(0, t, 0.02); } catch {}
    try { this.thrustSampleGain?.gain.setTargetAtTime(0, t, 0.03); } catch {}
    try { this.thrustSampleSrc?.stop(t + 0.06); } catch {}
    this.thrustSampleSrc = null;
    this.thrustSampleGain = null;
    this.thrustSampleFilter = null;
    this.clearEnemyDrones();
  }
}

// ===================== MAIN COMPONENT =====================
export default function MetatronVectorFOIL() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // UI state
  const [mode, setMode] = useState<"menu" | "playing" | "paused" | "transition">("menu");
  const [levelIdx, setLevelIdx] = useState(0);
  const [toggles, setToggles] = useState({ metatron: true, trails: true, debug: T.DEBUG_TEXT });

  const modeRef = useRef(mode);
  const levelIdxRef = useRef(levelIdx);
  const togglesRef = useRef(toggles);
  const [sliders, setSliders] = useState({
    gravity: T.GRAVITY_GM,
    thrust: T.THRUST_FORCE,
    trail: T.TRAIL_SAMPLES,
    master: AUDIO.MASTER_GAIN,
    solar: T.SOLAR_PRESSURE,
  });

  const audioRef = useRef(new AudioEngine());
  const keysRef = useRef(new Set<string>());

  // Keep slider values available inside the loop without rerenders
  const slidersRef = useRef(sliders);
  useEffect(() => { slidersRef.current = sliders; audioRef.current.setMaster(sliders.master); }, [sliders]);
  useEffect(() => {
    modeRef.current = mode;
    audioRef.current.setMode(mode);
    if (mode !== "playing") audioRef.current.setThrust(0);
  }, [mode]);
  useEffect(() => { levelIdxRef.current = levelIdx; }, [levelIdx]);
  useEffect(() => { togglesRef.current = toggles; }, [toggles]);

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
    const keys = keysRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === " ") e.preventDefault();
      // Audio unlock on first interaction
      audioRef.current.init();

      keys.add(e.key);

      if (e.key === "Enter") {
        if (modeRef.current === "menu" || modeRef.current === "paused") {
          modeRef.current = "playing";
          setMode("playing");
        }
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
    const metaRadius = T.META_RADIUS;
    const horizonR = metaRadius * T.HORIZON_MULT;
    const oortInner = horizonR * T.OORT_INNER_MULT;
    const oortOuter = horizonR * T.OORT_OUTER_MULT;

    const centers2 = metatronCenters(metaRadius);
    const centers3 = centers2.map((c, i) => new V3(c.x, c.y, (i % 2 === 0 ? 1 : -1) * 8));

    // entities
    const camera = { pos: new V2(0, 0), zoom: 1 };
    const player = {
      pos: new V2(metaRadius, 0),
      vel: new V2(0, 0),
      angle: 0,
      thrust: 0,
      fuel: T.FUEL_MAX,
      stuckTime: 0,
    };

    const bullets: Bullet[] = [];
    const enemies: Enemy[] = [];
    let nextEnemyId = 1;
    const shards: Shard[] = [];
    const fuelBits: FuelBit[] = [];
    const trail: V2[] = [];

    // metatron angles
    let metaAx = 0, metaAy = 0, metaAz = 0;

    // timers / wave state
    let gunCD = 0;
    let waveBannerTimer = 0;
    let waveBannerText = "";
    let waveActive = false;
    let pendingWaveIdx = 0;

    // reset helper
    const queueWaveBanner = (waveIdx: number) => {
      const wave = getLevel(waveIdx).wave;
      waveBannerText = `Prepare for Wave ${wave}`;
      waveBannerTimer = 3.0;
      pendingWaveIdx = waveIdx;
      waveActive = false;
    };

    const resetRun = (toMenu = false) => {
      bullets.length = 0; enemies.length = 0; shards.length = 0; fuelBits.length = 0; trail.length = 0;
      player.pos = new V2(metaRadius, 0);
      // orbit init
      const gm = slidersRef.current.gravity;
      const v0 = Math.sqrt((gm) / metaRadius) * T.ORBIT_GAIN;
      player.vel = new V2(0, v0);
      player.angle = Math.atan2(player.vel.y, player.vel.x);
      player.fuel = T.FUEL_MAX;
      player.stuckTime = 0;
      gunCD = 0;
      nextEnemyId = 1;
      metaAx = 0; metaAy = 0; metaAz = 0;
      audioRef.current.stop();
      audioRef.current.setMode(toMenu ? "menu" : "playing");
      levelIdxRef.current = 0;
      setLevelIdx(0);
      queueWaveBanner(0);
      const nextMode = toMenu ? "menu" : "playing";
      modeRef.current = nextMode;
      setMode(nextMode);
    };

    // initial orbit
    resetRun(false);

    // helpers
    const gravityAt = (p: V2, gm: number) => {
      const toC = new V2(-p.x, -p.y);
      const d = Math.max(T.GRAVITY_SOFTEN, toC.len());
      return toC.norm().mul(gm / (d * d));
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

    const makeBullet = () => {
      const muzzle = V2.fromAngle(player.angle, 18);
      const pos = player.pos.copy().add(muzzle);
      const vel = V2.fromAngle(player.angle, T.BULLET_SPEED).add(player.vel.copy());
      return { pos, prevPos: pos.copy(), vel, life: T.BULLET_LIFE };
    };

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
      for (let k = 0; k < N; k++) {
        const jitter = rand(-Math.PI / 6, Math.PI / 6);
        const dj = dir.copy().rot(jitter).norm();
        const sp = rand(T.SHRAPNEL_SPEED_MIN, T.SHRAPNEL_SPEED_MAX);
        const v = dj.copy().mul(sp).add(e.vel.copy().mul(T.SHRAPNEL_PARENT_VEL));
        const life0 = rand(T.SHRAPNEL_LIFE_MIN, T.SHRAPNEL_LIFE_MAX);
        shards.push({
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

    const loseRun = (reason: "ship" | "sol" = "ship") => {
      if (reason === "sol") audioRef.current.solDestroyed();
      else audioRef.current.shipDestroyed();
      resetRun(false);
    };

    const killPlayer = () => {
      loseRun("ship");
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
          shards.splice(i, 1);
        }
      }
    };

    const collectFuelBits = () => {
      for (let i = fuelBits.length - 1; i >= 0; i--) {
        const b = fuelBits[i];
        const d = b.pos.copy().sub(player.pos).len();
        if (d < 18) {
          player.fuel = clamp(player.fuel + T.FUEL_PICKUP_AMOUNT, 0, T.FUEL_MAX);
          audioRef.current.blip(520 + rand(-50, 50), 0.06, 0.12);
          fuelBits.splice(i, 1);
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

      // handle pause/menu/transition
      if (modeRef.current !== "playing") {
        // still animate metatron slowly for menu vibes
        const dist = player.pos.len();
        const spin = (T.META_BASE_SPIN + T.META_SPIN_GAIN * (dist / Math.max(1, metaRadius))) * 0.15;
        metaAz += spin * dt;
        metaAx += spin * 0.6 * dt;
        metaAy += spin * 0.4 * dt;
        audioRef.current.updateDrones(modeRef.current as GameMode, enemies, player, T.STAR_RADIUS, oortOuter);
        audioRef.current.setThrust(0);
        return;
      }

      // ---- ship input (A/D + W/S) ----
      if (keys.has("a") || keys.has("A") || keys.has("ArrowLeft")) player.angle -= T.ROT_SPEED * dt;
      if (keys.has("d") || keys.has("D") || keys.has("ArrowRight")) player.angle += T.ROT_SPEED * dt;

      const want = (keys.has("w") || keys.has("W") || keys.has("ArrowUp")) ? 1 : ((keys.has("s") || keys.has("S") || keys.has("ArrowDown")) ? -1 : 0);
      player.thrust = lerp(player.thrust, want, want !== 0 ? 0.16 : 0.10);

      // fuel burn/regen
      const dist = player.pos.len();
      const outside = dist > horizonR;
      const use = Math.max(0, player.thrust);
      if (use > 0.03 && player.fuel > 0) player.fuel = Math.max(0, player.fuel - T.FUEL_BURN * use * dt);
      if (!outside) player.fuel = Math.min(T.FUEL_MAX, player.fuel + T.FUEL_REGEN_INNER * dt);

      // Forces
      const g = gravityAt(player.pos, lvl.gravityGM);
      const sail = solarSailAt(player.pos, player.angle, lvl.solarPressure * (solar / T.SOLAR_PRESSURE));
      const fwd = V2.fromAngle(player.angle, 1);

      // engine thrust (only if fuel); braking is multiplicative drag, not reverse thrust
      const engine = fwd.copy().mul((player.fuel > 0 ? 1 : 0) * Math.max(0, player.thrust) * thrust);
      // acceleration = (g + sail + engine/mass)
      player.vel.add(g.mul(dt));
      player.vel.add(sail.mul(dt / T.SHIP_MASS));
      player.vel.add(engine.mul(dt / T.SHIP_MASS));

      const brake = clamp(-player.thrust, 0, 1);
      if (brake > 0.001) {
        const brakeMul = lerp(1, T.BRAKE_COEFF, brake);
        player.vel.mul(brakeMul);
      }

      // no passive drag
      if (T.DRAG > 0) player.vel.mul(1 - T.DRAG * dt);

      // clamp speed
      const sp = player.vel.len();
      if (sp > T.MAX_SPEED) player.vel.mul(T.MAX_SPEED / sp);

      player.pos.add(player.vel.copy().mul(dt));

      // "stuck in well" explosion check
      const dStar = player.pos.len();
      if (dStar < T.STAR_TRAP_RADIUS && player.vel.len() < 120) {
        player.stuckTime += dt;
        if (player.stuckTime >= T.STAR_TRAP_TIME) {
          loseRun("ship");
          return;
        }
      } else {
        player.stuckTime = 0;
      }

      // ---- gun ----
      gunCD -= dt;
      if ((keys.has(" ") || keys.has("Space")) && gunCD <= 0) {
        bullets.push(makeBullet());
        audioRef.current.shoot();
        gunCD = T.FIRE_RATE;
      }

      // bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.prevPos = b.pos.copy();
        b.pos.add(b.vel.copy().mul(dt));
        b.life -= dt;
        if (b.life <= 0 || Math.abs(b.pos.x) > oortOuter * 3 || Math.abs(b.pos.y) > oortOuter * 3) bullets.splice(i, 1);
      }

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

        const toShip = player.pos.copy().sub(e.pos);
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

        const toPlayer = player.pos.copy().sub(e.pos);
        const enemyHitR = Math.max(8, e.r * T.ENEMY_HIT_RADIUS_MULT);
        if (toPlayer.len() <= T.SHIP_HIT_RADIUS + enemyHitR) {
          killPlayer();
          return;
        }

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
          spawnShrapnel(e, impact);
          audioRef.current.hit();
          b.life = -1;
          if (!downgradeEnemy(e)) enemies.splice(ei, 1);
          hit = true;
          break;
        }
        if (hit || b.life <= 0) bullets.splice(bi, 1);
      }

      // shrapnel update
      for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.vel.add(gravityAt(s.pos, lvl.gravityGM * T.SHRAPNEL_GRAVITY_MULT).mul(dt));
        s.pos.add(s.vel.copy().mul(dt));
        s.ang += s.spin * dt;
        s.life -= dt;

        if (s.pos.copy().sub(player.pos).len() <= T.SHIP_HIT_RADIUS + s.size + T.SHARD_HIT_RADIUS_PAD) {
          killPlayer();
          return;
        }

        if (s.life <= 0 || s.pos.len() > oortOuter * 2.4) shards.splice(i, 1);
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

      // contrail
      trail.push(player.pos.copy());
      const maxTrail = (slidersRef.current.trail | 0);
      if (trail.length > maxTrail) trail.splice(0, trail.length - maxTrail);

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

      if (waveActive && enemies.length === 0 && shards.length === 0) {
        audioRef.current.levelUp();
        queueWaveBanner(levelIdxRef.current + 1);
      }

      // camera (center stays on star; zoom guarantees ship in view)
      updateCamera(camera, canvas, dpr, player.pos, player.vel, horizonR);
      // audio continuous
      audioRef.current.updateDrones(modeRef.current as GameMode, enemies, player, T.STAR_RADIUS, oortOuter);
      audioRef.current.setThrust(Math.max(0, player.thrust) * (player.fuel > 0 ? 1 : 0));
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

      render(ctx, canvas, dpr, {
        mode: modeRef.current,
        level: getLevel(levelIdxRef.current),
        player, camera,
        meta: { ax: metaAx, ay: metaAy, az: metaAz, centers3 },
        entities: { bullets, enemies, shards, fuelBits, trail },
        toggles: togglesRef.current,
        horizonR, oortInner, oortOuter,
        waveBannerTimer,
        waveBannerText,
      });

      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown as any);
      window.removeEventListener("keyup", onKeyUp as any);
      window.removeEventListener("pointerdown", onPointerDown as any);
      audioRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===================== UI =====================
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

      {/* HUD box */}
      <div style={{
        position: "absolute", top: 12, right: 12,
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 12, color: "rgba(255,255,255,.86)",
        background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.10)",
        backdropFilter: "blur(10px)", borderRadius: 14, padding: "10px 12px",
        maxWidth: 360,
      }}>
        <div style={{ fontWeight: 700, color: "rgba(255,255,255,.95)" }}>Metatron Vector FOIL</div>
        <div style={{ opacity: .9 }}>A/D rotate • W/S trim • Space shoot</div>
        <div style={{ opacity: .75 }}>Enter start • P pause • M/T/B toggles</div>
      </div>

      {/* Start screen */}
      {mode === "menu" && (
        <Overlay>
          <h1 style={{ margin: 0, fontSize: 28 }}>Metatron Vector FOIL</h1>
          <p style={{ maxWidth: 680, opacity: 0.9, lineHeight: 1.35 }}>
            You are a foil-ship riding gravity and starlight. Survive each incoming wave of Platonic solids,
            hold your orbit, and be ready when the next formation arrives.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Keycap>Enter</Keycap><span style={{ opacity: 0.85 }}>Start</span>
            <Keycap>A/D</Keycap><span style={{ opacity: 0.85 }}>Rotate</span>
            <Keycap>W</Keycap><span style={{ opacity: 0.85 }}>Catch light + thrust</span>
            <Keycap>Space</Keycap><span style={{ opacity: 0.85 }}>Shoot</span>
          </div>
          <p style={{ opacity: 0.72, marginTop: 12 }}>
            Tip: collect drifting fuel bits in the Oort band. Try “tacking” by angling the foil relative to the star,
            and use the quiet between waves to set up your next approach.
          </p>
        </Overlay>
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

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Toggle label="Metatron" checked={toggles.metatron} onChange={() => setToggles(t => ({...t, metatron: !t.metatron}))} />
              <Toggle label="Trails" checked={toggles.trails} onChange={() => setToggles(t => ({...t, trails: !t.trails}))} />
              <Toggle label="Debug" checked={toggles.debug} onChange={() => setToggles(t => ({...t, debug: !t.debug}))} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={() => setMode("playing")} style={btnStyle}>Resume</button>
            <button onClick={() => {
              levelIdxRef.current = 0;
              setLevelIdx(0);
              modeRef.current = "menu";
              setMode("menu");
            }} style={btnStyle}>Back to title</button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

// ===================== UI COMPONENTS =====================
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

// ===================== RENDERING + CAMERA =====================
function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dpr: number,
  S: {
    mode: "menu" | "playing" | "paused" | "transition";
    level: Level;
    player: { pos: V2; vel: V2; angle: number; thrust: number; fuel: number; stuckTime: number };
    camera: { pos: V2; zoom: number };
    meta: { ax: number; ay: number; az: number; centers3: V3[] };
    entities: { bullets: Bullet[]; enemies: Enemy[]; shards: Shard[]; fuelBits: FuelBit[]; trail: V2[] };
    toggles: { metatron: boolean; trails: boolean; debug: boolean };
    horizonR: number;
    oortInner: number;
    oortOuter: number;
    waveBannerTimer: number;
    waveBannerText: string;
  }
) {
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  // background
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = S.toggles.trails ? `rgba(5,6,10,${T.BG_FADE})` : "#05060a";
  ctx.fillRect(0, 0, w, h);

  // camera transform (center at star)
  ctx.setTransform(dpr * S.camera.zoom, 0, 0, dpr * S.camera.zoom, 0, 0);
  ctx.translate(w / (2 * S.camera.zoom), h / (2 * S.camera.zoom));
  ctx.translate(-S.camera.pos.x, -S.camera.pos.y);

  // rings
  ctx.save();
  ctx.lineWidth = 2 / S.camera.zoom;
  ctx.strokeStyle = "rgba(255,160,180,0.22)";
  ctx.beginPath(); arcSafe(ctx, 0, 0, S.horizonR); ctx.stroke();
  ctx.restore();

  // oort band hint
  ctx.save();
  ctx.lineWidth = 1 / S.camera.zoom;
  ctx.strokeStyle = "rgba(190,225,255,0.06)";
  ctx.beginPath(); arcSafe(ctx, 0, 0, S.oortOuter); ctx.stroke();
  ctx.restore();

  // star
  ctx.save();
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, T.STAR_RADIUS * 2.2);
  grad.addColorStop(0, "rgba(255,255,230,0.80)");
  grad.addColorStop(0.2, "rgba(255,210,150,0.25)");
  grad.addColorStop(1, "rgba(255,180,120,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); arcSafe(ctx, 0, 0, T.STAR_RADIUS); ctx.fill();
  ctx.restore();

  // metatron (animated)
  if (S.toggles.metatron) {
    const C2: { x: number; y: number }[] = [];
    for (const v0 of S.meta.centers3) {
      let v = v0;
      v = rotX(v, S.meta.ax); v = rotY(v, S.meta.ay); v = rotZ(v, S.meta.az);
      C2.push(project(v, 1, 220 / 240));
    }

    // edges
    ctx.save();
    ctx.lineWidth = 0.75 / S.camera.zoom;
    ctx.strokeStyle = "rgba(180,220,255,0.12)";
    for (const [i, j] of MET_EDGES) {
      const a = C2[i], b = C2[j];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();

    // circles / spheres
    const t = performance.now() / 1000;
    ctx.save();
    for (let i = 0; i < C2.length; i++) {
      const c = C2[i];
      const pulse = 0.12 + 0.05 * Math.sin((t + i * 0.37) * (TAU / T.META_SPHERE_PULSE));
      const makeSphere = (Math.sin(t * 0.7 + i) * 0.5 + 0.5) < T.META_SPHERE_CHANCE;
      if (makeSphere) {
        const g = ctx.createRadialGradient(c.x - 6 / S.camera.zoom, c.y - 6 / S.camera.zoom, 2 / S.camera.zoom, c.x, c.y, T.META_RADIUS * (1.0 + pulse));
        g.addColorStop(0, "rgba(210,235,255,0.15)");
        g.addColorStop(0.5, "rgba(170,210,255,0.07)");
        g.addColorStop(1, "rgba(150,190,240,0.02)");
        ctx.fillStyle = g;
        ctx.beginPath(); arcSafe(ctx, c.x, c.y, T.META_RADIUS * (0.96 + pulse)); ctx.fill();
        ctx.lineWidth = 0.9 / S.camera.zoom;
        ctx.strokeStyle = "rgba(170,210,255,0.20)";
        ctx.beginPath(); arcSafe(ctx, c.x, c.y, T.META_RADIUS * (0.96 + pulse)); ctx.stroke();
      } else {
        ctx.lineWidth = 0.9 / S.camera.zoom;
        ctx.strokeStyle = `rgba(170,210,255,${0.12 + pulse * 0.6})`;
        ctx.beginPath(); arcSafe(ctx, c.x, c.y, T.META_RADIUS * (1.0 + pulse * 0.15)); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // fuel bits
  ctx.save();
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

  // contrail
  ctx.save();
  ctx.lineWidth = 1.2 / S.camera.zoom;
  ctx.strokeStyle = `rgba(120,255,220,${T.TRAIL_ALPHA})`;
  ctx.beginPath();
  for (let i = 0; i < S.entities.trail.length; i++) {
    const p = S.entities.trail[i];
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();

  // ship
  ctx.save();
  ctx.translate(S.player.pos.x, S.player.pos.y);
  ctx.rotate(S.player.angle);
  ctx.lineWidth = 2.2 / S.camera.zoom;
  ctx.strokeStyle = "rgba(120,255,200,0.95)";
  ctx.beginPath();
  ctx.moveTo(12, 0); ctx.lineTo(-10, -7); ctx.lineTo(-6, 0); ctx.lineTo(-10, 7); ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // screen-space HUD
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = T.UI_FONT;

  const spd = S.player.vel.len();
  ctx.fillText(`${S.level.name}`, 12, 18);
  ctx.fillText(`Fuel ${S.player.fuel.toFixed(0)} / ${T.FUEL_MAX}  |  speed ${spd.toFixed(1)}  |  incoming ${S.level.enemyKind} × ${S.level.enemyCount}`, 12, 34);

  if (S.toggles.debug) {
    ctx.fillStyle = "rgba(255,255,255,0.74)";
    ctx.fillText(`zoom ${S.camera.zoom.toFixed(3)}  ship (${S.player.pos.x.toFixed(1)}, ${S.player.pos.y.toFixed(1)})  r=${S.player.pos.len().toFixed(1)}`, 12, 52);
    ctx.fillText(`bullets ${S.entities.bullets.length}  enemies ${S.entities.enemies.length}  shards ${S.entities.shards.length}  fuelbits ${S.entities.fuelBits.length}`, 12, 68);
  }

  if (S.waveBannerTimer > 0 && S.waveBannerText) {
    const alpha = clamp(Math.min(1, S.waveBannerTimer / 0.45), 0, 1) * (0.72 + 0.28 * Math.sin(performance.now() / 120));
    ctx.save();
    ctx.font = "28px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = `rgba(200,230,255,${0.25 * alpha})`;
    ctx.lineWidth = 2;
    ctx.strokeText(S.waveBannerText, w / 2, h * 0.24);
    ctx.fillStyle = `rgba(235,245,255,${0.12 * alpha})`;
    ctx.fillText(S.waveBannerText, w / 2, h * 0.24);
    ctx.restore();
  }
}

function updateCamera(camera: { pos: V2; zoom: number }, canvas: HTMLCanvasElement, dpr: number, shipPos: V2, shipVel: V2, horizonR: number) {
  // keep star centered
  camera.pos.x = 0; camera.pos.y = 0;

  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  // keep-in-view zoom ceiling (ship must stay on-screen)
  const pad = T.CAMERA_PAD_PX;
  const ax = Math.abs(shipPos.x);
  const ay = Math.abs(shipPos.y);
  const zX = w / (2 * (ax + pad));
  const zY = h / (2 * (ay + pad));
  const keepZoom = clamp(Math.min(zX, zY), T.CAMERA_ZOOM_FLOOR, T.CAMERA_ZOOM_CEIL);

  // aesthetic: prefer showing ring context + speed
  const dist = shipPos.len();
  const base = 1 / (1 + dist / (horizonR * 0.55));
  const sp = shipVel.len();
  const spZoom = 1 / (1 + sp / (T.MAX_SPEED * 0.85));
  const aesthetic = clamp(base * 0.72 + spZoom * 0.28, T.CAMERA_ZOOM_FLOOR, T.CAMERA_ZOOM_CEIL);

  const blend = T.CAMERA_AESTHETIC;
  const target = Math.min(keepZoom, lerp(keepZoom, aesthetic, blend));
  camera.zoom = clamp(lerp(camera.zoom, target, T.CAMERA_LERP), T.CAMERA_ZOOM_FLOOR, T.CAMERA_ZOOM_CEIL);
}

function formatNum(v: number) {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}
