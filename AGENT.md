# AGENT.md — Metatron Vector FOIL

## Project Identity

Metatron Vector FOIL is an oscilloscope/vector-arcade sacred-geometry shooter. It should feel like Polybius, Geometry Wars, a cockpit instrument panel, orbital mechanics, and a half-malfunctioning metaphysical machine.

The player pilots a sphenic gravjammer around Sol, defending the Metatron lattice from hostile Platonic vector foils. Preserve the strange, ritual, analog, phosphor-burn aesthetic. Do not make the game look like a generic modern sci-fi dashboard.

## Multiplayer / Constellation Defense Guidance

The multiplayer system design lives in `docs/MULTIPLAYER_SYSTEM.md`. Any multiplayer work must keep the same retro oscilloscope/vector-scope identity as the rest of the game.

- Treat rooms as defense channels or carrier traces, not modern lobbies.
- Treat invites as callsign vectors and joins as signal locks.
- Render remote pilots as dim sphenic corsair traces with small transponder labels.
- Use the central server for identity, callsigns, rooms, invites, WebRTC signaling, config hashes, and leaderboards.
- Prefer peer-to-peer WebRTC DataChannels for gameplay traffic, with host-authoritative simulation as the first network model.
- Keep early P2P multiplayer unranked or clearly marked as unverified until server verification/anti-cheat exists.
- Do not show gameplay HUD widgets on the title/loading screen; the front page should remain sparse and readable.
- Multiplayer audio should load optional files from `/static/audio/` and fall back to restrained synthetic carrier/signal sounds when files are missing.

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

Even when `email` and `profile` are present in the ID token, the app should not store those profile fields for leaderboard purposes. The production implementation derives a server-peppered HMAC from Google's stable issuer + `sub` pair and stores that non-reversible identity key instead of the raw Google `sub`. Do not store Google access tokens, refresh tokens, ID tokens, profile photos, real names, or email addresses for the arcade game. Use the player-chosen callsign as the public identity.

### Public Player Identity

- Players choose an exact 3-character callsign.
- Callsigns are case-sensitive: `ABC`, `Abc`, and `abc` are different callsigns.
- For security and legibility, callsigns are restricted to ASCII letters and digits: `A-Z`, `a-z`, `0-9`.
- Callsigns are display identifiers, not login secrets. Never authenticate a player by callsign alone.
- Callsign claiming requires an authenticated account. Anonymous/browser-session visitors may play locally but may not reserve public callsigns or publish persistent scores.
- Callsigns are account-bound and immutable from the arcade UI once assigned; admin/manual database repair is the only expected change path.
- Login controls belong only inside the Pilot Callsign console on the press-start/attract screen. Do not add a persistent top-right account widget, and do not show Google/dev login controls during active gameplay or debrief presentation.
- Public leaderboards may show only callsign, score, wave, survival time, and submission time.
- Do not expose email, Google display name, Google avatar URL, IP address, user-agent, session ID, OAuth token, or raw telemetry in public leaderboard responses.

### Data Collection Minimization

Store the minimum viable data:

- A server-peppered HMAC identity key derived from Google issuer + `sub` when OAuth is enabled.
- Anonymous session identifier only for CSRF/session continuity, not for public callsign ownership.
- Player callsign, only after authentication.
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
MVF_DEV_AUTH_ENABLED=0        # production must remain 0; dev-only fake account login
MVF_IDENTITY_PEPPER='long-random-identity-hash-pepper'
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
MVF_IDENTITY_PEPPER='different-long-random-identity-pepper'
MVF_LOG_PEPPER='different-long-random-log-pepper'
MVF_DB_PATH=/var/lib/metatron-vector-foil/metatron-vector-foil.sqlite3
MVF_LOG_PATH=/var/log/metatron-vector-foil/app.log
MVF_COOKIE_SECURE=1
MVF_ENABLE_HSTS=1
GOOGLE_OAUTH_CLIENT_ID='your Google OAuth web client ID'
GOOGLE_OAUTH_CLIENT_SECRET='your Google OAuth client secret'
GOOGLE_OAUTH_REDIRECT_URI='https://metatron.inasra.me/auth/google/callback'
```

The audit trail intentionally stores hashed IP/user-agent fingerprints, not raw IP addresses or browser strings. This preserves enough correlation for abuse investigation while reducing the privacy blast radius if the database or logs are exposed.

### Google OAuth Implementation Rules

Production login uses server-side Google OpenID Connect / OAuth Authorization Code flow. The browser never receives or stores Google OAuth tokens; it only navigates to `/auth/google/start` and returns through `/auth/google/callback`. The Flask server exchanges the authorization code, validates the ID token with Google's Python verification library, checks issuer, audience, signature, expiration, state, and nonce, then derives the private account key as `HMAC(MVF_IDENTITY_PEPPER, issuer + sub)`. Email, display name, avatar, raw `sub`, ID token, access token, and refresh token are not stored.

Required Google Console settings:

- OAuth client type: **Web application**.
- Authorized JavaScript origins: the production origin, for example `https://metatron.inasra.me`.
- Authorized redirect URI: the exact callback URL, for example `https://metatron.inasra.me/auth/google/callback`.
- OAuth consent scopes: only `openid`, `email`, and `profile`.

Production environment variables:

```bash
GOOGLE_OAUTH_CLIENT_ID='your Google OAuth web client ID'
GOOGLE_OAUTH_CLIENT_SECRET='your Google OAuth client secret'
GOOGLE_OAUTH_REDIRECT_URI='https://metatron.inasra.me/auth/google/callback'
MVF_GOOGLE_OAUTH_ENABLED=1
MVF_IDENTITY_PEPPER='long-random-identity-hash-pepper'
MVF_DEV_AUTH_ENABLED=0
```

Optional Google Workspace gate:

```bash
GOOGLE_OAUTH_ALLOWED_HD='example.com'
```

Only set `GOOGLE_OAUTH_ALLOWED_HD` if the game should reject consumer Gmail accounts and only allow accounts from a specific Workspace domain. The public arcade should normally leave this unset.

Development builds may set `MVF_DEV_AUTH_ENABLED=1` to expose `/api/dev-login` for fake account sessions. This endpoint must remain disabled in production and must never be treated as a replacement for Google OAuth.

### Leaderboard Security Rules

- Require authenticated login and a callsign before accepting persistent score submissions.
- Rate-limit callsign claims and score submissions. Callsigns are not changeable through the public UI after assignment.
- Validate submitted score payloads server-side for type, range, and shape.
- Treat browser-submitted scores as untrusted. The current leaderboard is an arcade honor board, not a cryptographically authoritative tournament system.
- Prefer one best score per player on the public board so a single pilot cannot flood the list.
- Keep public leaderboard payloads tiny and intentionally boring. The weirdness belongs in the game, not in exposed identity data.

## Important Files

- `src/MetatronVectorFOIL.tsx`
  - Main game loop, physics, rendering, entities, audio integration, Metatron node logic.
  - This file is large but canonical.
  - Do not put tunable constants back into this file. Import them from config modules.
  - Do not perform broad refactors unless explicitly asked.

- `src/config/gameConstants.ts`
  - Central gameplay, geometry, debrief, audio, and default public-player constants.
  - Add new gameplay tuning values here rather than inside `MetatronVectorFOIL.tsx`.

- `app_config.py`
  - Central Flask/server runtime constants: identity policy, rate limits, log knobs, request limits, security headers, and leaderboard limits.
  - Prefer environment-backed settings here rather than scattering `os.environ.get(...)` calls through `app.py`.

- `src/ui/hud/`
  - Modular HUD components.
  - HUD changes should usually happen here.

- `src/config/scoring.ts`
  - Score values and scoring tables.

- `src/config/thresholds.ts`
  - Score/achievement thresholds and gameplay scoring thresholds.

- `src/config/unlocks.ts`
  - Unlock-related feature flags.

- `src/ui/hud/hudConfig.ts`
  - HUD layout, refresh interval, widget defaults, and HUD tuning constants.

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
- `instance/`
- `*.sqlite3`
- `*.db`
- `*.log`
- `logs/`

The JS bundle is generated from TypeScript using esbuild.

## Constants and Configuration Separation

Keep constants out of active scripts and components. The active code should import configuration from purpose-built modules rather than defining large constant blocks inline. This makes user tuning safer and prevents gameplay, security, and logging knobs from being scattered through the machinery.

Current homes:

- Gameplay/world/audio/debrief constants: `src/config/gameConstants.ts`
- Scoring constants: `src/config/scoring.ts`
- Scoring thresholds: `src/config/thresholds.ts`
- Unlock flags: `src/config/unlocks.ts`
- HUD layout/defaults: `src/ui/hud/hudConfig.ts`
- Flask/server/security/logging constants: `app_config.py`

Small local constants that are truly derived values inside a helper are acceptable, but user-tunable knobs and policy values should live in one of the config files above.

## Coding Rules

- Preserve TypeScript strictness.
- Prefer small, focused patches.
- Do not rewrite unrelated systems.
- Do not replace existing tunable constants with hard-coded values.
- Add new gameplay tuning values to `src/config/gameConstants.ts`; add HUD tuning values to `src/ui/hud/hudConfig.ts`; add server/runtime settings to `app_config.py`.
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
- Activated spheres should be lit directionally by Sol: bright on the Sol-facing side, dim/shadowed on the far side, and not drawn as independent self-luminous stars.
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

The active multiplayer track is **Constellation Defense**. The current code includes the retro lobby/front-page shell, server-backed room/invite/status scaffolding, WebRTC DataChannel signal lock, live remote pilot traces, client-to-host `pilot_input` telemetry, host-authored `world_snapshot` telemetry, and unverified P2P contribution debriefs. The host is the first shared-defense authority: peer input can spawn allied fire in the host simulation, host snapshots carry shared enemy/sphere/Sol/team-score summaries, host-side ledgers credit hits/kills/assists/awakenings from actual impacts, and clients suppress local enemy simulation while rendering/adopting fresh host scope telemetry. Keep all additions retro-oscilloscope in language and presentation.

Near-term multiplayer goals:

- Keep room/invite/callsign UI phrased as carrier/signal/trace language.
- Maintain identity authority on the Flask server; do not trust peer-provided callsigns.
- Keep early P2P results unranked/unverified.
- Use WebRTC DataChannel for gameplay packets after PHOSPHOR LOCK.
- Improve prediction/correction rules before treating P2P shared-defense results as ranked or server-verified.
- Keep gameplay HUD widgets hidden from the front/title screen.

Metatron cube tuning remains important; preserve the existing recoupled visible/gameplay sphere behavior unless explicitly asked to change it.

## Do Not

- Do not casually remove the weird prose.
- Do not simplify the premise into “space shooter.”
- Do not remove occult/sacred-geometry terminology.
- Do not flatten the style into generic sci-fi.
- Do not overwrite tuned constants without calling it out.
- Do not edit backup files unless asked.
- Do not produce a full repo zip when only one or two files changed, unless asked.
