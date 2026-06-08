
# Metatron Vector FOIL

**Metatron Vector FOIL** is a sacred-geometry arcade shooter about orbital motion, vector combat, and the defense of a star at the center of a collapsing cosmology.

You are the Metatron, and you must defend the two-dimensional Tree of Life constructed around your celestial body from the polyhedral vector foils that threaten to collapse your star and your very existence into a one-dimensional ticker tape. Pilot your **sphenic gravjammer**, surf orbital trajectories, and weave through Riemann space to repel the Vector Foil incursion from beyond the dark forest of the Drake Equation.

## Premise

At the center of the playfield burns **Sol**, the radiant heart of the Metatronic lattice. Around it is suspended a thirteen-node geometric structure inspired by the **Metatron Cube**: a two-dimensional celestial machine, a star map, a Tree of Life, a battlefield.

From the outer dark arrive hostile **Platonic solids** — tetrahedra, cubes, octahedra, dodecahedra, and icosahedra: drawn inward by gravity and bent on collapsing your plane of harmony. If they reach Sol, all symmetry fails.


## Core Gameplay

Metatron Vector FOIL is built around **orbital combat** rather than flat-screen movement. The player ship moves through a strong central gravity field, and success depends on learning how to:

- maintain or break orbit around Sol
- slingshot through the inner geometry for speed
- manage thrust, fuel, and braking
- line up shots while under gravitational pull
- prevent enemy polyhedra from spiraling into the center
- survive the debris fields created when solids fracture

Rather than wrapping around the screen, the game world remains centered on Sol, and the **camera pulls back** as needed to preserve the geometry of the encounter space. This keeps the action focused on the sacred center instead of turning space into a torus.

## Gameplay Mechanics

### Orbital Physics
The heart of the game is a central gravitational well. Your sphenic gravjammer is always in negotiation with Sol's pull, which means movement is about momentum, arc, approach, and escape rather than simple directional travel.

- Gravity is strong and deliberate
- Movement rewards tangential flight and orbital intuition
- Braking is handled as **drag**, reducing current velocity rather than applying raw reverse thrust
- Skilled play involves using gravity as both weapon and shield

### The Defense of Sol
Enemies are pulled inward toward Sol. If too many reach the center, the star collapses and the run is lost.

Sol is the anchor of the game’s physics, the object under siege, and the thing you are defending at all times.

### Platonic Solid Enemies
The enemy roster is composed of hostile geometric bodies, each with its own structural identity within the polyhedral hierarchy.

Current enemy classes include:

- **Tetrahedron**
- **Cube**
- **Octahedron**
- **Dodecahedron**
- **Icosahedron**

### Polyhedral Devolution
Enemy solids do not simply disappear when hit. Higher-order solids **devolve into lower-order forms**, turning each engagement into a shifting geometric cascade.

A typical progression follows the descending hierarchy, such as:

**Icosahedron → Dodecahedron → Octahedron → Cube → Tetrahedron**

This gives battles a layered feel: large enemies fragment into simpler and more immediate threats rather than vanishing cleanly.

### Gravitational Shrapnel
When a solid is struck, it throws off **shrapnel from the point of impact**. That debris is also subject to gravity.

This means shrapnel can:

- arc back toward Sol
- scatter into the player’s path
- deflect or disrupt other enemies
- turn a good shot into a dangerous local storm

The result is a combat system where every hit changes the geometry of nearby space.

### Node Awakening and Regeneration
The circles of the Metatron structure are not only visual motifs. Under the right conditions, they can become active gameplay zones.

Destroyed enemies and impacts can **awaken nodes** in the lattice, turning circles into energized spherical regions. These provide recovery benefits:

- staying within active circles can **refuel** the player
- awakened node spheres can restore **shields**
- inner-ring regeneration exists, but node spheres provide the more meaningful bonus

This creates moments where defense, navigation, and recovery overlap: sometimes the safest move is to dive back into the geometry itself.

### Shields, Fuel, and Survival
Your ship is not infinitely durable.

- **Fuel** limits sustained thrust and demands efficient piloting
- **Shields / resilience** determine how many hits your ship can absorb
- Staying trapped deep in the gravity well for too long can be fatal
- Careless flight is punished as much as enemy contact

The game is designed so that survival depends on reading trajectories, not merely reacting to impact flashes.

## Why It Plays Differently

Metatron Vector FOIL is meant to feel like a cross between:

- a vector arcade shooter
- an orbital mechanics toy
- a sacred-geometry visualization
- a collapsing cosmological diagram you happen to be piloting through

You are not just dodging enemies in space. You are defending a metaphysical machine by mastering its physics.

## Controls

| Action | Key |
|---|---|
| Rotate Left | `A` |
| Rotate Right | `D` |
| Thrust | `W` |
| Brake / Drag | `S` |
| Fire Blaster | `Space` |

## Features

- Sacred-geometry playfield based on the **Metatron Cube**
- Strong central gravity centered on **Sol**
- Physics-driven orbital movement
- Platonic solid enemy hierarchy
- Enemy devolution into lower-order solids
- Impact-based gravitational shrapnel
- Node awakening, fuel recovery, and shield regeneration
- Expanding camera instead of screen wrap
- Stylized vector-space combat with metaphysical sci-fi framing
- Planned **Constellation Defense** multiplayer mode: callsign invites, P2P/WebRTC gameplay traffic, host-authoritative shared Sol defense, team/individual debriefs, and oscilloscope-native lobby/audio treatment. See `docs/MULTIPLAYER_SYSTEM.md`.


## Multiplayer Design: Constellation Defense

The multiplayer roadmap is documented in [`docs/MULTIPLAYER_SYSTEM.md`](docs/MULTIPLAYER_SYSTEM.md). The intended model is hybrid: the central Flask server handles identity, callsigns, rooms, invites, WebRTC signaling, configuration hashes, and leaderboards, while gameplay packets use peer-to-peer WebRTC DataChannels whenever possible. LAN play should get the lowest-latency direct route; remote play should attempt direct P2P before any relay fallback.

Multiplayer must preserve the retro oscilloscope aesthetic. Rooms are defense channels, callsign invites are signal vectors, joins are signal locks, and remote pilots are dim phosphor traces rather than modern avatar markers. Gameplay HUD widgets should remain hidden until an active run begins so the front/title screen stays sparse.

Current multiplayer status: UI/audio/remote-trace scaffolding, a lightweight Flask room/invite coordination layer, identity-checked WebRTC signal lock, live `pilot_trace` telemetry, host-authored `world_snapshot` packets, and an initial true shared-defense loop now exist. Accepted callsigns can negotiate a P2P DataChannel, exchange heartbeats, see each other’s sphenic corsairs, and let the client send `pilot_input` packets to the host. The host uses authorized peer input to emit allied fire into the host simulation, steer enemies toward the nearest pilot trace, and broadcast shared enemy/sphere/Sol/team-score telemetry. Host-side contribution accounting now records per-pilot hits, kills, assists, awakenings, and scores from actual host-simulated bullet impacts; debriefs are labeled `P2P / UNVERIFIED` and include a team/pilot contribution lattice. This is still unranked P2P; relay fallback, multi-peer mesh/rooms beyond the first peer, robust correction, host migration, server persistence, and server verification remain future passes. ICE servers are empty by default for privacy/LAN testing; configure `MVF_MULTIPLAYER_ICE_SERVERS_JSON` for remote STUN/TURN routing.

## Tech Stack

- **React**
- **TypeScript**
- **esbuild**
- **Flask** for lightweight local serving during development

## Production Google Login

Production authentication is handled server-side with Google OpenID Connect / OAuth Authorization Code flow. The browser never receives Google OAuth tokens; it only visits `/auth/google/start` and returns through `/auth/google/callback`. The server validates the ID token and stores a server-peppered HMAC identity key, not the player's raw Google `sub`, email, name, avatar, access token, refresh token, or ID token.

The login button is intentionally shown only inside the **Pilot Callsign** console on the press-start/attract screen. There is no persistent top-right account button during gameplay; once the run begins, the arcade view stays clean and the public identity is reduced to the callsign/leaderboard system.

In the Google Cloud Console, configure the OAuth client as a **Web application** and add the exact production origin and callback URL:

```text
Authorized JavaScript origin: https://metatron.inasra.me
Authorized redirect URI:     https://metatron.inasra.me/auth/google/callback
```

Production environment example:

```bash
FLASK_SECRET_KEY='long-random-session-secret'
MVF_IDENTITY_PEPPER='different-long-random-identity-pepper'
MVF_LOG_PEPPER='different-long-random-log-pepper'
MVF_DB_PATH=/var/lib/metatron-vector-foil/metatron-vector-foil.sqlite3
MVF_LOG_PATH=/var/log/metatron-vector-foil/app.log
MVF_COOKIE_SECURE=1
MVF_ENABLE_HSTS=1
MVF_DEV_AUTH_ENABLED=0
GOOGLE_OAUTH_CLIENT_ID='your Google OAuth web client ID'
GOOGLE_OAUTH_CLIENT_SECRET='your Google OAuth client secret'
GOOGLE_OAUTH_REDIRECT_URI='https://metatron.inasra.me/auth/google/callback'
MVF_GOOGLE_OAUTH_ENABLED=1
```

Only set `GOOGLE_OAUTH_ALLOWED_HD` if you intentionally want to restrict login to a single Google Workspace domain. Public arcade deployments should usually leave it unset.
