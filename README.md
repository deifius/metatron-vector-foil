
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

## Tech Stack

- **React**
- **TypeScript**
- **esbuild**
- **Flask** for lightweight local serving during development
