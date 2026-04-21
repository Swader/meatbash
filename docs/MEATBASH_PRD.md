# MEATBASH — Product Requirements Document

**Version:** 1.2<br>
**Date:** April 21, 2026<br>
**Author:** Bruno Škvorc + Claude<br>
**Target:** Vibejam 2026 (Deadline: May 1, 2026 @ 13:37 UTC)<br>
**Domain:** meatbash.com (or subdomain TBD)

---

## 1. Elevator Pitch

MEATBASH is an organic destruction derby with **WASD active-ragdoll arena combat** and **intentional attack slots** (raise, hold, commit). Players eventually sculpt gooey meatbeasts in a Gene Lab and certify them through absurd fitness tests, but the current milestone is readable, intentional slapstick combat first. Think Robot Wars meets Gang Beasts meets Play-Doh.

---

## 2. Vibejam 2026 Compliance Checklist

| Requirement | How We Meet It |
|---|---|
| 90%+ AI-generated code | Claude Code is primary dev tool |
| New game, created after April 1 2026 | Fresh project, no prior code |
| Web-accessible, free-to-play | Static site, no paywall |
| No login or signup required | LocalStorage + browser fingerprint for beast garage; login optional (future) |
| No heavy loading screens | Instant load to menu; assets are procedural SDFs, not downloaded models |
| Own domain/subdomain | meatbash.com or similar |
| Three.js recommended | Three.js client; current build uses `WebGLRenderer`, with WebGPU reserved for later SDF/compute work |
| Multiplayer preferred | WebSocket-based 1v1 + spectating |
| Vibejam widget embedded | `<script async src="https://vibejam.cc/2026/widget.js"></script>` |
| Vibeverse portal | Exit portal redirecting to `portal.pieter.com` with GET params; handle `?portal=true` inbound |

---

## 3. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | **Bun** | Only acceptable JS runtime. No Node, no npx. |
| 3D Engine | **Three.js** (`WebGLRenderer` now, WebGPU later) | Vibejam recommended; current build stays on WebGL until SDF/compute work makes the WebGPU swap worth it |
| Shading | **TSL** (Three.js Shading Language) | Node-based materials, GPU compute for meat physics |
| Physics | **Rapier 3D** (@dimforge/rapier3d WASM) | Rigid body skeleton physics, collision detection, joint constraints |
| Soft Body | **Custom GPU compute** (TSL/WebGPU) | Meat deformation, chunk detachment, mass loss — Rapier handles skeleton, GPU handles flesh |
| Sculpting | **SDF** (Signed Distance Fields) | Smooth, gooey, Play-Doh aesthetic; ray-marched in editor, meshed (marching cubes) for runtime |
| Networking | **Bun WebSocket server** on DO droplet | Host-authoritative physics, input relay, spectator broadcast |
| Build | **Bun** (bundler) | Zero config, fast, no webpack/vite needed |
| Hosting | **Static files on DO/Cloudflare** | Game client is static; WS server is separate Bun process |
| 3D Assets | **Procedural** (SDFs) + **Tripo3D** if needed | Arena props, food items, predator beast |

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    BROWSER CLIENT                     │
│                                                       │
│  ┌───────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │ Home Menu │→ │ Gene Lab  │→ │ Darwin Cert.     │ │
│  │           │  │ (Sculpt)  │  │ (3 challenges)   │ │
│  └─────┬─────┘  └───────────┘  └──────────────────┘ │
│        │                                              │
│        ▼                                              │
│  ┌───────────────────────────────────────────┐       │
│  │              ARENA (Combat)                │       │
│  │                                            │       │
│  │  Three.js WebGPU Renderer                  │       │
│  │  ├─ TSL Node Materials (meat, chitin, bone)│       │
│  │  ├─ GPU Compute (soft body deformation)    │       │
│  │  ├─ Rapier WASM (skeleton, rigid colliders)│       │
│  │  └─ Input → WebSocket → Server             │       │
│  └───────────────────────────────────────────┘       │
│                                                       │
│  ┌────────────────┐  ┌─────────────────────┐        │
│  │ Beast Garage    │  │ Spectator View      │        │
│  │ (localStorage)  │  │ (read-only WS feed) │        │
│  └────────────────┘  └─────────────────────┘        │
└─────────────────────────────────────────────────────┘
                         │
                    WebSocket
                         │
┌─────────────────────────────────────────────────────┐
│              BUN WS SERVER (DO Droplet)               │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Match Lobby  │  │ Physics Auth │  │ Spectator  │  │
│  │ (code-based) │  │ (host client │  │ Broadcast  │  │
│  │              │  │  is physics  │  │            │  │
│  │              │  │  authority)  │  │            │  │
│  └─────────────┘  └──────────────┘  └────────────┘  │
│                                                       │
│  ┌──────────────────────────────────────────┐        │
│  │ Beast Storage (certified beasts as JSON)  │        │
│  │ SQLite or flat files — nothing fancy      │        │
│  └──────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────┘
```

---

## 5. Game Screens & Flow

### 5.1 Home Screen

**What the player sees on load:**

- Game title "MEATBASH" with gooey, pulsating meat letters
- Three big buttons:
  - **QUICK FIGHT** → pick a premade beast, fight a bot
  - **JOIN MATCH** → enter a match code (e.g. `MEAT-4729`), pick a beast from garage
  - **GENE LAB** → go to beast creator
- Beast Garage preview (carousel of certified beasts, premades included)
- Username input (persisted in localStorage, no auth)

**No loading screen.** Menu renders immediately; 3D preview of a rotating meatbeast loads async in background.

**Current implementation note (2026-04-21):**
- `QUICK FIGHT` into a bot match is live.
- The center panel is already a **Quick Workshop** that can fork the selected
  beast into a playable custom variant.
- `JOIN MATCH`, full Gene Lab flow, and Darwin Certification are still planned
  directions rather than completed game loops.

### 5.2 Gene Lab (Beast Creator)

The core creative experience. Players sculpt organic monstrosities.

**Current implementation note (2026-04-21):** the shipped build only has a
thin **Quick Workshop** on the home screen. It supports:

- archetype swap (`bipedal` / `quadruped`)
- primary attack profile selection (`blunt` / `spike` / `shield`, filtered by archetype)
- charge bias (`quick` / `balanced` / `heavy`)
- color preset selection
- localStorage persistence of forged beasts

The full sculpting lab below remains the intended target, not the current UI.

#### 5.2.1 Archetype Selection

Player picks a base skeleton:

| Archetype | Skeleton | Locomotion Style | Base Legs |
|---|---|---|---|
| **Bipedal** | Spine + 2 leg joints + 2 arm joints | Left/right stride groups | 2 |
| **Quadruped** | Spine + 4 leg joints | Left/right leg pair groups | 4 |
| **Slider** | Spine only (ground contact surface) | Muscular wave (snail-like) | 0 |
| **Wiggler (V)** | Segmented spine (vertical flex) | Vertical wave (caterpillar) | 0 |
| **Wiggler (H)** | Segmented spine (horizontal flex) | Horizontal wave (snake) | 0 |
| **Hexapod** | Spine + 6 leg joints | Tripod gait groups (L1+R2+L3 / R1+L2+R3) | 6 |
| **Octoped** | Spine + 8 leg joints | Alternating quad groups | 8 |

Each archetype provides a minimal wireframe skeleton with repositionable joints. The skeleton constrains where physics joints exist but the player sculpts freely around it.

**Optional modifier (later):** Wings are explicitly cut from the current combat-intent milestone and only return after core combat readability is proven.

#### 5.2.2 Sculpting System

The sculpting interface uses SDF-based blob brushes:

- **Tools:** Add meat, Subtract meat, Change material, Resize brush
- **Materials:**
  - **Meat** (pink/red) — soft, deformable, the main body mass. Takes damage on impact.
  - **Chitin** (dark brown/green) — hard shell. Heavy but protects underlying meat. Deals damage to soft parts that hit it.
  - **Bone/Horn** (white/ivory) — hard weapon/armor. Heaviest but strongest. Can crack chitin, devastates meat.
- **Brush:** Spherical SDF blob. Adjustable radius. Click-drag to place/remove material. Materials merge smoothly (SDF union).
- **Hair painting** (stretch goal): Cosmetic fur/hair strands painted on surface. No gameplay effect. Cool for making bigfoot.

**Visual feedback during sculpting:**
- Real-time weight display (kg)
- Stamina estimate bar (based on weight vs archetype efficiency)
- Center of mass indicator
- Primary attack preview: appendage slot, profile, and rough charge bias

#### 5.2.3 Joint Repositioning

Before sculpting, player can drag skeleton joints to reshape the base pose:
- Leg spread, arm length, spine curvature
- Joint positions determine where Rapier hinge/ball joints are placed
- Joints snap to reasonable ranges (no inside-out skeletons)

#### 5.2.4 Controls and Future Binding

The **current shipping combat milestone** uses one fixed, readable control
scheme while the attack contract is still settling:

| Control | Current Binding | What It Does |
|---|---|---|
| Movement | `WASD` | Drive / turn the active-ragdoll chassis |
| Jump / panic flail | `SPACE` | Jump; also serves as the existing panic-flail input |
| Raise primary attack | `J` | Enter windup / held charge for the beast's authored primary attack |
| Commit primary attack | `K` | Fire the currently raised primary attack |
| Mouse | orbit camera | Viewing only |

The **thin workshop / later Gene Lab** should author combat identity before it
reopens broad rebinding:

- choose primary appendage slot
- choose attack profile (`blunt` / `spike` / `shield`)
- tune appendage mass / charge bias
- optionally add extra attack slots only after the primary attack contract is stable

#### 5.2.5 Beast Stats (Auto-Calculated)

These are derived from the sculpt, not manually set:

| Stat | Derived From |
|---|---|
| **Total Mass** (kg) | Volume of all materials × density (meat=1.0, chitin=2.5, bone=3.0) |
| **Stamina Pool** | Base 100, reduced by mass (heavier = less stamina) |
| **Stamina Regen** | Inverse of mass; lighter beasts recover faster |
| **Move Speed** | Force-to-mass ratio per archetype |
| **Primary Attack Profile** | Author-selected combat contract (`blunt`, `spike`, `shield`) |
| **Charge Bias** | Appendage mass + authored tuning for hold drain / strike cost / payoff |
| **Armor Coverage** | % of surface area covered by chitin/bone |
| **Vulnerability Map** | Exposed meat surface area (the "weak spots") |
| **Damage Output** | Mass × velocity of hard parts on impact |
| **Reach / Weapon Mass** | Joint placement + sculpted mass around the primary attack slot |

### 5.3 Darwin Certification

Three sequential challenges to prove a beast is viable. Silly bureaucratic vibe — "The Beast Bureau" with rubber stamps and clipboards.

**All three must be passed to certify. Retries are unlimited. Maps are fixed (same every time).**

#### Challenge 1: "Ambulatory Competence Assessment"

- **Task:** Walk/slide/wiggle from point A to point B (about 50 meters equivalent)
- **Obstacle:** A small rock or log in the path (must traverse, not go around — walls on sides)
- **Pass condition:** Reach point B within 60 seconds
- **Tone:** A bored bureaucrat voice ("Please proceed to the designated endpoint. You have sixty seconds. ...Fifty-nine... fifty-eight... I'm just kidding, the timer's on screen.")

#### Challenge 2: "Dietary Viability Screening"

- **Task:** Obtain one of three food sources (any one counts):
  - 🍎 **Apple** — hanging from a tree branch (requires height or climbing)
  - 🐰 **Rabbit** — scurries around a small pen (requires speed or cornering)
  - 🌿 **Leaves** — growing on a rock ledge (requires climbing a small rock formation)
- **Pass condition:** Make contact with any one food item
- **Tone:** "The Bureau requires proof of caloric intake capability. We accept all diets. Even... whatever that is."

#### Challenge 3: "Predator Evasion Protocol"

- **Task:** Survive interaction with The Bureaucrat's Pet — a mid-difficulty AI meatbeast
- **The predator:** A premade clumsy quadruped AI beast. Medium aggression, medium speed. Occasionally trips over itself. Can be defeated, outrun, or outlasted.
- **Pass condition:** Survive 30 seconds OR reduce predator to 50% mass OR reach a "safe zone" marked on the map
- **Comedy factor:** The predator sometimes gets itself stuck, falls off things, or attacks a rock. If it self-destructs, you pass by default. The bureaucrat sighs audibly.

**On certification:**
- Beast gets a "DARWIN CERTIFIED" stamp animation
- Beast is saved to server-side garage (bound to localStorage ID / browser fingerprint)
- Beast JSON is uploaded and stored
- Certified beasts cannot be edited (clone + re-certify for changes)
- Certified beasts can be trashed (deleted)

### 5.4 Arena (Combat)

The main event.

#### 5.4.1 Arena Layout

A large arena — roughly 4× the size of an MMA octagon relative to beast scale. Not a flat circle but a terrain with features:

- **Rocky outcrops** — climbable cover, high ground advantage, some beasts can hide behind/on them
- **Mud pits** — slow movement, slippery surfaces, hard to get out of
- **Ramps** — launch off for aerial attacks or escape
- **Central pit** (shallow) — gravitational trap, slightly lower, beasts slide toward center
- **Walls** — arena boundary. No ring-outs, but getting pinned against a wall is bad

The arena is fixed (not procedural) but has enough terrain variety to create tactical decisions.

#### 5.4.2 Combat Rules

| Parameter | Value |
|---|---|
| **Players** | 1v1 |
| **Match duration** | 3 minutes |
| **Win condition** | Reduce opponent to ≤30% of original mass |
| **Draw condition** | Timer expires, both above 30% |
| **Tiebreaker** | Lower mass % loses (more damaged = loses) |

#### 5.4.3 Damage Model

**Mass-as-HP:** A beast's remaining mass IS its health. Damage removes meat.

**Impact damage formula:**
```
damage = (relative_velocity × impactor_mass × material_multiplier) / defender_material_resistance
```

**Material interaction matrix:**

| Attacker ↓ / Defender → | Meat | Chitin | Bone |
|---|---|---|---|
| **Meat** | Low damage to both (squishy slap) | Attacker takes damage (hit armor) | Attacker takes heavy damage |
| **Chitin** | Medium damage to defender | Both take minor chip damage | Attacker chips, defender cracks slightly |
| **Bone** | High damage to defender | Cracks chitin, reveals meat below | Both take chip damage, sparks fly |

**On impact:**
- Meat chunks fly off the damaged area (visual + actual mass loss)
- SDF is locally subtracted at impact point
- Velocity and mass of impactor determine crater size

**Limb severance:**
- If meat at a joint thins below a threshold, the limb detaches
- Severed limb becomes a physics prop (flies off, bounces around)
- Beast loses that limb's locomotion contribution
- Remaining locomotion adapts: a quadruped losing one leg now drags that side, biped losing a leg falls and must drag/crawl
- A rat-type beast can strategically whittle legs off a larger opponent, causing collapse, then reach newly exposed meat

**Stamina:**
- Every movement action costs stamina proportional to beast mass
- Stamina regenerates passively (faster for lighter beasts)
- At zero stamina, beast can only twitch weakly (can still take/deal collision damage from momentum)
- Panic flail costs 3× normal stamina
- Holding `J` drains stamina while charging; heavier appendages also increase strike cost and recovery burden

#### 5.4.4 Camera

- Third-person follow cam, orbitable with mouse
- Slight lag/smoothing for cinematic feel
- Auto-zoom based on distance between combatants
- Spectators get free-cam or can lock onto either beast

### 5.5 Beast Garage

- Grid view of all certified beasts + premade beasts
- Each beast shows: 3D rotating preview, name, mass, archetype icon
- Actions: Select for match, Clone (to Gene Lab), Trash (delete)
- Premade beasts are always available and cannot be trashed
- Storage: certified beasts stored server-side keyed to localStorage token; premades are bundled with client

### 5.6 Spectator Mode

- Anyone with the match URL (e.g., `meatbash.com/watch/MEAT-4729`) can spectate
- Read-only WebSocket feed: receives physics state, renders locally
- Free camera or lock-to-beast toggle
- No degradation of player experience: spectators receive state snapshots at lower frequency (10 Hz vs 60 Hz for players) if load is high
- No limit on spectator count (server broadcasts same state to all; if thousands connect, implement fan-out or accept degradation gracefully)

---

## 6. Premade Beasts

Ship with premades that communicate attack identity immediately:

| Name | Archetype | Attack Profile | Strategy |
|---|---|---|---|
| **Chonkus** | Bipedal | **Blunt** | Tank punish arm. Obvious windup, heavy knockback. |
| **Skitter** | Hexapod | Fast insectoid, thin legs, chitin shell | Speed. Dart in, bite, dart out |
| **Sir Slime** | Slider | Giant snail with bone horn on head | Ram. Slow approach, devastating headbutt |
| **Noodlesnake** | Bipedal | **Spike** | Fast precision poke. Low certainty, high payoff on clean align. |
| **Butterchonk** | Quadruped | **Shield** | Heavy shover. Wins by destabilizing and body control. |
| **Ratking** | Quadruped | Tiny, fast, sharp bone teeth | Glass cannon. Ankle-biter, leg severer |
| **Crabsworth** | Octoped | Crab-like, full chitin armor, slow | Fortress. Nearly impervious front, soft belly |
| **Meatball** | Slider (spherical) | Just a ball of meat that rolls | Chaos. Unpredictable, hard to control, funny |

---

## 7. Physics Architecture

### 7.1 Dual-Layer Physics

**Layer 1: Skeleton (Rapier WASM — CPU)**
- Rigid body per bone segment
- Hinge/ball joints at each joint position from the skeleton
- Collider shapes approximating bone positions
- Ground contact, wall collision, beast-vs-beast collision
- Joint motors driven by player input (WASD targets gait poses; the SUPPORTED/STUMBLING/FALLEN/RECOVERING state machine handles balance)
- Gravity, friction, restitution

**Layer 2: Flesh (GPU Compute — WebGPU/TSL)**
- SDF volume representing all meat/chitin/bone layered on skeleton
- On impact collision (detected by Rapier contact events), run GPU compute to:
  - Calculate damage at contact point
  - Subtract SDF volume (crater/chunk removal)
  - Update mass and center-of-mass
  - Spawn chunk particles (detached meat bits)
- Mesh regeneration via marching cubes after deformation (can be throttled to every N frames for perf)

**Why dual-layer:**
- Rapier handles what it's good at: rigid body dynamics, joints, collision detection, ground contact
- GPU compute handles what needs parallelism: SDF evaluation, deformation, mesh extraction
- This avoids needing a full soft-body engine while still getting gooey deformation visuals

### 7.2 Limb Severance Logic

1. Rapier reports persistent contact at a joint region
2. GPU compute evaluates remaining meat volume at that joint cross-section
3. If volume < threshold → sever:
   - Break the Rapier joint constraint
   - The distal rigid bodies become a separate free-falling prop
   - Remove that limb's input mapping
   - Recalculate locomotion (redistribute forces to remaining limbs)

### 7.3 Locomotion Physics

Player keys don't directly move the beast. They apply **torques to joints:**

- Q pressed → apply torque to left leg hip joint(s) in stride direction
- The leg swings, hits the ground, friction propels the body forward
- This creates the inherent clumsiness: the beast doesn't glide, it stumbles, lurches, wobbles
- Different archetypes have different torque patterns:
  - Bipedal: alternating hip torques, constant balance corrections (hardest to control)
  - Quadruped: paired hip torques, more stable
  - Slider: sinusoidal body contraction wave
  - Wiggler: traveling wave along spine joints
  - Hexapod/Octoped: grouped alternating leg torques

**Weight affects everything:** Heavier beasts need more torque (more stamina) to achieve the same angular velocity. A 500kg beast lumbers. A 50kg beast scurries.

---

## 8. Networking

### 8.1 Architecture: Host-Authoritative

- **Player 1 (host)** creates a match → gets code `MEAT-XXXX`
- **Player 2** joins with code → WebSocket connects to Bun server
- **Server role:** Relay only. Routes P1 inputs to P2's client and vice versa. The host client (P1) runs the authoritative physics simulation.
- **Spectators** connect to the same match room. Receive state broadcasts only.

### 8.2 Protocol

**Client → Server:**
```json
{
  "type": "input",
  "frame": 12345,
  "keys": { "Q": true, "W": false, "E": false, "SPACE": false },
  "mouse": { "dx": 1.2, "dy": -0.3 }
}
```

**Server → Clients (state broadcast from host):**
```json
{
  "type": "state",
  "frame": 12345,
  "bodies": [
    { "id": 0, "pos": [x,y,z], "rot": [x,y,z,w], "vel": [x,y,z] },
    ...
  ],
  "damage_events": [
    { "beast": 0, "point": [x,y,z], "amount": 12.5, "chunk_vel": [x,y,z] }
  ],
  "mass": [85.2, 420.1],
  "stamina": [67, 34],
  "time_remaining": 142.5
}
```

**Tick rate:**
- Host physics: 60 Hz
- State broadcast to opponent: 30 Hz (interpolated on receiving client)
- State broadcast to spectators: 10-30 Hz (adaptive based on spectator count)

### 8.3 Match Lifecycle

1. P1 creates match → server assigns `MEAT-XXXX` code
2. P1 selects beast, waits in lobby
3. P2 joins with code, selects beast
4. Both beasts are serialized (SDF + skeleton + bindings) and exchanged
5. 3-second countdown
6. 3-minute fight, host-authoritative
7. Result screen (winner/draw)
8. Return to lobby or rematch

### 8.4 Beast Serialization Format

Beasts are stored and transmitted as JSON:

```json
{
  "version": 1,
  "name": "Chonkus",
  "archetype": "bipedal",
  "skeleton": {
    "joints": [
      { "id": "hip_l", "type": "hinge", "pos": [x,y,z], "axis": [x,y,z], "limits": [min, max] },
      ...
    ],
    "bones": [
      { "id": "spine", "from": "root", "to": "chest", "length": 1.2 },
      ...
    ]
  },
  "sdf_layers": [
    {
      "material": "meat",
      "blobs": [
        { "pos": [x,y,z], "radius": 0.5 },
        ...
      ]
    },
    {
      "material": "chitin",
      "blobs": [...]
    },
    {
      "material": "bone",
      "blobs": [...]
    }
  ],
  "wings": null | { "pos": [x,y,z], "span": 2.0, "area": 3.5 },
  "bindings": {
    "Q": { "joint": "hip_l", "torque": [0, 0, 50] },
    "W": { "joint": "hip_r", "torque": [0, 0, 50] },
    "E": { "joint": "arm_r", "torque": [80, 0, 0] },
    "SPACE": "panic"
  },
  "stats": {
    "total_mass": 120.5,
    "stamina_pool": 72,
    "stamina_regen": 1.8,
    "can_fly": false,
    "armor_coverage": 0.35
  },
  "certified": true,
  "created_at": "2026-04-15T12:00:00Z"
}
```

---

## 9. Rendering

### 9.1 WebGPU Renderer Setup

```javascript
import * as THREE from 'three/webgpu';
import { color, time, normalWorld, positionWorld, Fn, float } from 'three/tsl';

const renderer = new THREE.WebGPURenderer();
await renderer.init();
```

**Fallback:** If WebGPU not available, fall back to WebGLRenderer with reduced effects. Show warning banner.

### 9.2 Material Shading (TSL)

**Meat material:**
- Subsurface scattering approximation (fresnel-based rim glow, reddish)
- Slightly translucent
- Jiggly vertex displacement on movement (GPU compute drives a wobble offset buffer)
- Gets progressively darker/redder where damaged

**Chitin material:**
- Hard, glossy, dark shell look
- Iridescent sheen (thin-film interference via TSL)
- Crack patterns appear where damaged (normal map perturbation)

**Bone/Horn material:**
- Matte white/ivory
- Rough surface
- Chips and scratches accumulate (roughness map modification)

### 9.3 Particle Effects

GPU compute particle systems for:
- **Meat chunks** — pink blobs that fly off on impact, bounce, and fade
- **Splatter** — flat decals on arena surfaces where meat hits
- **Chitin shards** — hard angular fragments
- **Dust/dirt** — from ground impacts and sliding
- **Sweat/drool** — from exhausted beasts (low stamina visual)

### 9.4 Arena Rendering

- Stylized, slightly cartoonish terrain
- Warm earthy tones (sandy, rocky)
- Mud pits with reflective wet surface shader
- Sky: dramatic clouds, warm sunset lighting (side-lit for good drama/shadows)
- Directional light + ambient for consistent readability

---

## 10. UI/UX

### 10.1 HUD (In Combat)

Minimal, non-intrusive:

- **Top bar:** Timer (center), P1 mass % (left), P2 mass % (right) — shown as gooey meat bars that literally shrink
- **Bottom:** Stamina bar (small, only appears when below 50%)
- **Key hints:** Small overlay showing bound keys, pulses when pressed
- **No health numbers** — just the visual meat bars and the visible state of your beast

### 10.2 Art Style

- **Whimsical, silly, gross-cute** — like Totally Reliable Delivery Service meets Surgeon Simulator
- **Color palette:** Warm pinks (meat), earth tones (arena), accent greens and browns (chitin)
- **Typography:** Bold, rounded, slightly melty font for headers. Clean sans-serif for UI text.
- **Animations:** Everything bounces slightly. Menu buttons jiggle on hover. The logo pulses like a heartbeat.

### 10.3 Sound

Architecture should support:
- Spatial audio hookpoints for: impact sounds, squelch, splatter, bone crack, crowd reactions
- Music hookpoint: themed menu/battle/lab tracks, with an on-screen credit widget
- Announcer voice hookpoint: play-by-play clips

Current implementation:
- Sound-sprite playback exists for jump, land, hit, and miss cues.
- Theme music switches by screen context (HOME/menu, ARENA/battle, LAB/lab when present).
- The lower-right music widget shows waveform bars plus `Tragikomik: <track>` and links out to the artist URL.

Future polish:
- Better mixing and dynamic ducking.
- More spatialized impact layering and announcer VO.

---

## 11. Post-Match Screen (Stretch Goal)

If time permits, show after combat:

- **Winner announcement** with confetti (meat confetti)
- **Stats:**
  - Mass lost (in grams, absurdly precise: "You lost 14,237g of premium meat")
  - Limbs severed (per beast)
  - Hardest single hit (in "megatons" or some silly unit)
  - Time spent airborne (if applicable)
  - Distance traveled
- **Rematch** button
- **New Match** button

---

## 12. Data Persistence

### 12.1 Client-Side (localStorage)

- `meatbash_username`: string
- `meatbash_client_id`: UUID (generated on first visit, used to identify player)
- `meatbash_garage_cache`: JSON array of beast summaries (for offline viewing; server is source of truth)
- `meatbash_workshop_beasts_v1`: JSON array of locally forged quick-workshop beasts

### 12.2 Server-Side (SQLite on Bun server)

**Table: beasts**
```sql
CREATE TABLE beasts (
  id TEXT PRIMARY KEY,              -- UUID
  client_id TEXT NOT NULL,          -- links to browser
  name TEXT NOT NULL,
  archetype TEXT NOT NULL,
  data JSON NOT NULL,               -- full beast serialization
  certified BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_beasts_client ON beasts(client_id);
```

**Table: matches** (optional, for stats)
```sql
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,        -- MEAT-XXXX
  p1_client_id TEXT,
  p2_client_id TEXT,
  p1_beast_id TEXT,
  p2_beast_id TEXT,
  winner_client_id TEXT,            -- NULL for draw
  duration_seconds REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 13. Development Phases

### Current shipping priority (April 2026 reality)

1. **Combat Intent V1** — intentional attack slots, attack-aware damage, hit feedback, readable beast cards.
2. **Attack Readability / Attack Contract pass** — every premade gets one readable, honest primary attack with a clear silhouette and hit fantasy.
3. **Thin workshop** — expose only appendage/profile/mass/charge authoring, not the full sculpt lab yet.
4. **Networking + certification** only after combat readability is confirmed in playtests.

### Phase 1: Core Loop (Days 1–5) — April 13–17

**Goal:** A meat blob controlled with WASD that stands, walks, turns, jumps, falls, and recovers on a real heightfield arena.

- [x] Project setup (Bun, Three.js WebGPU, Rapier WASM)
- [x] WebGPU renderer with basic scene (heightfield ground, lighting, dust, walls)
- [ ] SDF blob rendering (single meat sphere, ray-marched or marching-cubed)
- [x] Rapier skeleton: dynamic bipedal rig with motorized hip/knee/ankle joints, foot sensors, joint contact disabled
- [x] Active-ragdoll locomotion: WASD movement, smoothed turning, support-based standing, jump
- [x] SUPPORTED/STUMBLING/FALLEN/RECOVERING state machine (no balloon mode)
- [x] Honest physics arena: heightfield ground + convex-hull rocks matching the visual mesh
- [x] Camera follow

### Phase 2: Sculpting & Materials (Days 6–8) — April 18–20

**Goal:** Gene Lab where you can sculpt a beast onto a skeleton.

- [ ] Archetype selection (start with bipedal + quadruped)
- [ ] SDF sculpt UI: add/subtract/material tool, resize brush
- [ ] Joint repositioning UI
- [ ] Material shading (meat, chitin, bone — distinct TSL materials)
- [ ] Real-time stats display (mass, stamina estimate)
- [ ] Key binding UI
- [ ] Beast serialization to/from JSON

### Phase 3: Combat (Days 9–11) — April 21–23

**Goal:** Two beasts fighting in an arena with damage.

- [ ] Arena model (terrain features: rocks, mud, ramps, walls)
- [ ] Damage model: impact detection → SDF subtraction → mass loss
- [ ] Meat chunk particles on impact
- [ ] Limb severance when joint meat thins
- [ ] Locomotion degradation on limb loss
- [ ] HP (mass %) display
- [ ] Stamina system
- [ ] Win/draw/timer conditions
- [ ] Basic bot AI (random inputs with slight bias toward opponent)

### Phase 4: Networking (Days 12–13) — April 24–25

**Goal:** Two players fighting over WebSocket.

- [ ] Bun WebSocket server (match creation, code generation, relay)
- [ ] Client-side input sending
- [ ] Host-authoritative state broadcast
- [ ] Beast exchange on match start
- [ ] Interpolation on receiving client
- [ ] Spectator mode (read-only WS feed, free camera)

### Phase 5: Darwin Certification (Days 14–15) — April 26–27

**Goal:** Three certification challenges playable.

- [ ] Challenge 1: Walk A→B with obstacle
- [ ] Challenge 2: Get food (apple/rabbit/leaves)
- [ ] Challenge 3: Survive predator AI
- [ ] Certification stamp animation
- [ ] Server-side beast storage on certification
- [ ] Beast Garage UI (select, clone, trash)

### Phase 6: Polish & Ship (Days 16–18) — April 28–30

**Goal:** Polished, memeable, shippable.

- [ ] All 8 premade beasts created and certified
- [ ] Remaining archetypes (slider, wigglers, hexapod, octoped)
- [ ] Home screen with all flows working
- [ ] Vibeverse portal integration
- [ ] Vibejam widget embedded
- [ ] Username persistence
- [ ] Post-match stats (if time)
- [ ] Hair painting (if time)
- [ ] Bug fixes, perf optimization, playtesting
- [ ] Deploy to production domain
- [ ] Submit to vibejam

---

## 14. File Structure

```
meatbash/
├── bun.lockb
├── package.json                    # Bun project, zero Node
├── bunfig.toml
├── CLAUDE.md                       # AI context file
├── MEMORY.md                       # AI learnings
│
├── src/
│   ├── index.html                  # Entry point, instant load
│   ├── main.ts                     # App bootstrap
│   │
│   ├── engine/
│   │   ├── renderer.ts             # WebGPU renderer setup + fallback
│   │   ├── scene.ts                # Scene management
│   │   ├── camera.ts               # Follow cam, spectator cam
│   │   ├── input.ts                # Keyboard state manager
│   │   └── loop.ts                 # Game loop (fixed timestep physics, variable render)
│   │
│   ├── physics/
│   │   ├── rapier-world.ts         # Rapier init, step, body management
│   │   ├── skeleton.ts             # Skeleton builder from archetype
│   │   ├── locomotion.ts           # Torque application per archetype
│   │   ├── damage.ts               # Impact detection → damage calculation
│   │   └── severance.ts            # Limb detachment logic
│   │
│   ├── sdf/
│   │   ├── sdf-volume.ts           # SDF representation (blob list)
│   │   ├── sdf-ops.ts              # Union, subtract, smooth blend
│   │   ├── marching-cubes.ts       # SDF → mesh extraction
│   │   ├── gpu-deform.ts           # WebGPU compute for damage deformation
│   │   └── materials.ts            # TSL node materials (meat, chitin, bone)
│   │
│   ├── beast/
│   │   ├── beast.ts                # Beast class (skeleton + SDF + bindings + stats)
│   │   ├── archetypes.ts           # Archetype definitions
│   │   ├── serialization.ts        # To/from JSON
│   │   ├── stats.ts                # Auto-calculate stats from SDF
│   │   └── premades.ts             # 8 premade beast definitions
│   │
│   ├── combat/
│   │   ├── arena.ts                # Arena geometry and features
│   │   ├── match.ts                # Match state machine (countdown, fight, result)
│   │   ├── hud.ts                  # In-combat UI overlay
│   │   └── bot-ai.ts              # Simple bot (random-ish inputs)
│   │
│   ├── lab/
│   │   ├── gene-lab.ts             # Sculpting scene & tools
│   │   ├── sculpt-brush.ts         # Add/subtract/material brush
│   │   ├── joint-editor.ts         # Joint repositioning UI
│   │   ├── key-binder.ts           # Key assignment UI
│   │   └── preview.ts              # Real-time beast preview + stats
│   │
│   ├── certification/
│   │   ├── darwin.ts               # Certification flow controller
│   │   ├── challenge-walk.ts       # Challenge 1
│   │   ├── challenge-feed.ts       # Challenge 2
│   │   ├── challenge-predator.ts   # Challenge 3
│   │   └── predator-ai.ts         # The clumsy predator beast AI
│   │
│   ├── network/
│   │   ├── ws-client.ts            # WebSocket client
│   │   ├── protocol.ts             # Message types and serialization
│   │   ├── interpolation.ts        # State interpolation for remote beasts
│   │   └── spectator.ts            # Spectator camera controls
│   │
│   ├── ui/
│   │   ├── home-screen.ts          # Main menu
│   │   ├── garage.ts               # Beast garage grid
│   │   ├── match-lobby.ts          # Pre-match lobby
│   │   ├── result-screen.ts        # Post-match
│   │   └── components.ts           # Shared UI elements (buttons, inputs)
│   │
│   ├── particles/
│   │   ├── meat-chunks.ts          # GPU particle system for meat debris
│   │   ├── splatter.ts             # Ground decals
│   │   └── effects.ts              # Dust, sweat, chitin shards
│   │
│   └── audio/
│       └── audio-manager.ts        # SFX playback + menu/battle/lab music context switching
│
├── server/
│   ├── index.ts                    # Bun WebSocket server entry
│   ├── match-manager.ts            # Create/join/destroy matches
│   ├── ws-handler.ts               # Message routing
│   ├── beast-storage.ts            # SQLite beast CRUD
│   └── db.ts                       # SQLite init (bun:sqlite)
│
├── public/
│   ├── favicon.ico
│   └── og-image.png                # Social share image (meatbeast)
│
└── assets/                         # If any static 3D assets needed (arena props via Tripo3D)
    └── arena/
```

---

## 15. Key Technical Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **SDF ray-marching too slow for combat** | Low FPS in fights | Mesh SDFs via marching cubes at creation time; only re-mesh on damage events, not every frame. Keep ray-marching for Gene Lab editor only. |
| **Marching cubes mesh quality** | Ugly beasts | Use dual contouring or Surface Nets for smoother mesh. Tune grid resolution (64³ should be fine). |
| **Rapier + custom flesh physics integration** | Bugs, desyncs | Keep clear boundary: Rapier owns rigid bodies and contacts. GPU compute owns visual deformation. Rapier contact events trigger GPU damage compute. No two-way coupling of deformation→physics (simplification). |
| **WebGPU browser support** | Some users can't play | WebGL fallback renderer with simplified materials. Most desktop Chrome/Edge/Firefox supports WebGPU in 2026. |
| **Networking latency** | Jittery remote beast | Client-side interpolation + extrapolation for remote beast. Host-authoritative means host has perfect experience. |
| **Beast serialization size** | Slow beast exchange | SDF blob lists are compact (position + radius per blob). Even 500 blobs = ~12KB JSON. Negligible. |
| **Scope creep** | Miss deadline | Phases are prioritized. Phase 1–4 = shippable MVP (sculpt → fight → multiplayer). Phase 5–6 = polish. Cut certification challenges if needed (just certify all beasts by default). |

---

## 16. Definition of Done (MVP for Submission)

The game is submittable when:

- [ ] Player can open the URL and see the home screen instantly
- [ ] Player can select a premade beast and fight a bot in the arena
- [ ] WASD active-ragdoll controls make the beast stumble around and attack (clumsiness from physics, not awkward keys)
- [ ] Damage is visible (meat chunks fly off, mass bar decreases)
- [ ] Gene Lab allows sculpting a beast with meat/chitin/bone
- [ ] At least 2 archetypes work (bipedal, quadruped)
- [ ] Darwin certification works for at least the walk challenge
- [ ] 1v1 multiplayer works via match codes
- [ ] Spectating works
- [ ] Vibejam widget is embedded
- [ ] Vibeverse portal exists
- [ ] Game runs at 30+ FPS on decent hardware
- [ ] It's funny

---

## 17. Success Metrics (Post-Launch)

Not for the jam, but for knowing if the game hits:

- **Average session length** > 5 minutes (people are hooked)
- **Gene Lab usage** > 50% of sessions (people sculpt, not just premades)
- **Multiplayer matches** > 30% of sessions (networking works, people invite friends)
- **Social sharing** — meatbeast screenshots/clips shared on X/Twitter/TikTok
- **"One more match" rate** — rematch % after first fight
- **Twitch streamability** — does a streamer pick it up? Does chat lose it?

---

## 18. Open Questions (Decide During Development)

1. **SDF grid resolution:** 32³, 64³, or 128³ for beast volumes? Start with 64³, tune based on perf.
2. **Marching cubes frequency:** Re-mesh every damage event, or batch and re-mesh every N frames? Start with every event, throttle if slow.
3. **Predator AI complexity:** How smart? Start dumb (random walk toward player), iterate if too easy.
4. **Combat brace assist:** how much extra turn/support authority is healthy during `J` without sanding away the clumsy chassis?
5. **Arena prop density:** More terrain = more tactical but harder to navigate for clumsy beasts. Playtest and tune.
6. **Spectator count scaling:** At what point do we need fan-out? Probably never for the jam. Cross that bridge if streaming blows up.

---

*This document is the single source of truth for MEATBASH development. All AI agents working on this project should reference this PRD. Update this document as decisions are made on open questions.*
