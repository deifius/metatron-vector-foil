# AGENT.md — Metatron Vector FOIL

## Project Identity

Metatron Vector FOIL is an oscilloscope/vector-arcade sacred-geometry shooter. It should feel like Polybius, Geometry Wars, a cockpit instrument panel, orbital mechanics, and a half-malfunctioning metaphysical machine.

The player pilots a sphenic gravjammer around Sol, defending the Metatron lattice from hostile Platonic vector foils. Preserve the strange, ritual, analog, phosphor-burn aesthetic. Do not make the game look like a generic modern sci-fi dashboard.

## Core Design Priorities

- Orbital motion is central. Movement should reward momentum, slingshots, tangential approaches, and gravity reading.
- Sol is the sacred center and primary gravity well.
- The Metatron lattice is both a visual structure and a gameplay system.
- Enemies are Platonic solids that devolve through lower-order forms.
- Shrapnel should remain physical, dangerous, and affected by gravity.
- UI should feel like old tactical instrumentation, oscilloscopes, vector scopes, avionics, and arcade cabinet overlays.
- Prefer tunable constants over hard-coded magic numbers.


## Security, Identity, and Leaderboard Strategy

Metatron Vector FOIL should treat identity as a minimal badge, not a data hose. The game may use Google sign-in in production, but Google should only prove that a returning pilot is the same account holder. Do not request Drive, Gmail, Calendar, Contacts, YouTube, or other Google API scopes for the arcade game. The intended Google OIDC scope set is only:

```text
openid email profile
```

Even when `email` and `profile` are present in the ID token, the app should store only the stable Google `sub` claim unless there is a specific product requirement to do otherwise. Do not store Google access tokens, refresh tokens, profile photos, real names, or email addresses for leaderboard purposes. Use the player-chosen callsign as the public identity.

### Public Player Identity

- Players choose an exact 3-character callsign.
- Callsigns are case-sensitive: `ABC`, `Abc`, and `abc` are different callsigns.
- For security and legibility, callsigns are restricted to ASCII letters and digits: `A-Z`, `a-z`, `0-9`.
- Public leaderboards may show only callsign, score, wave, survival time, and submission time.
- Do not expose email, Google display name, Google avatar URL, IP address, user-agent, session ID, OAuth token, or raw telemetry in public leaderboard responses.

### Data Collection Minimization

Store the minimum viable data:

- `google_sub` when OAuth is enabled.
- Anonymous session identifier for local/dev/non-OAuth play.
- Player callsign.
- Score, wave, survival duration, and small run-summary values needed for leaderboard ranking.

Avoid storing full run telemetry unless a later anti-cheat or replay system explicitly requires it. If such telemetry is added, it must be clearly separated from public leaderboard data and protected as private player data.

### Server Hardening Rules

- Serve production only over HTTPS.
- Set `FLASK_SECRET_KEY` in the environment; never commit it.
- Set `MVF_COOKIE_SECURE=1` in production so session cookies are sent only over HTTPS.
- Enable HSTS in production with `MVF_ENABLE_HSTS=1` after HTTPS is confirmed stable.
- Keep session cookies `HttpOnly` and `SameSite=Lax` or stricter.
- Require CSRF tokens for state-changing API routes.
- Validate Origin on state-changing API routes.
- Return `Cache-Control: no-store` for API responses that include player/session state.
- Send defensive headers: CSP, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, Permissions-Policy.
- Keep OAuth client secrets, database paths, and Flask secrets in environment variables or service files outside git.
- Do not log OAuth tokens, CSRF tokens, session cookies, or full callback URLs.


### Logging and Audit Strategy

Logging is part of the security boundary. Logs must help diagnose abuse, leaderboard tampering, deployment errors, and broken clients without becoming a shadow database of player identity.

Principles:

- Use structured JSON logs in production so Caddy/nginx, systemd-journald, fail2ban, or a future SIEM can consume them.
- Include a request ID on every response and every structured log line.
- Log event type, severity, method, path without query string, status code, duration, player ID when known, callsign when known, hashed IP, hashed user-agent, and sanitized event details.
- Never log cookies, session IDs, CSRF tokens, OAuth state/nonce values, Google `sub`, ID tokens, access tokens, refresh tokens, email addresses, real names, avatars, request bodies, or full OAuth callback URLs.
- Hash IP addresses and user-agent strings with a server-side pepper (`MVF_LOG_PEPPER`) before they enter logs or audit tables.
- Treat logs and audit tables as sensitive operational data. They must not be served from the web root or committed to git.
- Keep normal application logs rotating; do not let logs fill the disk and kill the arcade cabinet.
- Keep durable audit rows for security-relevant events: rejected API requests, callsign collisions, callsign claims, score submissions, suspicious score integrity flags, client render/score errors, and unhandled server exceptions.
- Public leaderboard APIs must never expose audit details.

Implemented environment knobs:

```bash
MVF_LOG_LEVEL=INFO              # DEBUG, INFO, WARNING, ERROR, CRITICAL
MVF_LOG_JSON=1                  # 1 = JSON lines, 0 = simple text logs
MVF_LOG_PATH=/var/log/metatron-vector-foil/app.log
MVF_LOG_MAX_BYTES=2097152       # rotating file size
MVF_LOG_BACKUPS=5               # rotating backup count
MVF_LOG_PEPPER='long-random-log-hash-pepper'
MVF_LOG_STATIC=0                # set 1 only when debugging static asset delivery
MVF_ACCEPT_CLIENT_DEBUG_LOGS=0  # keep debug noise off in production
```

Recommended production ownership:

```bash
sudo mkdir -p /var/log/metatron-vector-foil /var/lib/metatron-vector-foil
sudo chown www-data:www-data /var/log/metatron-vector-foil /var/lib/metatron-vector-foil
sudo chmod 750 /var/log/metatron-vector-foil /var/lib/metatron-vector-foil
```

Recommended production environment additions:

```bash
FLASK_SECRET_KEY='long-random-session-secret'
MVF_LOG_PEPPER='different-long-random-log-pepper'
MVF_DB_PATH=/var/lib/metatron-vector-foil/metatron-vector-foil.sqlite3
MVF_LOG_PATH=/var/log/metatron-vector-foil/app.log
MVF_COOKIE_SECURE=1
MVF_ENABLE_HSTS=1
```

The audit trail intentionally stores hashed IP/user-agent fingerprints, not raw IP addresses or browser strings. This preserves enough correlation for abuse investigation while reducing the privacy blast radius if the database or logs are exposed.

### Google OAuth Implementation Rules

When Google OAuth is implemented, use server-side Authorization Code flow rather than handling tokens entirely in browser code. Validate ID tokens server-side using a well-maintained Google/Python client library or JOSE/JWT library. Validate issuer, audience, signature, expiration, and nonce/state. Store the `sub` claim as the stable account key; do not use email as the primary account key. Do not store refresh tokens unless a future feature truly requires offline Google API access, which the arcade game should not need.

### Leaderboard Security Rules

- Require a callsign before accepting persistent score submissions.
- Rate-limit callsign changes and score submissions.
- Validate submitted score payloads server-side for type, range, and shape.
- Treat browser-submitted scores as untrusted. The current leaderboard is an arcade honor board, not a cryptographically authoritative tournament system.
- Prefer one best score per player on the public board so a single pilot cannot flood the list.
- Keep public leaderboard payloads tiny and intentionally boring. The weirdness belongs in the game, not in exposed identity data.

## Important Files

- `src/MetatronVectorFOIL.tsx`
  - Main game loop, physics, rendering, entities, audio integration, Metatron node logic.
  - This file is large but canonical.
  - Do not perform broad refactors unless explicitly asked.

- `src/ui/hud/`
  - Modular HUD components.
  - HUD changes should usually happen here.

- `src/config/scoring.ts`
  - Score values and scoring tables.

- `src/config/thresholds.ts`
  - Score/achievement thresholds and gameplay scoring thresholds.

- `src/config/unlocks.ts`
  - Unlock-related feature flags.

- `static/text/`
  - Cabinet prose, game-over lines, alerts, commendations, hints.

- `src/BCKUPMetatronVectorFOIL.tsx`
  - Backup/reference file only.
  - Do not edit unless explicitly requested.

## Build and Run

Install dependencies:

```bash
npm install
```

Build browser bundle:

```bash
npm run build
```

Watch rebuilds:

```bash
npm run watch
```

Run local Flask server:

```bash
python3 app.py
```

Then open:

```text
http://localhost:5000
```

Use Node 18 or newer. Do not run `npm audit fix --force` unless explicitly requested, because it may introduce breaking changes.

## Generated / Ignored Files

The following are ignored and should not be committed:

- `node_modules/`
- `.venv/`
- `static/main.js`
- `static/main.js.map`
- `static/audio/*`
- `__pycache__/`

The JS bundle is generated from TypeScript using esbuild.

## Coding Rules

- Preserve TypeScript strictness.
- Prefer small, focused patches.
- Do not rewrite unrelated systems.
- Do not replace existing tunable constants with hard-coded values.
- Add new tuning values to the `T` constants block unless there is a strong reason to put them elsewhere.
- Preserve existing user-tuned values unless the requested change specifically requires adjustment.
- Keep gameplay math deterministic and readable.
- Use helper functions for repeated vector/geometry logic.
- Avoid adding new dependencies unless the feature truly requires them.

## Patch Style

When asked to modify the project:

1. Identify the smallest set of files required.
2. Explain which files changed.
3. Prefer providing only changed files or a patch unless the user asks for a full repo zip.
4. Run or recommend `npm run build` after TypeScript changes.
5. Do not include generated `static/main.js` unless explicitly requested for deployment.

## Metatron Geometry Rules

The Metatron lattice should ultimately read as a canonical 13-circle Metatron’s Cube / Fruit-of-Life arrangement.

Important principles:

- Do not confuse circle radius with node spacing.
- The 13 nodes should be stable, tunable, and easy to reason about.
- Visual circle radius should live in constants and currently also defines the node’s gameplay region (awakening, refuel, and charge).
- Node spacing should live in `META_NODE_SPACING`; visual circle size should live in `META_CIRCLE_RADIUS`.
- Activated spheres should be persistent unless gameplay rules explicitly change.
- Activated spheres may become gravity wells, but their gravity must be separately tunable from Sol.
- Activated nodes should reveal faint connecting lines.
- The full 13-node activation should reveal the complete Metatron cube linework.

Early-game mystery is acceptable. By roughly three awakened spheres, the geometry should be clearly camera-aligned and readable as Metatron’s Cube.

## Visual Style Rules

The game should look:

- phosphorescent
- vector-drawn
- analog
- tactical
- slightly degraded
- ritualistic
- old arcade / oscilloscope inspired

Avoid:

- glossy modern SaaS UI
- generic neon cyberpunk
- clean corporate dashboard styling
- excessive smoothness
- flat minimalist panels that remove the haunted-instrument feel

## Audio Rules

Audio hooks may be procedural or sample-backed.

Expected sample paths:

```text
/static/audio/thrust.wav
/static/audio/blaster-fire.wav
/static/audio/ship-destroyed.wav
/static/audio/sol-destroyed.wav
/static/audio/next-wave.wav
```

Do not assume these files exist in git. They are ignored.

When samples are missing, procedural fallbacks should continue to work.

## Game Feel Rules

- Braking should be drag-like, not reverse thrust.
- Projectile mass may be tunable; mass `0` should behave like an energy weapon.
- Player resilience is the number of hits before destruction. Minimum should be 1.
- Shrapnel should originate from impact points.
- Shrapnel should be affected by gravity.
- Enemies and shrapnel can damage the player.
- Enemy devolution should preserve the sense of geometric collapse.

## Current Development Priority

The next major work area is the Metatron cube node system.

Goals:

- Separate Metatron circle radius from node spacing.
- Keep circle size, node spacing, and playfield/camera scale independently tunable.
- For the current build, Metatron gameplay regions are intentionally recoupled to visible circle size: awakening, refuel, and charging all use `META_CIRCLE_RADIUS`.
- Ensure the arrangement becomes clearly camera-aligned after approximately three node activations.
- Preserve rotation around Sol after alignment.
- Give activated spheres separately tunable gravity.
- Draw faint activated-node line segments.
- Pulse newly activated connections.
- Reveal the complete Metatron cube when all thirteen nodes are active.

## Do Not

- Do not casually remove the weird prose.
- Do not simplify the premise into “space shooter.”
- Do not remove occult/sacred-geometry terminology.
- Do not flatten the style into generic sci-fi.
- Do not overwrite tuned constants without calling it out.
- Do not edit backup files unless asked.
- Do not produce a full repo zip when only one or two files changed, unless asked.
