# MEATBASH — Status & Tasks

**Last updated:** 2026-04-15

This is the *current* picture of what's built, what's in flight, and what's
next. For game-design context read [MEATBASH_PRD.md](MEATBASH_PRD.md). For
where files live and how to run the project read
[CLAUDE_CONTEXT.md](CLAUDE_CONTEXT.md).

---

## Build status at a glance

| Phase | Goal | State |
|---|---|---|
| 1 — Core loop | Bipedal beast walks/jumps/falls on a real arena | ✅ DONE |
| 2 Block 1 — Playable demo | Pick a beast, fight a bot, end-to-end match | ✅ DONE |
| 2 Block 2 — Combat & damage | Hits matter, meat flies off, limbs sever | 🚧 PARTIAL |
| 2 Block 3 — Multiplayer | Two players over WS | ⏳ NOT STARTED |
| 2 Block 4 — Gene Lab | Sculpt your own beast | ⏳ NOT STARTED |
| 2 Block 5 — Certification + polish | Darwin challenges, more archetypes | ⏳ NOT STARTED |

---

## ✅ Phase 1 — Core Loop (DONE)

- Active-ragdoll bipedal locomotion: dynamic pelvis (70% mass), motorized
  hip/knee/ankle hinges, cuboid feet with high friction, per-foot
  down-raycast for grounded state.
- SUPPORTED / STUMBLING / AIRBORNE / FALLEN / RECOVERING state machine with
  support spring, upright torque, and recovery get-up impulse.
- Smoothed yaw-rate turning (no snap rotation), mass-normalized drive force,
  jump impulse, and stamina costs.
- Heightfield ground collider built from the same noise as the visual mesh.
- Convex-hull rock colliders built from the same deformed icosahedrons as
  the visual rocks.
- Tweakpane live tuning panel with tooltips on every parameter
  (`src/physics/tuning.ts`).
- Meat blob visuals: sphere/capsule meshes with vertex displacement noise,
  velocity-driven jiggle, fresnel rim glow, googly eyes.
- Arena: walls, dust particles, dramatic side lighting, spotlight,
  underglow, fog.
- Camera follow with mouse-drag orbit.
- Fixed-timestep physics + variable-rate render with input edge sets
  consumed at fixed steps (no lost / duplicated key presses).

## ✅ Phase 2 Block 1 — Playable Demo (DONE)

- Game shell state machine: HOME / ARENA screens.
- Glassmorphic homepage HTML overlay over the live arena scene.
- Beast selector: 4 default beasts shown in cards on the right.
- "BASH!" button starts a vs-bot match.
- Quadruped skeleton (front + rear torso joined by a tight spine hinge,
  4 motorized leg chains).
- Quadruped locomotion: diagonal-trot gait (FL+BR / FR+BL pairs),
  STUMBLING-when-≤2-feet, ~20% upright boost vs biped.
- Bot AI implementing the same `InputSource` interface as the player
  keyboard. Walks toward the player, occasionally jumps, panic-flails when
  airborne.
- Match controller: 3-second countdown → 3-minute fight → result
  (VICTORY / DEFEAT / DRAW).
- Match HUD: timer, P1/P2 mass bars, stamina pips, countdown overlay,
  result text, "press R to restart" hint.
- ESC returns to home; R restarts the same matchup.
- Beasts shipping: **Chonkus** (biped tank, armed), **Stomper** (quad
  bully), **Noodlesnake** (biped skirmisher, armed), **Butterchonk** (quad
  tank).

## 🚧 Phase 2 Block 2 — Combat & Damage (PARTIAL)

**Done:**
- Per-segment HP tracking (`physics/damage.ts::BeastDamageState`).
- Rapier collision-event + contact-force-event drain into damage events,
  with per-pair cooldowns to prevent double-dipping.
- Damage formula: `DAMAGE_SCALE × |relative velocity|² × (m1+m2)/2`, with
  a 2.5× bonus when the impactor is an arm segment.
- Arm-impact bonus (one-sided so the wielder isn't punished as hard).
- Limb severance (`physics/severance.ts`): joint break, body stays as a
  free physics prop, joint reference cleared so motors can't crash the
  WASM after removal.
- Meat chunk particles (`particles/meat-chunks.ts`): pink blob spawn on
  every damage event, scaled by hit magnitude.
- Optional arms on biped skeleton: shoulder Z-axis hinge (so the arm
  swings out from centrifugal force when the body spins) + elbow X-axis
  hinge with a slight rest bend. `BeastDefinition.hasArms` plumbs through
  `beast-factory`.
- **Crash hardening (2026-04-15):** every stage of the fixed update is
  wrapped in try/catch so a Rapier WASM panic on one frame can't kill the
  rAF loop. Terrain safety clamp now NaN-guards body positions and snaps
  broken bodies back to the pelvis. `window.__physicsStepErrors` exposes
  a runaway counter for stress tests.

**Not yet:**
- SDF volume system (visuals are still placeholder sphere/capsule meshes).
- SDF marching-cubes mesher.
- TSL meat / chitin / bone materials.
- Real meat removal at hit points (currently mass loss is per-segment HP,
  not actual SDF carving).
- Per-material damage matrix (meat vs chitin vs bone).
- Splatter decals on arena surfaces.

## ⏳ Phase 2 Block 3 — Multiplayer (NOT STARTED)

- Bun WebSocket relay server (`server/index.ts`).
- Match creation → `MEAT-XXXX` codes.
- Host-authoritative protocol: P1 runs physics, broadcasts state at 30 Hz.
- Beast serialization exchange at match start.
- Client-side interpolation for the remote beast.
- Spectator mode (read-only state feed at 10–30 Hz).
- SQLite (`bun:sqlite`) for persisted certified beasts, keyed to a
  localStorage client id.

## ⏳ Phase 2 Block 4 — Gene Lab (NOT STARTED)

- Archetype picker UI (start with bipedal + quadruped; add slider /
  wigglers / hexapod / octoped later).
- 3D sculpting viewport with brush tools (add / subtract / change material /
  resize).
- SDF blob list as the underlying serializable form.
- Joint repositioning before sculpting (drag joint nodes; snap to ranges).
- Real-time stats sidebar: total mass, stamina estimate, armor coverage,
  flight capability if wings exist.
- Key binding panel (assign E/R/T/F/G to body parts).
- Save / load beast as JSON, garage view.

## ⏳ Phase 2 Block 5 — Certification & Polish (NOT STARTED)

- Three Darwin Certification challenges: Walk A→B with obstacle, Get one
  food source, Survive a clumsy predator AI. PRD §5.3 has the full vibe.
- Certification stamp animation + server upload of certified beasts.
- Beast Garage UI (grid view, select / clone / trash).
- Remaining 5 archetypes: slider, wiggler-V, wiggler-H, hexapod, octoped.
- Premade beast roster filled out (Chonkus, Skitter, Sir Slime,
  Noodlesnake, Butterchonk, Ratking, Crabsworth, Meatball — PRD §6).
- Vibeverse portal in arena (interactive gateway, GET-param redirect to
  `portal.pieter.com`, inbound `?portal=true` handling).
- Vibejam widget script embed.
- Post-match stats screen (stretch).
- Hair painting (cosmetic, stretch).

---

## Recently fixed

### 2026-04-15 — Crash on jumping near rocks with enemy nearby
**Symptom:** beast on an angled rock jumps while another beast is close;
sim freezes, tab-out and back shows an empty canvas.

**Root cause:** Rapier's solver hit a degenerate contact configuration
(foot wedged between an angled convex hull rock and another body's
collider during a jump impulse), produced NaN body positions, and the next
step trapped inside the WASM. The trap escaped `physics.step()` and killed
the rAF loop entirely.

**Fix:**
- `engine/loop.ts:107-148` — every fixed-update stage wrapped in try/catch
  so a WASM panic logs and bumps `window.__physicsStepErrors` instead of
  killing the loop.
- `physics/locomotion.ts:120-167` and `locomotion-quad.ts:131-172` —
  terrain safety clamp now `isFinite`-checks every body position and snaps
  broken bodies back to the pelvis, killing their velocities so NaN can't
  propagate across steps.
- `physics/severance.ts:67` — severed joint reference is cleared
  (`joint.joint = undefined`) so subsequent locomotion steps skip
  `configureMotorPosition` on a freed Rapier handle.

### 2026-04-15 — Default beasts had no arms, so spinning dealt no damage
**Symptom:** without arms, the only damage vector was jumping. Movement
was too slow for body-on-body collision damage to matter.

**Fix:**
- `physics/skeleton.ts` — new `withArms` option adds upper-arm + lower-arm
  capsules per side. Shoulder is a Z-axis hinge so centrifugal force
  swings the arm outward when the body spins; elbow is X-axis with a
  slight rest bend. Motor stiffness is tiny; gravity dominates.
- `beast/beast-data.ts` — `hasArms` flag on `BeastDefinition`.
- `beast/premades.ts` — Chonkus and Noodlesnake now armed.
- `physics/damage.ts` — lowered impact-speed threshold (1.0 → 0.6 m/s),
  bumped damage scale (0.018 → 0.022), added 2.5× bonus when the impactor
  is an arm segment.

---

## Next priorities (for whoever picks this up)

In rough order of "biggest jam impact per unit work":

1. **SDF volume system + marching-cubes mesher** — unblocks both the Gene
   Lab and real meat carving on damage. Until this lands, beasts look like
   sphere assemblages and damage is just per-segment HP bars.
2. **Gene Lab MVP** — at minimum: archetype picker → brush sculpting →
   key binder → save to localStorage. The vision in PRD §5.2 is large;
   ship the smallest version that lets a player make and use one custom
   beast.
3. **Multiplayer** — Bun WS server + host-authoritative client + match
   codes. Vibejam strongly favors multiplayer. PRD §8 has the protocol.
4. **Darwin Certification** — three challenges. The walk and food
   challenges are quick wins; the predator challenge needs a second AI
   beast.
5. **Polish for ship:** vibeverse portal, vibejam widget embed, post-match
   stats, more premades, deploy.

## Known issues / tech debt

- Visual meshes are placeholder sphere/capsule primitives. No SDFs yet, so
  beasts can't be sculpted or carved.
- `WebGLRenderer` only — WebGPU is planned but not active. TSL node
  materials in PRD §9.2 don't apply yet.
- No audio: `AudioManager` is a stub class with empty methods.
- The damage system is symmetric in baseline — both sides take the same
  baseDamage, with the arm bonus on top. Some matchups may feel like the
  player gets punished for landing hits; revisit if playtesting confirms.
- Stomper (quadruped) bot lost a 3-minute fight to Chonkus (biped, armed)
  in stress testing because Chonkus took heavy self-damage from
  forced-spin testing — needs a real human playtest to assess balance
  fairly.
- `code/CLAUDE.md` and `code/TASKS.md` exist as historical mirrors; the
  authoritative copies are in `docs/`. `code/src/zip.ts` ships
  `code/CLAUDE.md` + `code/TASKS.md` in the distribution zip — keep those
  two files in sync with `docs/CLAUDE_CONTEXT.md` and `docs/TASKS.md` if
  you change anything.
