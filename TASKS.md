# MEATBASH — Task Breakdown for AI Agents

Reference: `MEATBASH_PRD.md` for full specs. `CLAUDE.md` for project conventions.
All code is in `/home/claude/meatbash/`. Run `bun run dev` to test, `bun run build` to verify.

---

## PHASE 1 REMAINING — Core Loop Polish (Days 1-5)
**Status: Active-ragdoll locomotion implemented. Tuning live via tweakpane.**

### Task 1.1: Tune Active-Ragdoll Locomotion ✅ ARCHITECTURE DONE
**Files:** `src/physics/locomotion.ts`, `src/physics/skeleton.ts`, `src/physics/tuning.ts`
**Architecture (per locomotion audit):**
- Dynamic pelvis root (NOT kinematic) with 70% of beast mass
- Motorized hip / knee / ankle joints, contacts disabled between linked bodies
- Foot bodies (cuboids, high friction) with intersection sensors
- Heightfield ground collider matching the visual mesh
- Convex-hull rock colliders matching the visual rocks
- SUPPORTED / STUMBLING / FALLEN / RECOVERING state machine
- Support spring along ground normal (only when supported)
- Smoothed A/D → desired yaw rate (no snap rotation)
- Drive force scaled by tilt + support state
**Controls:** WASD movement (W forward, S back, A/D turn), SPACE jump.
**Remaining:** live-tune balance gains, motor stiffness, stride pose targets via the tweakpane panel until the gait feels right. The clumsiness should come from physics, not awkward keys.

### Task 1.2: Improve Meat Visuals
**Files:** `src/beast/beast-instance.ts`
**Goal:** Replace placeholder capsule/sphere visuals with meatier-looking meshes:
- Use `THREE.SphereGeometry` with vertex displacement noise for blobby organic shapes
- Add jiggle: offset vertices slightly based on velocity (wobbly meat)
- Better meat material: subsurface scattering approximation (red-ish emissive on thin parts, fresnel rim)
- The beast should look like a gooey pink blob monster, not capsules
**Acceptance:** Beast looks organic and gross-cute. Jiggles when moving.

### Task 1.3: Arena Visual Polish
**Files:** `src/engine/scene.ts`
**Goal:** Make the arena feel like a dramatic combat pit:
- Add arena walls (visual mesh — colliders already exist)
- Better ground texture (procedural noise displacement, sand/dirt colors)
- Rim lighting / spotlight on center
- Maybe subtle dust particles in the air
**Acceptance:** Arena looks like a scrappy outdoor fighting pit, not a blank plane.

### Task 1.4: Camera Improvements
**Files:** `src/engine/camera.ts`
**Goal:** Camera should feel cinematic:
- Smooth follow with slight overshoot on sudden movement
- Auto-zoom out when beast moves fast, zoom in when stationary
- Slight screen shake on hard impacts (future, but add the method now)
**Acceptance:** Camera feels dynamic, not static.

---

## PHASE 2 — Gene Lab / Sculpting (Days 6-8)

### Task 2.1: SDF Volume System
**Files:** `src/sdf/sdf-volume.ts`, `src/sdf/sdf-ops.ts`
**Goal:** SDF data structure representing a beast's body. List of blobs with position, radius, material type. Support operations:
- `addBlob(pos, radius, material)` — smooth union
- `subtractBlob(pos, radius)` — smooth subtraction
- `evaluate(point)` → distance value (negative = inside)
- `evaluateMaterial(point)` → which material at this point
- Blob list is the serializable form (JSON-friendly)
**Acceptance:** Can create/destroy blobs, evaluate SDF at any point, get material type.

### Task 2.2: Marching Cubes Mesher
**Files:** `src/sdf/marching-cubes.ts`
**Goal:** Convert SDF volume → Three.js BufferGeometry. Standard marching cubes on a 64³ grid.
- Input: SDF evaluate function, bounding box
- Output: THREE.BufferGeometry with positions, normals, and vertex colors (per material)
- Optimization: skip empty cells, cache edge intersections
**Acceptance:** An SDF blob list gets meshed into a visible 3D shape in <100ms.

### Task 2.3: TSL Meat Materials
**Files:** `src/sdf/materials.ts`
**Goal:** Three.js materials for meat, chitin, and bone. Phase 1 uses MeshStandardMaterial. Phase 2 upgrades to node materials if WebGPU renderer is active.
- Meat: pink/red, slightly translucent look, fresnel rim glow
- Chitin: dark brown/green, glossy, iridescent sheen
- Bone: matte white/ivory, rough
- Materials assigned via vertex colors from marching cubes output
**Acceptance:** Three visually distinct materials that look organic.

### Task 2.4: Gene Lab UI
**Files:** `src/lab/gene-lab.ts`, `src/lab/sculpt-brush.ts`, `src/lab/joint-editor.ts`, `src/lab/key-binder.ts`, `src/lab/preview.ts`
**Goal:** Full sculpting interface:
- Archetype picker (buttons: bipedal, quadruped, etc.)
- 3D viewport showing skeleton wireframe
- Brush tools: add meat (click-drag), subtract (right-click-drag), change material (dropdown), resize (scroll wheel)
- Joint repositioning: drag joint nodes before sculpting
- Stats sidebar: mass, stamina estimate, armor coverage, flight capability
- Key binding panel: assign keys to body parts
- Save/load beast as JSON
**Acceptance:** Player can select archetype, sculpt a blob monster, assign keys, and save it.

### Task 2.5: Archetype Definitions
**Files:** `src/beast/archetypes.ts`
**Goal:** Define all 7 archetypes per PRD Section 5.2.1:
- Each archetype: skeleton joint positions, default key bindings, locomotion function reference
- Start with bipedal (done) + quadruped
- Add slider, wiggler-v, wiggler-h, hexapod, octoped
**Acceptance:** Each archetype generates a valid skeleton with appropriate joints and locomotion.

### Task 2.6: Quadruped Skeleton + Locomotion
**Files:** `src/physics/skeleton.ts`, `src/physics/locomotion.ts`
**Goal:** Second archetype — four-legged beast.
- 4 hip joints, 4 knee joints, 4 feet
- WASD: W forward, S back, A/D smoothed yaw turn (same as biped)
- Diagonal-pair gait phases (front-left + back-right alternating with front-right + back-left)
- Reuses the SUPPORTED/STUMBLING/FALLEN/RECOVERING state machine
- More stable than biped (more support contributors), less agile turn
**Acceptance:** Quadruped walks forward when W is held with diagonal-pair gait. Notably more stable than biped and harder to tip over.

---

## PHASE 3 — Combat (Days 9-11)

### Task 3.1: Damage System
**Files:** `src/physics/damage.ts`, `src/sdf/gpu-deform.ts`
**Goal:** When beasts collide, calculate and apply damage:
- Use Rapier contact events to detect collisions
- `damage = relative_velocity × impactor_mass × material_multiplier / defender_resistance`
- On damage: subtract SDF volume at impact point (crater), reduce total mass
- Material interaction matrix (meat vs chitin vs bone — see PRD Section 5.4.3)
- Spawn meat chunk particles at impact point
**Acceptance:** Hitting a beast visibly damages it — chunks fly off, mass bar decreases.

### Task 3.2: Limb Severance
**Files:** `src/physics/severance.ts`
**Goal:** When meat at a joint thins below threshold, sever the limb:
- Monitor SDF volume at each joint cross-section after damage
- Below threshold → break Rapier joint, detach distal bodies as free props
- Remove severed limb's input bindings
- Recalculate locomotion (redistribute forces to remaining limbs)
- Severed limb becomes a bouncing physics prop
**Acceptance:** Enough hits to a leg joint severs it. Beast falls/drags. Limb flies off.

### Task 3.3: Arena Combat Map
**Files:** `src/combat/arena.ts`
**Goal:** Full arena with terrain features per PRD Section 5.4.1:
- Rocky outcrops (climbable, provide cover)
- Mud pits (slow movement, slippery)
- Ramps (launch for aerial attacks)
- Central shallow pit (slight gravity trap)
- Arena walls (visible, pushback)
- All terrain has matching Rapier colliders
**Acceptance:** Arena has tactical variety. Beasts can hide behind rocks, get stuck in mud, launch off ramps.

### Task 3.4: Match State Machine
**Files:** `src/combat/match.ts`
**Goal:** Full match lifecycle:
- Beast selection → countdown (3s) → fight (3 min) → result
- Win: opponent ≤30% mass. Draw: timer expires. Tiebreak: lower mass loses.
- Track match time, mass percentages
- Trigger result screen on end
**Acceptance:** Match starts, counts down, fight has time limit, winner is declared.

### Task 3.5: Combat HUD
**Files:** `src/combat/hud.ts`
**Goal:** In-combat UI per PRD Section 10.1:
- Top bar: timer (center), P1 mass bar (left), P2 mass bar (right)
- Mass bars are gooey/organic looking, visually shrink as mass is lost
- Stamina bar (small, only shows when <50%)
- Key hints overlay (small, shows bound keys, pulses on press)
**Acceptance:** HUD shows all combat-relevant info without being intrusive.

### Task 3.6: Bot AI
**Files:** `src/combat/bot-ai.ts`
**Goal:** Simple opponent for solo play:
- Random-ish inputs with bias toward moving toward opponent
- Occasionally uses attack keys
- Sometimes panics (space) randomly
- Difficulty: mediocre — should be beatable but not trivial
**Acceptance:** Bot moves toward player and attempts to fight. Clumsy but threatening.

---

## PHASE 4 — Networking (Days 12-13)

### Task 4.1: WebSocket Server
**Files:** `server/index.ts`, `server/match-manager.ts`, `server/ws-handler.ts`
**Goal:** Bun WebSocket relay server:
- Match creation → generates MEAT-XXXX code
- P1 creates, P2 joins with code
- Server relays inputs between players
- Supports spectator connections (read-only)
- State broadcast from host to all clients
**Acceptance:** Two browser tabs can connect, create a match, and relay messages.

### Task 4.2: Client Networking
**Files:** `src/network/ws-client.ts`, `src/network/protocol.ts`
**Goal:** WebSocket client for multiplayer:
- Connect to server, create/join match
- Send local input each frame
- Receive opponent state, apply to remote beast
- Beast serialization exchange at match start
**Acceptance:** Two clients can connect and see each other's beast.

### Task 4.3: State Interpolation
**Files:** `src/network/interpolation.ts`
**Goal:** Smooth remote beast rendering:
- Buffer 2-3 state snapshots
- Interpolate position/rotation between snapshots
- Extrapolate on packet loss
**Acceptance:** Remote beast moves smoothly, no teleporting.

### Task 4.4: Spectator Mode
**Files:** `src/network/spectator.ts`
**Goal:** Watch-only mode:
- Connect to match via URL (meatbash.com/watch/MEAT-XXXX)
- Receive state broadcasts at lower rate (10-30 Hz)
- Free camera or lock-to-beast toggle
- No input sending
**Acceptance:** Third browser tab can watch an ongoing match.

### Task 4.5: Beast Storage Server
**Files:** `server/beast-storage.ts`, `server/db.ts`
**Goal:** Persist certified beasts:
- SQLite database (bun:sqlite) with beasts table
- CRUD operations keyed to client_id
- Upload on certification, fetch on game load
- Simple REST-ish HTTP endpoints alongside WebSocket
**Acceptance:** Certified beasts survive server restart.

---

## PHASE 5 — Darwin Certification (Days 14-15)

### Task 5.1: Certification Framework
**Files:** `src/certification/darwin.ts`
**Goal:** Certification flow controller:
- Sequential 3-challenge flow
- Pass/fail per challenge, retry on fail
- On all-pass: certification stamp animation, upload beast to server
- Silly bureaucratic UI (rubber stamps, clipboards, bored narration)
**Acceptance:** Player can enter certification, attempt challenges, get certified.

### Task 5.2: Walk Challenge
**Files:** `src/certification/challenge-walk.ts`
**Goal:** "Ambulatory Competence Assessment":
- Flat track, ~50m, walls on sides
- Small rock/log obstacle in the middle
- 60 second time limit
- Pass = reach endpoint
**Acceptance:** Beast has to walk from A to B over an obstacle within time.

### Task 5.3: Feed Challenge
**Files:** `src/certification/challenge-feed.ts`
**Goal:** "Dietary Viability Screening":
- Three food items in a small arena: apple on tree, rabbit in pen, leaves on rock ledge
- Pass = touch any one food item
- Each requires different capability (height, speed, climbing)
**Acceptance:** Beast can pass by reaching any food source.

### Task 5.4: Predator Challenge
**Files:** `src/certification/challenge-predator.ts`, `src/certification/predator-ai.ts`
**Goal:** "Predator Evasion Protocol":
- Premade clumsy quadruped AI beast attacks
- Medium difficulty — threatening but comedic
- Pass = survive 30s OR reduce predator to 50% OR reach safe zone
- Predator sometimes trips, attacks rocks, self-destructs (pass by default)
**Acceptance:** Predator is a genuine threat but also hilarious.

---

## PHASE 6 — Polish & Ship (Days 16-18)

### Task 6.1: Premade Beasts
**Files:** `src/beast/premades.ts`
**Goal:** 8 premade certified beasts per PRD Section 6:
- Chonkus, Skitter, Sir Slime, Noodlesnake, Butterchonk, Ratking, Crabsworth, Meatball
- Each with archetype, SDF data, key bindings, personality
- All pre-certified (skip Darwin)
**Acceptance:** 8 unique beasts selectable from garage.

### Task 6.2: Home Screen
**Files:** `src/ui/home-screen.ts`
**Goal:** Main menu per PRD Section 5.1:
- Pulsating MEATBASH title
- Quick Fight / Join Match / Gene Lab buttons
- Beast carousel preview
- Username input (localStorage)
**Acceptance:** Polished main menu that loads instantly.

### Task 6.3: Beast Garage UI
**Files:** `src/ui/garage.ts`
**Goal:** Grid view of all beasts:
- 3D rotating preview per beast
- Name, mass, archetype icon
- Select for match, Clone, Trash actions
- Premades always available
**Acceptance:** Player can browse and manage their beast collection.

### Task 6.4: Vibeverse Portal
**Goal:** Add exit portal in arena that redirects to `portal.pieter.com`:
- Interactive gateway object in arena
- Walking into it redirects browser
- Sends GET params (username, game name)
- Handle `?portal=true` inbound: skip menu, spawn at portal, show return portal
**Acceptance:** Portal works bidirectionally per Vibeverse spec.

### Task 6.5: Remaining Archetypes
**Files:** `src/physics/skeleton.ts`, `src/physics/locomotion.ts`, `src/beast/archetypes.ts`
**Goal:** Implement remaining 5 archetypes:
- Slider (muscular wave, snail-like)
- Wiggler V (vertical caterpillar wave)
- Wiggler H (horizontal snake wave)
- Hexapod (tripod gait)
- Octoped (alternating quad groups)
**Acceptance:** All 7 archetypes walk with their unique locomotion style.

---

## Agent Assignment Strategy

For parallel development, agents can work on these independent tracks:

**Track A (Physics/Gameplay):** Tasks 1.1 → 2.6 → 3.1 → 3.2 → 3.6
**Track B (Visuals/SDF):** Tasks 1.2 → 1.3 → 2.1 → 2.2 → 2.3
**Track C (UI/Lab):** Tasks 1.4 → 2.4 → 3.4 → 3.5 → 6.2 → 6.3
**Track D (Networking):** Tasks 4.1 → 4.2 → 4.3 → 4.4 → 4.5
**Track E (Content):** Tasks 5.1–5.4 → 6.1 → 6.5

Tracks A, B, C can start immediately in parallel.
Track D starts once combat (Phase 3) is functional.
Track E starts once Gene Lab (Phase 2) and Combat (Phase 3) work.
