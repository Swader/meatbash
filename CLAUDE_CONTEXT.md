# MEATBASH — Agent Orientation

**Read this first.** This is the landing page for any agent working on the
codebase. It tells you what MEATBASH is, where the code lives, how to run it,
and what the architecture actually looks like *right now*.

For details, branch out from here:

- [MEATBASH_PRD.md](MEATBASH_PRD.md) — full game-design source of truth (what
  we're building and why)
- [TASKS.md](TASKS.md) — current build status + next priorities (what's done,
  what's in flight, what's blocked)
- [MEATBASH_LOCOMOTION_AUDIT.md](MEATBASH_LOCOMOTION_AUDIT.md) — physics
  architecture deep-dive. Read before touching anything in `code/src/physics/`.

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

---

## Repo layout

This file lives at the project root for the Bun app:

```
code/
├── CLAUDE_CONTEXT.md            this file (canonical orientation)
├── CLAUDE.md                    tiny pointer for agents/tools that auto-load it
├── docs/
│   ├── MEATBASH_PRD.md          game design source of truth
│   ├── TASKS.md                 current status + next steps
│   ├── NOW_NEXT_LATER.md        milestone ordering
│   └── MEATBASH_LOCOMOTION_AUDIT.md   physics architecture deep-dive
├── src/                         client TypeScript
├── server/                      planned Bun WS relay
├── public/                      static assets
├── dist/                        build output
└── package.json
```

**Heads up:** all `bun` commands run from this directory.

---

## Critical rules

- **Bun only.** No Node, no `npx`, no `npm`. `bun` for everything.
- **No React, no framework.** Plain TypeScript + Three.js + DOM manipulation
  for UI overlays.
- **Three.js** with `WebGLRenderer` (a WebGPU upgrade is planned but not
  active — see [TASKS.md](TASKS.md)).
- **Rapier 3D** via `@dimforge/rapier3d-compat` for physics. WASM-backed.
- **No loading screens.** Game must be instantly playable — Vibejam rule.
- **No login required.** localStorage for identity; certified beasts will
  live on a Bun WS server later.

---

## Run / build / test

```bash
cd code/
bun install              # once
bun run dev              # dev server on http://localhost:3000
bun run build            # production build to dist/
bun run zip              # distribution zip
```

The dev server (`src/dev-server.ts`) rebuilds the bundle on every page load,
so a hard refresh picks up code changes — no HMR yet. Bun's bundler is fast
enough that this is fine.

There is **no test suite**. Verification = playtest in the browser. The
`window.__getPlayer()`, `window.__getOpponent()`, and `window.__physics`
debug handles are exposed for dev console pokes (set in `src/main.ts`).

---

## Architecture in one screen

### Game loop (`src/engine/loop.ts`)
Fixed-timestep physics (60 Hz) + variable-rate render (rAF). Per fixed step:

1. `input.beginFixedStep()` — drains queued raw key events into a per-step
   edge set so `justPressed` is deterministic regardless of how many fixed
   steps a render frame triggers.
2. `beast.applyInput(...)` for each beast — runs locomotion, writes joint
   motor targets and pelvis forces.
3. `physics.step()` — Rapier WASM advances the world.
4. `onPostPhysics(dt)` — drains contact events into the damage system,
   processes severance, spawns meat chunk particles.
5. `beast.syncFromPhysics()` — copies body transforms into Three.js meshes,
   applies the velocity-driven jiggle.

Every stage is wrapped in try/catch so a Rapier WASM panic on one frame
can't kill the rAF loop. A bumped counter on `window.__physicsStepErrors`
tells you when something tripped.

### Physics — active ragdoll, not kinematic puppet
Driven by the locomotion audit ([MEATBASH_LOCOMOTION_AUDIT.md](MEATBASH_LOCOMOTION_AUDIT.md)).
Key invariants:

- **Dynamic pelvis**, never kinematic. ~70% of total mass lives in the
  pelvis so the beast has a stable base.
- **Motorized hip / knee / ankle hinges** drive gait poses. Joint
  `setContactsEnabled(false)` per joint kills self-collision between linked
  segments (no ragdoll explosions from leg-touching-pelvis contacts).
- **Hidden cuboid feet** with high friction provide actual contact area.
- **Per-foot down-raycast** decides grounded state (Rapier sensors don't
  reliably detect heightfield intersections in this version).
- **State machine:** SUPPORTED → STUMBLING → AIRBORNE → FALLEN → RECOVERING.
  Support spring + upright torque only fire when actually grounded; gravity
  wins in the air.
- **Heightfield ground collider** built from the same noise function as the
  visual ground mesh (`src/engine/terrain.ts`). Convex-hull rock colliders
  built from the same deformed icosahedrons as the visual rocks. *What you
  see is what you can stand on.*
- **Per-beast collision groups** so two beasts collide with each other and
  with the arena, but not with their own body parts. Computed per spawn via
  `physics.beginBeast(index)` before adding colliders.

### Beasts
- `beast/beast-data.ts` — `BeastDefinition` JSON-friendly config (id,
  name, archetype, color, `hasArms` flag, etc.).
- `beast/premades.ts` — 4 default beasts: **Chonkus** (biped, armed, tank),
  **Stomper** (quad, bully), **Noodlesnake** (biped, armed, skirmisher),
  **Butterchonk** (quad, tank).
- `beast/beast-factory.ts` — single entry: `spawnBeast(def, scene, physics, opts)`
  picks the right archetype skeleton + locomotion and returns a `BeastInstance`.
- `beast/beast-instance.ts` — links physics skeleton to Three.js visual
  meshes (sphere/capsule placeholders for now; SDFs planned). Also owns the
  jiggle pass and the visual eye/torso decoration.

### Combat
- `combat/match.ts` — match state machine (COUNTDOWN → FIGHTING → ENDED).
  KO at ≤30% mass; tiebreak on lower-mass-loses.
- `combat/bot-ai.ts` — implements the same `InputSource` interface as the
  player keyboard. Walks toward the player, occasionally jumps, panic-flails
  when airborne. Plug it in via `beast.inputOverride`.
- `physics/damage.ts` — Rapier contact events → per-segment HP loss, with
  pair cooldowns to stop double-dipping. Arms deal 2.5× bonus damage to
  whatever they hit.
- `physics/severance.ts` — drops below-zero segments, breaks the joint,
  clears the joint reference so locomotion's `setMotor` becomes a no-op.

### UI (DOM overlays, not Three.js)
- `ui/game-shell.ts` — HOME / ARENA screen state machine.
- `ui/home-screen.ts` — glassmorphic landing page over the live arena.
- `ui/match-hud.ts` — in-fight HUD (timer, mass bars, stamina, countdown,
  result).
- `ui/debug-hud.ts` — top-right debug overlay (FPS, mode, tilt, mass, etc.).

### What's *not* built yet
The PRD describes SDF sculpting, a Gene Lab, multiplayer, Darwin Certification,
WS server, and 4 more archetypes. None of that exists in code yet — the
relevant `src/sdf/`, `src/lab/`, `src/network/`, `src/certification/`, and
`server/` directories are empty. See [TASKS.md](TASKS.md) for what's next.

---

## File map (where to look for X)

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

---

## Conventions

- **Units:** meters, kilograms, seconds. Three.js Y-up.
- **Fixed physics timestep:** 1/60 s. Locomotion code reads `dt` from the
  loop and never assumes a fixed value.
- **Beast serialization:** JSON (see PRD §8.4 for the planned schema).
- **Match codes:** `MEAT-XXXX` format (planned, not implemented yet).
- **Forces / torques are mass-normalized** at apply time. Tuning values in
  `tuning.ts` are per-kg accelerations. This way mass loss, mass variation,
  and wildly different beasts all feel right without re-tuning.
- **Beast collision groups** are assigned per-spawn via
  `physics.beginBeast(beastIndex)` before any of that beast's colliders are
  created. Bit 0 = arena, bits 1..8 = per-beast. Each beast's solid filter
  is `arena | (all_beasts & ~self)`.
- **Visual placeholders:** every body segment renders as a sphere/capsule/box
  matching its physics collider. SDF-based meat is planned but not yet built.

---

## Gotchas

- **Heightfield API quirk:** Despite Rapier's JSDoc, `nrows`/`ncols` are
  *subdivision counts* and the heights array must contain exactly
  `(nrows+1)*(ncols+1)` samples in column-major order. Wrong length → WASM
  panic. See `physics/rapier-world.ts::createHeightfieldGround`.
- **Joint contact disable is manual.** Rapier's `createImpulseJoint(..., true)`
  takes a `wakeUp` boolean as its 4th arg, *not* a "disable contacts" flag.
  We call `joint.setContactsEnabled(false)` explicitly inside
  `createHingeJoint` to stop self-collision between linked skeleton parts.
- **Severed joint references must be cleared.** A removed Rapier joint can't
  be reused via its old wrapper. `processSeverance` sets `joint.joint =
  undefined` after `removeImpulseJoint`, and locomotion's `setMotor`
  early-returns on undefined. Adding new joint-driving code? Mirror this
  pattern.
- **Foot sensors don't fire on heightfields** in our Rapier version. We use
  per-foot down-raycasts instead. Don't try to "fix" the sensors back.
- **Tab backgrounding pauses everything.** Chrome throttles backgrounded tab
  rAF to ~0 Hz, so the locomotion controller and match timer freeze. This
  is normal browser behavior, not a bug — it just means dev console testing
  has to bring the tab to the front first.
- **`createBipedSkeleton` takes an options arg.** `withArms: true` adds two
  shoulder + two elbow hinges. The `BeastDefinition.hasArms` flag plumbs
  through `beast-factory.ts`. Quadrupeds don't have arms yet.
