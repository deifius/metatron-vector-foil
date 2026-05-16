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
