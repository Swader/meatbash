# MEATBASH — Status & Tasks (code/)

The canonical, live status lives in **[../docs/TASKS.md](../docs/TASKS.md)**.
This file is shipped alongside `code/CLAUDE.md` in the distribution zip
(`bun run zip`) so reviewers landing in `code/` can navigate. If anything
below conflicts with `../docs/TASKS.md`, the docs/ version wins.

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

## What's working right now

- **Core loop:** active-ragdoll bipedal locomotion with state machine,
  heightfield terrain matching the visual mesh, convex-hull rocks, dust,
  dramatic lighting, follow camera, tweakpane live tuning.
- **Quadruped archetype** with diagonal-trot gait.
- **4 default beasts:** Chonkus (biped, armed, tank), Stomper (quad,
  bully), Noodlesnake (biped, armed, skirmisher), Butterchonk (quad, tank).
- **Match flow:** glassmorphic homepage → beast selector → countdown →
  3-minute fight → result screen, with bot AI opponent.
- **Combat damage:** per-segment HP, Rapier contact events with pair
  cooldowns, limb severance, meat chunk particles. Optional arms on
  bipeds for spin-melee damage.
- **Crash hardening:** every fixed-update stage wrapped in try/catch with
  NaN guards on body positions, so a Rapier WASM panic on one frame can't
  freeze the rAF loop. `window.__physicsStepErrors` exposes a counter.

## What's next (highest jam impact first)

1. **SDF volume system + marching-cubes mesher** — unblocks Gene Lab
   sculpting and real meat carving on damage.
2. **Gene Lab MVP** — archetype picker → brush sculpting → key binder →
   save. Smallest version that lets a player make and use one custom beast.
3. **Multiplayer** — Bun WS server + host-authoritative client + match
   codes (`MEAT-XXXX`). PRD §8 has the protocol.
4. **Darwin Certification** — 3 challenges. Walk + food are quick wins.
5. **Polish for ship:** Vibeverse portal, Vibejam widget embed, post-match
   stats, more premades, deploy.

For full detail (recently fixed bugs, known issues, file references)
see **[../docs/TASKS.md](../docs/TASKS.md)**.
