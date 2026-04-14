# MEATBASH - AI Agent Context

## What Is This
Organic destruction derby game for Vibejam 2026. Players sculpt gooey meatbeasts in a Gene Lab, certify them through absurd bureaucratic fitness tests, then bash them together in QWOP-style ragdoll arena combat. Think Robot Wars + QWOP + Play-Doh.

## Critical Rules
- **Bun only.** No Node.js, no npx, no npm. Use `bun` for everything.
- **No React.** Plain TypeScript + Three.js + DOM manipulation.
- **Three.js** is the 3D engine. WebGPU renderer (WebGL fallback for Phase 1).
- **Rapier 3D** (@dimforge/rapier3d-compat) for physics.
- **No loading screens.** Game must be instantly playable per Vibejam rules.
- **No login required.** localStorage for identity, server storage for certified beasts.
- **Deadline: May 1, 2026 @ 13:37 UTC.**

## Stack
- Runtime: Bun
- 3D: Three.js (three) with WebGPURenderer (future) / WebGLRenderer (now)
- Physics: Rapier 3D WASM via @dimforge/rapier3d-compat
- Networking: Bun WebSocket server (server/)
- Build: Bun.build() — see src/build.ts
- Dev: `bun run dev` → src/dev-server.ts

## Architecture
- **Dual-layer physics:** Rapier handles rigid skeleton (joints, collisions). GPU compute (future) handles meat deformation/damage.
- **QWOP locomotion:** Player keys apply torques to joint motors. No direct movement. Inherently clumsy by design.
- **SDF sculpting:** Beasts are built from SDF blobs (meat/chitin/bone). Ray-marched in editor, meshed via marching cubes at runtime.
- **Host-authoritative networking:** Host client runs physics. Server is relay only. Spectators get state broadcasts.

## Project Structure
```
src/
  main.ts              # Entry point
  engine/              # Renderer, scene, camera, input, game loop
  physics/             # Rapier world, skeleton builder, locomotion, damage
  sdf/                 # SDF volume, marching cubes, GPU deformation, materials
  beast/               # Beast class, archetypes, serialization, premades
  combat/              # Arena, match state, HUD, bot AI
  lab/                 # Gene Lab sculpting UI
  certification/       # Darwin certification challenges
  network/             # WebSocket client, protocol, interpolation
  ui/                  # Home screen, garage, lobby, results
  particles/           # GPU particle effects (meat chunks, splatter)
  audio/               # Stub audio manager
server/
  index.ts             # Bun WebSocket relay server
```

## Current Phase: Phase 1 (Core Loop)
Goal: A bipedal meat blob controlled with QWOP keys stumbling across a flat arena.
Status: Project scaffolded, skeleton physics working, visual proxies in place.

## Key Files
- `MEATBASH_PRD.md` — Full PRD (source of truth for all game design decisions)
- `src/physics/skeleton.ts` — Bipedal skeleton builder (Rapier bodies + joints)
- `src/physics/locomotion.ts` — QWOP torque application per key
- `src/beast/beast-instance.ts` — Links physics to Three.js visuals
- `src/engine/loop.ts` — Fixed-timestep physics, variable render

## Development Commands
```bash
bun run dev      # Start dev server on :3000
bun run build    # Production build to dist/
bun run server   # Start WebSocket relay server
```

## Conventions
- All physics units in meters, kilograms, seconds
- Three.js Y-up coordinate system
- Fixed physics timestep: 1/60s
- Beast serialization: JSON (see PRD Section 8.4)
- Match codes format: MEAT-XXXX (4 alphanumeric chars)
