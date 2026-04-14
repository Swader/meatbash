# MEATBASH - AI Agent Context

## What Is This
Organic destruction derby game for Vibejam 2026. Players sculpt gooey meatbeasts in a Gene Lab, certify them through absurd bureaucratic fitness tests, then bash them together in WASD ragdoll arena combat. Think Robot Wars + Gang Beasts + Play-Doh.

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
- **Active-ragdoll locomotion (WASD):** Dynamic pelvis root with hidden locomotion collider, motorized hip/knee/ankle joints, foot sensors, and a SUPPORTED/STUMBLING/FALLEN/RECOVERING state machine. Standing is earned through support contact, not faked. The clumsy Gang-Beasts-style feel comes from tuning, not from awkward controls.
- **Honest arena:** ground is a heightfield collider built from the same noise function as the visual mesh. Rocks are convex-hull colliders built from the same deformed icosahedron geometry. What you see is what you can stand on.
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
Goal: A bipedal meat blob controlled with WASD that stands, walks, turns, jumps, falls, and recovers on a real heightfield arena with real rock colliders.
Status: Active-ragdoll locomotion with state machine + tuneable balance is working. Visual proxies in place.

## Controls
- **W** = walk forward (auto-cycling gait)
- **S** = walk backward
- **A / D** = turn left / right (smoothed yaw rate, not snap rotation)
- **SPACE** = jump (when SUPPORTED) / panic flail (in air)
- **Mouse drag** = orbit camera

## Key Files
- `MEATBASH_PRD.md` — Full PRD (source of truth for all game design decisions)
- `docs/MEATBASH_LOCOMOTION_AUDIT.md` — Architecture audit that drove the active-ragdoll rebuild
- `src/engine/terrain.ts` — Shared terrain noise (visual ground + heightfield collider use this)
- `src/physics/rapier-world.ts` — Rapier wrapper, collision groups, heightfield/convex-hull builders
- `src/physics/skeleton.ts` — Bipedal skeleton builder (dynamic pelvis + 70% mass, motorized joints, foot sensors)
- `src/physics/locomotion.ts` — State machine, support spring, smoothed turning, drive force
- `src/physics/tuning.ts` — Centralized tuning + tweakpane panel with tooltips
- `src/beast/test-beast.ts` — `createPhysicsArena` + `createTestBeast`
- `src/beast/beast-instance.ts` — Links physics to Three.js visuals
- `src/engine/loop.ts` — Fixed-timestep physics, variable render, per-step input latching

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
