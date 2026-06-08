# Multiplayer System Design — Constellation Defense

## Status

This document describes the intended multiplayer addition for Metatron Vector FOIL. The current implementation is now an early unranked P2P shared-defense prototype: oscilloscope-style lobby/front-screen components, audio hook constants, remote pilot rendering, HUD/title cleanup, ephemeral Flask room/invite/status/signaling coordination, WebRTC DataChannel signal lock, live pilot traces, client-to-host pilot input, host-authored world snapshots, and initial host-owned allied fire/combat authority. It is playable as a first shared Sol-defense slice, but it is not ranked, server-verified, relay-hardened, or host-migration-safe.

## High Concept

**Constellation Defense** lets multiple pilots defend the same Sol and Metatron lattice while keeping individual scores. The mode is cooperative because all pilots share the same star, enemy wave, round state, Oort field, and game-over condition. It is competitive because each callsign keeps its own score, kills, assists, awakenings, survival time, and debrief line.

The multiplayer layer must feel like more signal traces entering the same sacred machine. It must not look like a modern lobby shooter, chat application, or generic web dashboard.

## Aesthetic Requirements

All multiplayer UI and effects must preserve the retro oscilloscope/vector-scope aesthetic:

- rooms are **defense channels** or **carrier traces**, not generic rooms;
- callsigns are **transponder returns**, not gamer tags;
- invites are **callsign vectors**, not social notifications;
- joins are **signal locks** or **second corsairs online**;
- remote pilots render as dim phosphor traces with small ID tags;
- no glossy panels, avatars, emoji chat, modern popups, or heavy HUD chrome;
- title/loading screens must stay sparse, with gameplay HUD widgets hidden until a run begins.

Guiding sentence:

> Multiplayer should feel like additional signal traces entering the same Metatron instrument, not like a new app bolted onto the game.

## Network Model

Use a hybrid model.

```text
Central server:
  identity, callsigns, rooms, invites, WebRTC signaling, config hashes, leaderboards

Gameplay traffic:
  peer-to-peer WebRTC DataChannel when possible

Authority:
  host-authoritative simulation

Fallback:
  relay/server path only when direct P2P fails
```

The central server should coordinate identity and signaling, not carry frame-by-frame gameplay by default.

## Why P2P

P2P supports the desired play pattern:

- LAN games should get very low latency and stay inside the local network after signaling.
- Remote games should attempt direct WebRTC first.
- Server load stays low.
- The fiction fits: the Metatron node introduces pilots, then their corsairs establish direct carrier lock.

Suggested signal-route labels:

```text
SIGNAL ROUTE: LOCAL PHOSPHOR LOCK
SIGNAL ROUTE: DIRECT DARK FOREST LINK
SIGNAL ROUTE: RELAYED THROUGH METATRON NODE
SIGNAL ROUTE: SIGNAL DEGRADED
```

## Authority Model

The first real networking pass should be **host-authoritative P2P**.

The host owns:

- enemy spawning and enemy positions;
- Sol damage and shared collapse state;
- round advancement;
- sphere activation and Oort hazard state;
- scoring events that affect the shared run.

Clients send:

- input state;
- occasional local pilot trace state;
- ping/invite/ready events.

Clients predict local ship feel for responsiveness and interpolate remote pilots/snapshots to avoid harsh jumps.

## Room Visibility

Supported room types:

- **Public** — visible in a future room browser.
- **Unlisted** — joinable by callsign invite or room code.
- **Private** — only invited callsigns may join.
- **LAN/local** — optional future mode if browser/platform constraints allow it.

Default friend-play mode should be **Unlisted**.

## Configuration Policy

Multiplayer must interact cleanly with saved ship/physics configurations.

Recommended policies:

```text
HOST LOCKED
  Everyone uses the host's ship and world config.
  Best for fair/team leaderboard comparison.

PERSONAL SHIPS, SHARED STAR
  Players bring personal ship configs.
  Host controls world/star/wave parameters.

OPEN LAB
  Experimental configs allowed.
  Unranked by default.
```

Every leaderboard row should store config policy, config hash, host callsign, pilot callsigns, visibility, and ranked/unranked state.

## Front Screen and HUD Rules

The front/title/loading screen should remain clean. Gameplay HUD widgets should not render until the player enters an active run.

Title/loading may show:

- title animation;
- callsign/login status;
- start prompt;
- multiplayer channel shell;
- one rotating hint line;
- minimal Sol/lattice background.

Title/loading should hide:

- shield/fuel HUD;
- speed/drift/trim/hits;
- gravitic trace;
- round/score gameplay widgets;
- combat telemetry;
- active multiplayer pilot telemetry.

Recommended UI modes:

```text
TITLE
LOBBY
COUNTDOWN
PLAYING
PAUSED
DEBRIEF
```

In the current codebase these map initially onto the existing `menu`, `playing`, `paused`, `transition`, and `debrief` modes. Avoid broad refactors until networking begins.

## Remote Pilot Rendering

Remote pilots should render as allied phosphor traces:

- dimmer sphenic corsair outline;
- small callsign label;
- faint vector tail;
- optional transponder pulse;
- optional offscreen pointer;
- damage/fuel state only when relevant.

Example tags:

```text
△ M11
△ J3X / LOW SHIELD
← S7B
```

Remote motion should be interpolated with a little trace jitter rather than sterile perfect motion. Network correction can be disguised as signal re-lock, phosphor smear, or a momentary static bloom.

## Audio Hooks

Multiplayer audio should follow the same pattern as existing Oort/sphere sounds: load optional files from `/static/audio/`; if absent, use restrained synthesized fallback sounds.

Suggested files:

```text
/static/audio/room-create.wav
/static/audio/room-invite.wav
/static/audio/room-invite-received.wav
/static/audio/room-join.wav
/static/audio/room-leave.wav
/static/audio/signal-lock.wav
/static/audio/signal-lost.wav
/static/audio/transponder-ping.wav
/static/audio/relay-fallback.wav
```

Sound direction:

- room created: low relay thunk plus rising carrier sweep;
- invite sent: short outbound radar chirp;
- invite received: double ping with faint static bloom;
- connecting: searching oscillator sweep;
- signal lock: two oscillators aligning into a stable tone;
- join: warm phase-lock tone;
- leave/lost: falling detune and broken carrier hiss;
- relay fallback: harsher modem-like switch click;
- transponder ping: quiet sonar blip.

## Message Shapes

Client to host input:

```json
{
  "type": "pilot_input",
  "seq": 1842,
  "tick": 9231,
  "thrust": true,
  "brake": false,
  "turn": -0.4,
  "fire": true,
  "ping": null
}
```

Client to host trace:

```json
{
  "type": "pilot_trace",
  "callsign": "M11",
  "x": 120.4,
  "y": -88.2,
  "vx": 2.1,
  "vy": -0.6,
  "angle": 1.82,
  "shield": 76,
  "fuel": 44
}
```

Host to clients snapshot:

```json
{
  "type": "world_snapshot",
  "tick": 9231,
  "round": 6,
  "solIntegrity": 82,
  "players": [],
  "enemies": [],
  "sphereStates": [],
  "events": []
}
```

## Scoring and Debrief

The debrief should separate team performance from individual performance.

Team stats:

- highest round reached;
- Sol integrity remaining;
- total foils destroyed;
- total survival time;
- spheres awakened;
- Oort hazards survived;
- config policy and config hash;
- pilot list.

Individual stats:

- score;
- kills;
- assists;
- damage dealt;
- accuracy;
- sphere activations;
- time alive;
- deaths/reconstitutions;
- fuel efficiency;
- close-call saves.

Assist scoring is important so multiplayer does not become last-hit competition.

## Implementation Phases

### Phase 0 — Documentation and UI cleanup

- Add this design document.
- Reference it from README and agent guidance.
- Hide gameplay HUD widgets on the title/front screen.
- Keep the front page sparse and oscilloscope-native.

### Phase 1 — Local scaffolding

- Add constants, types, and audio hooks.
- Add a Constellation Defense panel on the front screen.
- Add local room state and invite-shell behavior.
- Add remote pilot trace rendering scaffold.

### Phase 2 — Server room/invite layer

- Create room endpoint.
- Close room endpoint.
- Invite callsign endpoint.
- Pending invite polling endpoint.
- Invite accept/decline endpoint.
- Room visibility and config policy stored in the ephemeral signaling layer.
- Lobby backed by server state when a logged-in callsign is present.

Current limitation: this phase uses in-memory Flask process state. That is appropriate for the first signaling scaffold, but production multi-worker deployments will need Redis, SQLite persistence, or a dedicated signaling service before WebRTC matchmaking is reliable across processes/restarts.

### Phase 3 — WebRTC signaling and live pilot traces

- Exchange offers/answers through the server.
- Exchange ICE candidates through a server-side, identity-checked signal mailbox.
- Establish a WebRTC DataChannel.
- Send heartbeat messages over the DataChannel.
- Send live `pilot_trace` packets over the DataChannel.
- Interpolate remote pilot position, velocity, heading, shield, fuel, score, and status.
- Show carrier states using scope language: searching, phosphor lock, trace lost.
- Play signal lock/lost audio.

Current limitation: this now establishes a P2P carrier lock, heartbeat, live `pilot_trace` telemetry, client-to-host `pilot_input`, and a host `world_snapshot` stream. Remote allied corsairs render from real peer position, velocity, heading, shield, fuel, score, and status packets. The host can rate-limit authorized peer fire into real host bullets, apply those bullets to host enemies, steer hostiles toward the nearest pilot trace, and broadcast shared wave, score, Sol-integrity, enemy-contact, bullet/shard, pilot-score, and sphere-state telemetry. Clients with fresh host snapshots suppress local enemy simulation and adopt the host scope for shared Sol defense. This is still an unranked two-peer prototype: server verification, relay fallback, multi-peer fanout, host migration, strong correction, and full per-pilot scoring are future passes. ICE servers are intentionally empty by default for privacy/LAN testing; remote P2P can be enabled by setting `MVF_MULTIPLAYER_ICE_SERVERS_JSON` to a JSON array of STUN/TURN server objects.

### Phase 4 — Host-authoritative gameplay sync

- Client sends pilot input.
- Host simulates shared world.
- Host broadcasts snapshots.
- Clients interpolate remote pilots/enemies.
- Shared Sol, round, sphere, and enemy state become playable.

### Phase 5 — Multiplayer scoring and leaderboards

- Track individual score, kills, assists, and awakenings.
- Track team run summary.
- Add multiplayer debrief.
- Store unranked P2P leaderboard entries first.
- Add server-verified ranked mode later.

## MVP

The first playable MVP should include:

- one host and one client;
- callsign-based room join/invite;
- WebRTC DataChannel P2P;
- host-authoritative shared world;
- remote ship rendering;
- basic team/individual scoring;
- unranked multiplayer debrief;
- optional relay fallback later if direct P2P fails.

Do not delay friend/LAN multiplayer for perfect anti-cheat. Mark early runs clearly as unverified P2P.

## Current Implementation Status

Implemented so far:

- retro oscilloscope Constellation Defense panel;
- optional multiplayer SFX hooks with procedural fallbacks;
- gameplay HUD hidden from the front/title screen;
- ephemeral Flask room and invite layer;
- identity-checked signaling mailbox for offer/answer/ICE envelopes;
- WebRTC DataChannel negotiation between accepted callsigns;
- DataChannel heartbeat and carrier status display;
- signal lock/lost audio events;
- live remote pilot motion sync;
- client-to-host `pilot_input` packets;
- host-spawned allied fire from authorized peer input;
- host-authored enemy/sphere/Sol/team-score snapshots;
- client adoption of fresh host scope telemetry for shared defense.

Not implemented yet:

- robust prediction/correction and reconciliation;
- multi-peer fanout beyond the first accepted carrier target;
- complete per-pilot scoring/debrief persistence;
- relay fallback;
- host migration/reconnect recovery;
- Redis/durable signaling for multi-worker production deployments;
- ranked/server-verified multiplayer.
