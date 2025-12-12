# Metatron Vector FOIL

A React + Canvas + WebAudio prototype served by Flask.

## Features
- Start screen + pause menu (with sliders)
- Level progression: align the Metatron lattice → the star becomes a door → fly into it to advance
- Gravity well + orbital flight, contrails, bullets
- Polyhedra enemies with simple pursuit AI + dimensional collapse + shrapnel
- Shrapnel can become **fuel bits** that drift in the Oort ring; collect them for fuel
- Solar-sail light pressure from the central star (subtle but meaningful)
- Wavetable WebAudio SFX (thrust, shoot, hit, level up)

## Controls
- **A/D** rotate ship
- **W/S** sail/engine trim (W = push, S = brake/feather)
- **Space** shoot
- **P** pause (sliders + toggles)
- **M** toggle Metatron render
- **T** toggle contrails
- **B** toggle debug overlay
- **Enter** start / continue

## Dev
### 1) Install JS deps
```bash
npm install
```

### 2) Build once
```bash
npm run build
```

### 3) Run Flask
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000

### Watch mode (auto rebuild)
```bash
npm run watch
```

## Notes
- WebAudio starts on first keypress (browser policy).
- This is a prototype; feel free to tune constants in `src/MetatronVectorFOIL.tsx`.
