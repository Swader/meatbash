# MEATBASH — Status & Tasks

**Last updated:** 2026-04-22

This is the *current* picture of what's built, what's in flight, and what's
next. For game-design context read [MEATBASH_PRD.md](MEATBASH_PRD.md). For
where files live and how to run the project read
[../CLAUDE_CONTEXT.md](../CLAUDE_CONTEXT.md).

---

## Build status at a glance

| Phase | Goal | State |
|---|---|---|
| 1 — Core loop | Bipedal beast walks/jumps/falls on a real arena | ✅ DONE |
| 2 Block 1 — Playable demo | Pick a beast, fight a bot, end-to-end match | ✅ DONE |
| 2 Block 2 — Combat & damage | Hits matter, meat flies off, limbs sever | ✅ PLAYABLE, STILL TUNING |
| 2 Block 3 — Multiplayer | Two players over WS | 🚧 PARTIAL |
| 2 Block 4 — Quick Workshop / Gene Lab | Forge custom beasts now; full sculpt lab later | 🚧 PARTIAL |
| 2 Block 5 — Certification + polish | Darwin challenges, ship polish, expanded content | 🚧 PARTIAL |

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
- `BASH BOT` starts a vs-bot match.
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
  result text, a bot-only "press R to restart" hint, and `Back to Menu`.
- Theme music now switches by screen context (menu vs battle), with a
  clickable Tragikomik credit widget in the lower-right corner.
- ESC returns to home; R restarts bot matches only and can reroll the opponent.
- Beasts shipping: **Chonkus** (biped tank, armed), **Stomper** (quad
  bully), **Noodlesnake** (biped skirmisher, armed), **Butterchonk** (quad
  tank).

## 🚧 Phase 2 Block 2 — Combat & Damage (PLAYABLE, tuning ongoing)

**Done:**
- Intentional primary attack slots for premades (raise `J`, commit `K`, release cancel).
- Attack state machine (`IDLE → WINDUP → HELD → COMMIT → RECOVER`) with stamina drain/cost and lunge.
- Attack profiles (`blunt`, `spike`, `shield`) and attack-aware active-hit resolution.
- Combat brace modifiers now flow through locomotion-owned movement multipliers instead of direct attack-side velocity damping.
- Premades now author explicit combat-facing metadata such as `activeBodies`, `blockBodies`, `visualRigType`, and optional spike tip markers.
- Raised shield reduction now keys off the braced front arc / authored block bodies instead of applying as a blanket state-only reduction.
- Spike slots with authored tip markers now prefer the configured tip point during intentional-hit resolution.
- Attack-aware HUD feedback: combat text (`BONK`, `STAB`, `BLOCK`, `GLANCE`, `CRUNCH`), hitstop, shake.
- Beast cards now show weight class + primary attack profile + one-line playstyle.
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
- Standalone `AttackRig` authoring layer that fully separates semantic slot / driven joints / active bodies / block bodies / visual rig.
- SDF volume system (visuals are still placeholder sphere/capsule meshes).
- SDF marching-cubes mesher.
- TSL meat / chitin / bone materials.
- Real meat removal at hit points (currently mass loss is per-segment HP,
  not actual SDF carving).
- Per-material damage matrix (meat vs chitin vs bone).
- Splatter decals on arena surfaces.

## 🚧 Phase 2 Block 3 — Multiplayer (PARTIAL)

**Done now:**
- Bun WebSocket relay server (`server/index.ts`).
- Match creation → `MEAT-XXXX` codes.
- Host-authoritative protocol: host runs physics and broadcasts snapshots.
- Beast serialization exchange at match start.
- Guest input relay to the host.
- Client-side interpolation for the remote beast.
- Remote attack-state replication for guest telegraphs and HUD state.

**Not yet:**
- Spectator mode (read-only state feed at 10–30 Hz).
- SQLite (`bun:sqlite`) for persisted certified beasts, keyed to a
  localStorage client id.
- Production matchmaking / relay observability beyond the direct room-code flow.

## 🚧 Phase 2 Block 4 — Quick Workshop / Gene Lab (PARTIAL)

**Done now:**
- Quick Workshop now lives behind the `ENTER GENE LAB` route and can fork the
  selected beast into a playable custom variant.
- Archetype choices: `bipedal` or `quadruped`.
- Primary attack choices are filtered per archetype (`hammer` / `spike` /
  `shield` for bipeds, `headbutt` / `shield` / `spike` for quadrupeds).
- Charge bias choices: `quick`, `balanced`, `heavy`.
- Color preset choices: `crimson`, `peach`, `tallow`, `ember`.
- Workshop beasts persist in localStorage via
  `meatbash_workshop_beasts_v1`.
- Forged beasts appear in `Your Beasts`, can be reselected, and can spawn in
  live bot matches immediately.

**Not yet:**
- 3D sculpting viewport with add/subtract/material brushes.
- SDF blob list as the underlying editable representation.
- Joint repositioning before sculpting.
- Real-time stats sidebar beyond the current lightweight beast-card metadata.
- Key rebinding / multi-slot attack authoring.
- Save/load/export flows beyond the current localStorage workshop list.
- Garage management, certification gating, or server-backed storage.

## 🚧 Phase 2 Block 5 — Certification & Polish (PARTIAL)

**Already landed:**
- Vibejam widget script is embedded in `src/index.html`.
- Menu / battle / lab music contexts are implemented, with a lower-right
  Tragikomik credit widget driven by analyser bars.
- Four premades ship with readable archetype / attack-profile / playstyle
  metadata on the home screen.

**Not yet:**
- Three Darwin Certification challenges: Walk A→B with obstacle, Get one
  food source, Survive a clumsy predator AI. PRD §5.3 has the full vibe.
- Certification stamp animation + server upload of certified beasts.
- Beast Garage UI (grid view, select / clone / trash).
- Remaining 5 archetypes: slider, wiggler-V, wiggler-H, hexapod, octoped.
- Premade beast roster filled out (Chonkus, Skitter, Sir Slime,
  Noodlesnake, Butterchonk, Ratking, Crabsworth, Meatball — PRD §6).
- Vibeverse portal in arena (interactive gateway, GET-param redirect to
  `portal.pieter.com`, inbound `?portal=true` handling).
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

1. **Finish the Attack Readability / Attack Contract pass** — verify every
   premade from the gameplay camera, tune brace steering and charge timing,
   and keep pushing semantic honesty (especially spike tips and shield fronts).
2. **Deepen the workshop intentionally** — keep the quick workshop playable,
   but decide the next smallest set of combat-identity knobs before jumping to
   full sculpting.
3. **SDF volume system + marching-cubes mesher** — unblocks both the Gene
   Lab and real meat carving on damage. Until this lands, beasts look like
   sphere assemblages and damage is just per-segment HP bars.
4. **Multiplayer** — only after local combat readability is stable. Bun WS
   server + host-authoritative client + match codes. PRD §8 has the protocol.
5. **Darwin Certification** — three challenges. The walk and food
   challenges are quick wins; the predator challenge needs a second AI
   beast.
6. **Polish for ship:** vibeverse portal, post-match stats, more premades,
   deploy.

## Known issues / tech debt

- Visual meshes are placeholder sphere/capsule primitives. No SDFs yet, so
  beasts can't be sculpted or carved.
- `WebGLRenderer` only — WebGPU is planned but not active. TSL node
  materials in PRD §9.2 don't apply yet.
- Audio exists now: jump/land/miss/hit sprites plus menu/battle music are
  wired, but mixing, volume balancing, and lab-specific music still need
  polish.
- The home screen still exposes certification affordances before that loop is
  fully wired; keep Darwin copy honest until progression exists.
- The damage system is symmetric in baseline — both sides take the same
  baseDamage, with the arm bonus on top. Some matchups may feel like the
  player gets punished for landing hits; revisit if playtesting confirms.
- Automated runtime verification is still awkward because the gameplay camera
  is distant and canvas-only captures need extra harnessing to inspect attack
  readability closely. Keep improving the test loop instead of trusting static
  code inspection alone.
- Stomper (quadruped) bot lost a 3-minute fight to Chonkus (biped, armed)
  in stress testing because Chonkus took heavy self-damage from
  forced-spin testing — needs a real human playtest to assess balance
  fairly.
- The canonical docs are `code/docs/*`. Avoid keeping parallel mirrors in
  other folders.
