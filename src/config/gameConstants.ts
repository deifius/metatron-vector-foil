import type { CommendationDefinition } from "../types/scoring";

// Centralized gameplay, geometry, debrief, audio, and public identity constants.
// Keep engine tuning here rather than inside MetatronVectorFOIL.tsx.

export const T = {
  // World
  META_CIRCLE_RADIUS: 272,              // visible Metatron circle/sphere radius; also defines awakening, refuel, and charging region size (world units)
  META_NODE_SPACING: 344,              // center-to-center spacing of Metatron nodes; for tangency set to META_CIRCLE_RADIUS * 2
  META_PLAYFIELD_RADIUS: 144,          // gameplay/camera reference radius; still decoupled from node spacing and circle size
  HORIZON_MULT: 2.0,                   // red ring radius multiplier
  OORT_INNER_MULT: 1.28,               // fuel-bit settlement inner band
  OORT_OUTER_MULT: 1.55,               // fuel-bit settlement outer band
  STAR_RADIUS: 14,                     // visible star radius (world units)
  STAR_COLLISION_RADIUS: 9.5,           // hard Sol body; touch this with the Corsair and it is crash-and-burn
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
  ROT_SPEED: 3.6,                      // legacy/direct ship rotation speed (rad/s) when rotational inertia is disabled
  SHIP_ROTATIONAL_INERTIA_ENABLED: true, // true = A/D apply torque and angular velocity is conserved between inputs
  SHIP_ANGULAR_ACCEL: 11.5,            // angular acceleration from steering input (rad/s^2)
  SHIP_ANGULAR_DAMPING: 0.42,          // angular velocity bleed per second; 0 = pure conservation, higher = easier handling
  SHIP_MAX_ANGULAR_SPEED: 4.2,         // angular velocity clamp when rotational inertia is enabled (rad/s)
  THRUST_FORCE: 1900,                  // engine thrust (force units)
  BRAKE_COEFF: 0.97,                  // braking drag coefficient applied per fixed step
  BRAKING_REQUIRES_ACTIVATED_SPHERE: true, // brakes need Metatronic medium; open space has nothing to parachute against
  OPEN_SPACE_BRAKE_MULTIPLIER: 0.0,    // 0 = no braking outside awakened spheres; raise for emergency inertial damping
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
  CAMERA_LERP: 0.24,                   // camera zoom smoothing
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
  FIRE_RATE: 0.22,                     // seconds between shots
  BULLET_SPEED: 500,                  // bullet speed
  BULLET_LIFE: 8.2,                    // bullet lifetime seconds
  BULLET_RADIUS: 4.0,                  // bullet collision radius against wireframe edges
  BULLET_TAIL: 0.024,                  // tail length factor
  BULLET_MASS: 2.0,                    // 0 = energy weapon (no gravity), 1 = baseline ballistic slug

  SHIP_RESILIENCE: 6,                  // number of hits the ship can take before destruction; 1 = first hit kills
  SHIP_HIT_IFRAME_SEC: 0.45,           // brief invulnerability so resilience is meaningful
  SHIP_HIT_KNOCKBACK: 180,             // impulse away from the impact source

  // Enemies
  ENEMY_MAX: 5,                        // max enemies on screen
  ENEMY_SPAWN_BASE: 0.9,               // base spawn interval
  ENEMY_SPAWN_MIN: 0.35,               // minimum spawn interval at higher levels
  ENEMY_SPEED: 60,                    // base enemy drift speed
  ENEMY_SPAWN_RADIUS_INNER_MULT: 1.7,  // enemy spawn shell inner radius, measured from Oort outer edge
  ENEMY_SPAWN_RADIUS_OUTER_MULT: 1.9,  // enemy spawn shell outer radius, measured from Oort outer edge
  ENEMY_STEER: 140,                    // inward acceleration toward Sol
  ENEMY_ORBIT_BIAS: 0.95,              // tendency to spiral rather than beeline
  ENEMY_PLAYER_BIAS: 0.18,             // slight ship-seeking influence while still diving inward
  ENEMY_GRAVITY_MULT: 1.1,             // extra stellar pull on enemies
  ENEMY_HIT_RADIUS_MULT: 1.25,         // player collision radius multiplier against enemies
  ENEMY_COLLAPSE_RATE: 1.25,           // solid downgrade morph speed
  ENEMY_HIT_DEFLECT_IMPULSE: 135,      // direct bullet-hit impulse away from Sol
  ENEMY_HIT_DEFLECT_TANGENTIAL: 0.22,  // preserves a little sideways motion on direct hits
  SHARD_ENEMY_KNOCKBACK: 42,           // smaller shrapnel impulse applied to enemies
  SHARD_ENEMY_SOL_BIAS: 0.35,          // blends shard knockback slightly outward from Sol
  SHIP_HIT_RADIUS: 10,                 // player hit radius
  SHARD_HIT_RADIUS_PAD: 2.5,           // extra shard collision padding
  SHRAPNEL_COUNT_MIN: 2,               // min shrapnel on hit
  SHRAPNEL_COUNT_MAX: 8,              // max shrapnel on hit
  SHRAPNEL_SPEED_MIN: 40,             // shrapnel speed min
  SHRAPNEL_SPEED_MAX: 120,             // shrapnel speed max
  SHRAPNEL_GRAVITY_MULT: 6.0,          // shard gravity multiplier
  SHRAPNEL_PARENT_VEL: 0.6,            // how much parent velocity shards inherit
  SHRAPNEL_LIFE_MIN: 7.9,              // shrapnel life min
  SHRAPNEL_LIFE_MAX: 18.9,              // shrapnel life max

  // Oort cloud constellations / hazards
  OORT_CONSTELLATIONS_ENABLED: true,    // draw and simulate the procedural Oort cloud
  OORT_CLUSTER_COUNT: 420,              // cheap procedural three-node constellations; not full physics bodies
  OORT_CONSTELLATION_INNER_MULT: 1.92,  // inner constellation band, measured from current Oort outer radius
  OORT_CONSTELLATION_OUTER_MULT: 3.15,  // outer constellation band, measured from current Oort outer radius
  OORT_GLYPH_RADIUS_MIN: 5.0,           // local three-node constellation radius
  OORT_GLYPH_RADIUS_MAX: 18.0,          // local three-node constellation radius
  OORT_ORBIT_SPEED_MIN: 0.00055,        // parametric orbit speed, radians/s
  OORT_ORBIT_SPEED_MAX: 0.0030,         // parametric orbit speed, radians/s
  OORT_LOCAL_SPIN_SPEED_MIN: -0.42,     // local glyph spin, radians/s
  OORT_LOCAL_SPIN_SPEED_MAX: 0.42,      // local glyph spin, radians/s
  OORT_ECCENTRICITY_MAX: 0.10,          // subtle non-circular procession without n-body integration
  OORT_NODE_VISUAL_RADIUS: 2.3,         // node dot radius in screen-ish pixels
  OORT_LINE_ALPHA: 0.065,               // resting constellation line opacity
  OORT_NODE_ALPHA: 0.16,                // resting constellation node opacity
  OORT_NEAR_PLAYER_BRIGHTEN_RADIUS: 175,// nearby Oort glyphs brighten as the jammer's field wakes them
  OORT_HAZARD_WAKE_RADIUS: 84,          // coarse cluster distance before detailed player collision checks
  OORT_NODE_HIT_RADIUS: 7.5,            // player collision radius around Oort nodes
  OORT_LINE_HIT_RADIUS: 5.8,            // player collision radius around Oort tripwire segments
  OORT_DUST_DAMAGE_PER_SECOND: 0.026,   // ambient shield abrasion inside dense Oort dust
  OORT_DUST_SPEED_SCALE: 0.00135,       // faster Oort travel increases abrasion
  OORT_COLLISION_BASE_DAMAGE: 0.38,     // discrete node/tripwire damage, in ship-hit units
  OORT_COLLISION_SPEED_DAMAGE: 0.00115, // additional discrete damage per world-unit/s of speed
  OORT_COLLISION_KNOCKBACK: 115,        // velocity kick away from struck constellation
  OORT_SHOT_BREAK_RADIUS: 9.0,          // blaster corridor-clearing radius against nodes/lines
  OORT_REFORM_SECONDS: 15.0,            // broken constellations drift back together after this long
  OORT_ALLOWS_BRAKING: true,            // dusty ice medium lets the brake foil bite weakly in the Oort cloud
  OORT_BRAKE_MULTIPLIER: 0.28,          // fraction of normal sphere braking available in dense Oort dust
  OORT_PASSIVE_DRAG: 0.045,             // passive speed bleed per second in dense Oort dust
  OORT_INWARD_PRESSURE_ENABLED: true,   // heliopause/Riemann pressure nudges far-out ships back toward Sol
  OORT_INWARD_PRESSURE_START_MULT: 2.85,// start pressure at this multiple of the normal Oort outer radius
  OORT_INWARD_PRESSURE_FULL_MULT: 4.00, // pressure reaches full strength at this multiple of Oort outer radius
  OORT_INWARD_PRESSURE_ACCEL: 36,       // maximum inward acceleration from outer-shell pressure
  OORT_COLLISION_INWARD_BIAS: 0.34,     // after Oort strikes, blend the rebound vector back toward Sol
  OORT_COLLISION_SPEED_DAMPING: 0.82,   // Oort collisions knock speed down so they rescue as well as punish

  // Metatron animation / node gameplay
  META_BASE_SPIN: 0.03,                // base spin
  META_SPIN_GAIN: 0.22,                // spin increases with distance
  META_DWELL: 0.82,                    // dwell damping toward readable pose
  META_ALIGN_START_COUNT: 1,           // begin flattening the lattice after this many awakened nodes
  META_ALIGN_COMPLETE_COUNT: 3,        // fully face-on target by this many awakened nodes
  META_ALIGN_SETTLE_SEC: 14.0,           // seconds for the lattice to drift into its new alignment target
  META_DEPTH_WOBBLE: 8,                // early-game z offset for occult not-quite-flat projection
  META_SPHERE_PULSE: 8.0,              // seconds per pulse
  META_SPHERE_LIGHT_ALPHA: 0.08,       // lit-side fill opacity for awakened spheres
  META_SPHERE_SHADOW_ALPHA: 0.065,     // dark-side opacity for awakened spheres
  META_SPHERE_RIM_ALPHA: 0.11,         // lit rim opacity for awakened spheres
  META_SPHERE_CENTER_FILL_ALPHA: 0.012,// faint center-circle fill; Sol itself supplies the real luminosity
  META_LINE_ALPHA: 0.16,               // resting opacity of awakened-node connections
  META_LINE_PULSE_ALPHA: 0.50,         // extra opacity during new-node pulse
  META_LINE_WIDTH: 1.0,                // resting line width for awakened-node connections
  META_LINE_PULSE_WIDTH: 2.2,          // extra line width during new-node pulse
  META_LINE_PULSE_SEC: 0.85,           // duration of newly awakened connection pulse
  META_NODE_FUEL_INNER: 3.5,           // small passive fuel trickle in inner-node cores
  META_NODE_FUEL_OUTER: 5.0,           // small passive fuel trickle in outer-node cores
  META_SPHERE_FUEL_INNER: 14.0,        // bonus fuel regen inside an awakened inner sphere core
  META_SPHERE_FUEL_OUTER: 18.0,        // bonus fuel regen inside an awakened outer sphere core
  META_SPHERE_SHIELD_REGEN: 0.14,      // shield repair per second while holding an awakened inner sphere
  META_SPHERE_SHIELD_REGEN_OUTER: 0.20,// stronger shield repair per second in awakened outer spheres
  META_NODE_CHARGE_SEC: 5.5,           // base duration added by any bullet hit on a polyhedron
  META_NODE_OVERCHARGE_SEC: 9.0,       // bonus duration when a tetrahedron is destroyed in a node
  META_NODE_MAX_CHARGE_SEC: 18.0,      // cap so repeated hits do not make a node permanent
  META_ACTIVE_NODE_GRAVITY_MULT: 0.055,// awakened node gravity strength as a fraction of current Sol GM
  META_ACTIVE_NODE_GRAVITY_SOFTEN: 72, // softening distance for awakened node gravity
  META_ACTIVE_NODE_GRAVITY_MAX: 95,    // max acceleration from awakened node gravity per node
  META_NODE_GRAVITY_AFFECTS_PLAYER: true,
  META_NODE_GRAVITY_AFFECTS_BULLETS: true,
  META_NODE_GRAVITY_AFFECTS_ENEMIES: true,
  META_NODE_GRAVITY_AFFECTS_SHRAPNEL: true,
  META_SPHERE_PLAYER_MEDIUM_DRAG: 0.006,// very light passive atmospheric damping inside awakened spheres; braking supplies the real drag
  META_SPHERE_ENEMY_MEDIUM_DRAG: 0.18,  // awakened-sphere medium slows hostile polyhedra slightly, per second
  META_SPHERE_SHRAPNEL_MEDIUM_DRAG: 0.55,// awakened-sphere medium damps shrapnel noticeably, per second

  // Ship animation feel
  THRUST_TRAIL_GLOW_ENABLED: true,
  THRUST_TRAIL_GLOW_POINTS: 42,         // recent trail samples energized by thrust plume
  THRUST_TRAIL_GLOW_INTENSITY: 0.72,    // maximum added plume alpha along the near trail
  BRAKE_UNFOLD_ENABLED: true,
  BRAKE_UNFOLD_AMOUNT: 0.72,            // how far the sphenic wedge splays open while braking in medium
  BRAKE_WAKE_LINES_ENABLED: false,       // keep false for clean brake animation: widened foil only, no aft wake scribbles
  BRAKE_WAKE_INTENSITY: 0.68,

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
  AUDIO_MODE_DEBRIEF_DRONES: 0.16,     // drone bus multiplier during death/debrief ritual

  AUDIO_THRUST_URL: "/static/audio/thrust.wav",
  AUDIO_BLASTER_URL: "/static/audio/blaster-fire.wav",
  AUDIO_SHIP_DESTROYED_URL: "/static/audio/ship-destroyed.wav",
  AUDIO_SOL_DESTROYED_URL: "/static/audio/sol-destroyed.wav",
  AUDIO_NEXT_WAVE_URL: "/static/audio/next-wave.wav",
  AUDIO_OORT_BREAK_URL: "/static/audio/oort-break.wav",
  AUDIO_OORT_STRIKE_URL: "/static/audio/oort-strike.wav",
  AUDIO_OORT_DUST_URL: "/static/audio/oort-dust.wav",
  AUDIO_SPHERE_ACTIVATE_URL: "/static/audio/sphere-activate.wav",

  // Multiplayer / Constellation Defense audio hooks. Optional files can be
  // dropped into /static/audio; the engine falls back to synthetic carrier
  // chirps when they are absent.
  AUDIO_ROOM_CREATE_URL: "/static/audio/room-create.wav",
  AUDIO_ROOM_INVITE_URL: "/static/audio/room-invite.wav",
  AUDIO_ROOM_INVITE_RECEIVED_URL: "/static/audio/room-invite-received.wav",
  AUDIO_ROOM_JOIN_URL: "/static/audio/room-join.wav",
  AUDIO_ROOM_LEAVE_URL: "/static/audio/room-leave.wav",
  AUDIO_SIGNAL_LOCK_URL: "/static/audio/signal-lock.wav",
  AUDIO_SIGNAL_LOST_URL: "/static/audio/signal-lost.wav",
  AUDIO_TRANSPONDER_PING_URL: "/static/audio/transponder-ping.wav",
  AUDIO_RELAY_FALLBACK_URL: "/static/audio/relay-fallback.wav",

  MULTIPLAYER_MAX_PILOTS: 6,
  MULTIPLAYER_DEFAULT_VISIBILITY: "UNLISTED",
  MULTIPLAYER_DEFAULT_CONFIG_POLICY: "HOST LOCKED",
  MULTIPLAYER_TRACE_SEND_MS: 80,
  MULTIPLAYER_TRACE_INTERP_MS: 120,
  MULTIPLAYER_TRACE_STALE_MS: 2600,
  MULTIPLAYER_TRACE_SNAP_DISTANCE: 520,
  MULTIPLAYER_TRACE_MAX_EXTRAPOLATE_SEC: 0.22,
  MULTIPLAYER_TRACE_MAX_BYTES: 2048,
  MULTIPLAYER_CARRIER_MAX_BYTES: 24576,
  MULTIPLAYER_HEARTBEAT_MS: 1200,
  MULTIPLAYER_HEARTBEAT_WARN_MS: 2400,
  MULTIPLAYER_HEARTBEAT_LOST_MS: 5200,
  MULTIPLAYER_WORLD_SNAPSHOT_MS: 180,
  MULTIPLAYER_WORLD_INTERP_MS: 170,
  MULTIPLAYER_WORLD_STALE_MS: 3200,
  MULTIPLAYER_WORLD_SNAP_DISTANCE: 720,
  MULTIPLAYER_WORLD_MAX_ENEMIES: 16,
  MULTIPLAYER_WORLD_MAX_SHARDS: 64,

  AUDIO_THRUST_SAMPLE_GAIN: 0.18,      // level of looped thrust.wav when present
  AUDIO_THRUST_RATE_MIN: 0.92,         // idle playback rate for thrust.wav
  AUDIO_THRUST_RATE_MAX: 1.24,         // full-thrust playback rate for thrust.wav
  AUDIO_THRUST_FILTER_MIN_HZ: 420,     // idle filter for thrust.wav
  AUDIO_THRUST_FILTER_MAX_HZ: 2400,    // full-thrust filter for thrust.wav

  AUDIO_BLASTER_GAIN: 0.08,            // one-shot gain for blaster-fire.wav
  AUDIO_SHIP_DESTROYED_GAIN: 0.12,     // one-shot gain for ship-destroyed.wav
  AUDIO_SOL_DESTROYED_GAIN: 0.45,      // one-shot gain for sol-destroyed.wav
  AUDIO_NEXT_WAVE_GAIN: 0.14,           // one-shot gain for next-wave.wav
  AUDIO_OORT_BREAK_GAIN: 0.10,          // one-shot gain for oort-break.wav
  AUDIO_OORT_STRIKE_GAIN: 0.16,         // one-shot gain for oort-strike.wav
  AUDIO_OORT_DUST_GAIN: 0.12,           // max gain for looped oort-dust.wav while abrading shields
  AUDIO_OORT_DUST_FILTER_HZ: 2600,      // high, icy dust tone when the optional loop is present
  AUDIO_SPHERE_ACTIVATE_GAIN: 0.18,      // one-shot gain for sphere-activate.wav

  AUDIO_ROOM_CREATE_GAIN: 0.13,
  AUDIO_ROOM_INVITE_GAIN: 0.10,
  AUDIO_ROOM_INVITE_RECEIVED_GAIN: 0.12,
  AUDIO_ROOM_JOIN_GAIN: 0.13,
  AUDIO_ROOM_LEAVE_GAIN: 0.11,
  AUDIO_SIGNAL_LOCK_GAIN: 0.12,
  AUDIO_SIGNAL_LOST_GAIN: 0.13,
  AUDIO_TRANSPONDER_PING_GAIN: 0.055,
  AUDIO_RELAY_FALLBACK_GAIN: 0.12,
};

export const TAU = Math.PI * 2;

export type SolidKind = "tetra" | "cube" | "octa" | "dodeca" | "icosa";

export const MET_EDGES: number[][] = (() => {
  const edges: number[][] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = i + 1; j < 13; j++) edges.push([i, j]);
  }
  return edges;
})();

export const DOWNGRADE: Record<SolidKind, SolidKind | null> = {
  icosa: "dodeca",
  dodeca: "octa",
  octa: "cube",
  cube: "tetra",
  tetra: null,
};

export const DEBRIEF_SEQUENCE = {
  burnFadeMs: 2250,
  gameOverHoldMs: 3750,
  rowRevealMs: 900,
  readyPromptDelayMs: 1200,
  autoReturnMs: 24000,
} as const;

export const DEFAULT_INSERT_COIN_LINES = [
  "METATRON VECTOR FOIL",
  "PRESS ENTER TO LAUNCH",
  "DEFEND SOL. AWAKEN THE TREE. SURF THE WELL.",
  "FURTHER IN. FASTER THROUGH.",
];

export const DEFAULT_FLIGHT_HINTS = [
  "Stable orbit requires sideways velocity.",
  "Burn prograde to raise apoapsis.",
  "A close pass by Sol can buy speed or death.",
  "Return to the burn.",
  "Wide Oort excursions reset the fight on your terms.",
  "Long shots count more when the void agrees with you.",
];

export const DEFAULT_DEATH_CAUSE_LINES = [
  "DESTROYED BY SHRAPNEL",
  "LOST TO THE WELL",
  "SOL BREACHED",
  "STRUCTURAL FAILURE",
  "OUT OF FUEL",
  "VECTOR COLLAPSE",
  "OORT CLOUD STRIKE",
];

export const DEFAULT_GAME_OVER_LINES = [
  "GAME OVER",
  "PILOT DEBRIEF",
  "TOP CALLSIGNS APPROACH",
  "PRESS START TO FLY AGAIN",
];

export const DEFAULT_COMMENDATIONS: CommendationDefinition[] = [
  { id: "longShot", category: "gunnery", label: "GUNNERY CITATION: LONG SHOT", subtitle: "RANGING SOLUTION CONFIRMED", tier: 2 },
  { id: "salvoConnect", category: "gunnery", label: "GUNNERY CITATION: SALVO CONNECT", subtitle: "MULTIPLE ROUNDS AGREED", tier: 2 },
  { id: "fullSalvo", category: "gunnery", label: "GUNNERY CITATION: FULL SALVO", subtitle: "EVERY ROUND FOUND ITS DOCTRINE", tier: 2 },
  { id: "slingshot", category: "pilotage", label: "PILOT CITATION: SLINGSHOT", subtitle: "TRAJECTORY ADVANTAGE", tier: 2 },
  { id: "highGTurn", category: "pilotage", label: "PILOT CITATION: HIGH-G TURN", subtitle: "STRUCTURAL LIMIT APPROACHED", tier: 2 },
  { id: "returnToTheBurn", category: "pilotage", label: "PILOT CITATION: RETURN TO THE BURN", subtitle: "ENGAGEMENT SOLUTION REACQUIRED", tier: 2 },
  { id: "oortReach", category: "pilotage", label: "PILOT CITATION: OORT REACH", subtitle: "BLACK ICE NAVIGATED", tier: 2 },
  { id: "periapsisKiss", category: "pilotage", label: "PILOT CITATION: PERIAPSIS KISS", subtitle: "CLOSE SOL PASS SURVIVED", tier: 2 },
  { id: "nodeAwakened", category: "geometry", label: "NODE AWAKENED", subtitle: "SEPHIRA RESPONDS", tier: 3 },
  { id: "allSpheresLit", category: "geometry", label: "ALL SPHERES LIT", subtitle: "METATRONIC PHASE TRANSITION", tier: 3 },
];


export const AUDIO = {
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
    debrief: T.AUDIO_MODE_DEBRIEF_DRONES,
  } as const,
  FALLBACK_BUFFER_SECONDS: 6,
};

export const DEFAULT_PLAYER = { authenticated: false, authProvider: "none", callsign: null, canChooseCallsign: false };
