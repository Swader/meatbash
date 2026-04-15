# MEATBASH — Agent Orientation (code/)

Canonical orientation lives in **[../docs/CLAUDE_CONTEXT.md](../docs/CLAUDE_CONTEXT.md)**.
This file is its mirror so that Claude Code auto-loads orientation when you
invoke `claude` from inside `code/`. If anything below conflicts with
`../docs/CLAUDE_CONTEXT.md`, the docs/ version wins.

---

## What this is

Organic destruction derby for **Vibejam 2026**. Players sculpt gooey
meatbeasts in a Gene Lab, certify them through absurd bureaucratic fitness
tests, then bash them together in WASD ragdoll arena combat. Robot Wars +
Gang Beasts + Play-Doh.

**Deadline:** May 1, 2026 @ 13:37 UTC.

The clumsy slapstick comes from physics, not from awkward controls. Standing
is *earned* through real foot contacts on a real heightfield, not snapped to
a fixed height.

## Critical rules

- **Bun only.** No Node, no `npx`, no `npm`. `bun` for everything.
- **No React, no framework.** Plain TypeScript + Three.js + DOM manipulation.
- **Three.js** with `WebGLRenderer` (WebGPU upgrade planned).
- **Rapier 3D** via `@dimforge/rapier3d-compat`. WASM-backed.
- **No loading screens.** Game must be instantly playable — Vibejam rule.
- **No login required.** localStorage for identity; Bun WS server later.

## Run / build / test

```bash
bun install              # once
bun run dev              # dev server on http://localhost:3000
bun run build            # production build to dist/
bun run zip              # distribution zip
```

The dev server (`src/dev-server.ts`) rebuilds the bundle on every page load,
so a hard refresh picks up code changes — no HMR yet.

There is **no test suite**. Verification = playtest in the browser. Debug
handles `window.__getPlayer()`, `window.__getOpponent()`, `window.__physics`,
and `window.__physicsStepErrors` are exposed in `src/main.ts` for dev console
pokes.

## Where to look (current code map)

| If you want to change… | Look in |
|---|---|
| how the beast walks, balances, jumps | `src/physics/locomotion.ts` (biped) or `locomotion-quad.ts` |
| skeleton dimensions, joint limits, arms | `src/physics/skeleton.ts` (biped) or `skeleton-quad.ts` |
| live tuning sliders | `src/physics/tuning.ts` (tweakpane panel) |
| how rocks / ground / arena are built | `src/engine/scene.ts`, `src/engine/terrain.ts`, `src/beast/test-beast.ts::createPhysicsArena` |
| collision damage formula or thresholds | `src/physics/damage.ts` |
| limb severance | `src/physics/severance.ts` |
| beast visuals (meshes, colors, jiggle) | `src/beast/beast-instance.ts` |
| adding / changing default beasts | `src/beast/premades.ts` (+ `beast-data.ts` for new fields) |
| bot behaviour | `src/combat/bot-ai.ts` |
| match flow, win conditions, timer | `src/combat/match.ts`, wired in `src/main.ts` |
| home screen layout / styling | `src/ui/home-screen.ts` |
| in-fight HUD | `src/ui/match-hud.ts` |
| game loop ordering, fixed step | `src/engine/loop.ts` |
| rapier wrappers, collision groups | `src/physics/rapier-world.ts` |
| dev server / build / hot reload | `src/dev-server.ts`, `src/build.ts` |

## Architecture in a nutshell

- **Game loop** (`src/engine/loop.ts`) — fixed-timestep physics (60 Hz) +
  variable-rate render. Every stage wrapped in try/catch so a Rapier WASM
  panic on one frame can't kill the rAF loop.
- **Physics — active ragdoll, not kinematic puppet** (see
  `../docs/MEATBASH_LOCOMOTION_AUDIT.md` before touching this). Dynamic
  pelvis with ~70% of mass, motorized hip/knee/ankle hinges, hidden cuboid
  feet, per-foot down-raycast for grounded state, SUPPORTED → STUMBLING →
  AIRBORNE → FALLEN → RECOVERING state machine. Heightfield ground +
  convex-hull rocks built from the same noise/geometry as the visual mesh.
- **Per-beast collision groups** so two beasts collide with each other and
  the arena, but not with their own body parts. `physics.beginBeast(index)`
  before adding colliders.
- **Beasts**: 4 default premades (Chonkus, Stomper, Noodlesnake,
  Butterchonk). Chonkus + Noodlesnake are biped + armed (shoulder Z-axis
  hinges so arms swing out from centrifugal force on spin).
- **Combat**: contact events → per-segment HP loss with pair cooldowns;
  arms get a 2.5× impact bonus; severance breaks joints when HP hits zero
  and clears the joint reference so motors can't crash the WASM after.
- **UI**: DOM overlays only. `game-shell.ts` runs HOME / ARENA screens;
  `home-screen.ts` is the glassmorphic landing; `match-hud.ts` is the
  in-fight HUD.

## Conventions

- **Units:** meters, kilograms, seconds. Three.js Y-up.
- **Fixed physics timestep:** 1/60 s.
- **Forces / torques are mass-normalized** at apply time. Tuning values in
  `tuning.ts` are per-kg accelerations.
- **Beast collision groups** assigned per-spawn via
  `physics.beginBeast(beastIndex)` before any of that beast's colliders are
  created.
- **Visual placeholders:** every body segment renders as a sphere/capsule/box
  matching its physics collider. SDF-based meat is planned but not yet built.

## Gotchas

- **Heightfield API quirk:** Rapier's `nrows`/`ncols` are *subdivision
  counts*; heights array length must be `(nrows+1)*(ncols+1)` in
  column-major order. Wrong length → WASM panic.
- **Joint contact disable is manual:** `createImpulseJoint(..., true)` 4th
  arg is `wakeUp`, not "disable contacts". Call
  `joint.setContactsEnabled(false)` explicitly. Done inside
  `createHingeJoint`.
- **Severed joint references must be cleared.** A removed Rapier joint
  can't be reused via its old wrapper. `processSeverance` sets
  `joint.joint = undefined`; locomotion's `setMotor` early-returns on
  undefined.
- **Foot sensors don't fire on heightfields** in our Rapier version. We
  use per-foot down-raycasts instead — don't try to "fix" the sensors.
- **Tab backgrounding pauses everything.** Chrome throttles backgrounded
  tab rAF to ~0 Hz, so locomotion + match timer freeze. Bring the tab
  forward before dev-console testing.
- **`createBipedSkeleton` takes options:** `withArms: true` adds two
  shoulder + two elbow hinges. The `BeastDefinition.hasArms` flag plumbs
  through `beast-factory.ts`. Quadrupeds don't have arms yet.

## Status & next steps

See **[../docs/TASKS.md](../docs/TASKS.md)** for the current build status,
recent fixes, and what to pick up next.

## Game design source of truth

See **[../docs/MEATBASH_PRD.md](../docs/MEATBASH_PRD.md)** for game design
decisions, art direction, premade beast roster, network protocol, and the
Darwin certification challenge designs.
