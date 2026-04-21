# MEATBASH — Next Plan + Multiplayer PRD Addition

**Date:** 2026-04-21  
**Status:** local bot loop is fun enough to protect; movement/combat/workshop/multiplayer now need ruthless scope control.

## 0. Executive call

Do **not** pivot to Smash Bros movement. That would sand off the thing that makes MEATBASH distinct. The right target is:

> **Clumsy body, readable intent, explosive payoff.**

Movement should stay awkward, but it must become **learnably awkward**. Attacks should become much more dramatic and mechanically honest. Workshop should stop creating reskinned clones. Multiplayer should start as a pragmatic host-authoritative 1v1, not a perfect deterministic netcode project.

The next sprint should be:

1. **Skillful clumsy movement pass** — initial facing, braced aim, less random yaw chaos.
2. **Oomph pass** — charge glow, heavy-hit boom, whiff stamina punishment, stronger launch.
3. **Severance contract fix** — dead/severed attack limbs cannot be visually or mechanically summoned back.
4. **Workshop V2 thin-but-real** — expose knobs that alter body/attack behavior, not just labels/colors.
5. **Multiplayer V1** — host-authoritative 1v1 with match codes, JSON snapshots, no login, bot mode retained.

---

## 1. Current code/doc audit highlights

### 1.1 Spawn-facing is probably sabotaging first-contact control

`src/main.ts:130-134` says the beasts are spawned facing each other, but `src/beast/beast-factory.ts:21` says `yaw` is “reserved for future” and is not applied.

Current spawn:

```ts
player = spawnBeast(playerDef, scene, physics, { x: -3, z: 0, beastIndex: 0 });
opponent = spawnBeast(opponentDef, scene, physics, { x: 3, z: 0, beastIndex: 1 });
```

At yaw `0`, forward is `+Z`, while the opponent is along `+X` or `-X`. So both creatures begin side-on and must first solve the worst part of the controller — turning — before combat even starts.

**Fix this immediately.** It is a high-impact, low-risk change.

### 1.2 Charge telegraph is effectively disabled

`src/beast/beast-instance.ts` has `createAttackIndicator()` returning immediately, and `updateAttackTelegraph()` currently resets `meatMaterial.emissiveIntensity` and hides any indicator group. So the game has attack states, but no real charge aura/glow.

That directly explains “punches connect but feel vanilla.” The state machine exists; the payoff language does not.

### 1.3 Severed limbs are still valid attack/visual rig participants

`src/physics/severance.ts` removes the joint and marks `segmentAttached` false in `DamageResolver`, but `BeastInstance` and `AttackController` do not consult that attachment state.

The custom visual rigs in `src/beast/beast-instance.ts` manually place arm meshes relative to the torso during attack states. That is why a severed arm appears to snap back into the body while `J` is held, then drops back to the floor when released.

This is not a physics bug. It is an **ownership contract bug**: visual attack rigs are allowed to override detached physics bodies.

### 1.4 Workshop is currently a template cloner

`src/beast/workshop.ts` mostly clones Chonkus / Noodlesnake / Stomper attack slots and tweaks numbers. That is fine as a first UI pass, but it cannot produce meaningfully different monsters. It changes labels and biases more than body truth.

Workshop V2 must expose a small set of knobs that actually alter physics/attack behavior.

### 1.5 Multiplayer exists in the PRD, but it is outdated and too thin

`docs/MEATBASH_PRD.md §8` has the right broad idea — host-authoritative, WebSocket relay, match codes — but the protocol still shows old `Q/W/E` controls and beast serialization still includes wings and old binding ideas.

This document includes a replacement multiplayer addition below.

---

## 2. Design target: “learnably awkward” movement

The current complaint is correct: if movement is hard but not learnable, players will blame the game. QWOP works because the controls are absurd but deterministic. MEATBASH needs the same property.

The movement target is not “easy.” It is:

- I can tell which way I am facing.
- I can intentionally line up an attack.
- When I fail, I understand whether I over-turned, over-charged, missed, slipped, or got launched.
- Repetition makes me better.

## 3. Movement implementation plan

### 3.1 Fix spawn yaw first

Add `yaw` support to `spawnBeast()` and apply it to all rigid bodies after skeleton creation.

Use Three/Rapier yaw convention already used by `getYaw()`:

- yaw `0` faces `+Z`
- yaw `Math.PI / 2` faces `+X`
- yaw `-Math.PI / 2` faces `-X`

In `src/main.ts`:

```ts
player = spawnBeast(playerDef, scene, physics, {
  x: -3,
  z: 0,
  yaw: Math.PI / 2,
  beastIndex: 0,
});

opponent = spawnBeast(opponentDef, scene, physics, {
  x: 3,
  z: 0,
  yaw: -Math.PI / 2,
  beastIndex: 1,
});
```

In `src/beast/beast-factory.ts`, after creating the skeleton, rotate all body translations around the spawn center and set body rotation to a yaw quaternion.

Pseudo-code:

```ts
function applyInitialYaw(skeleton: GenericSkeleton, originX: number, originZ: number, yaw = 0) {
  if (!yaw) return;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const half = yaw * 0.5;
  const q = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };

  for (const body of skeleton.allBodies) {
    const p = body.translation();
    const dx = p.x - originX;
    const dz = p.z - originZ;

    body.setTranslation({
      x: originX + dx * c + dz * s,
      y: p.y,
      z: originZ - dx * s + dz * c,
    }, true);

    body.setRotation(q, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
```

Acceptance check: start a match, press `W`, and both player/bot should naturally close distance without needing a 90° turn first.

### 3.2 Add “combat brace aim” while `J` is held

Do not rewrite locomotion yet. Add an aim/brace layer.

When `J` is held:

- forward/back drive is reduced
- turning authority is increased but smoothed
- upright/support assist is slightly increased
- if an enemy is in front-ish arc, yaw receives a weak auto-face torque

The player still controls facing, but the game helps them line up the blow.

Add to `AttackMovementModifiers`:

```ts
softFaceTarget?: { x: number; z: number; strength: number; maxYawRate: number };
```

Or keep it simpler: store the current combat target on `BeastInstance` and let locomotion read `locoState.combatTargetYaw` while attack state is `WINDUP` / `HELD`.

In `main.ts`, after spawning:

```ts
player.setCombatTarget(opponent);
opponent.setCombatTarget(player);
```

In biped/quad locomotion, after normal yaw target calculation:

```ts
if (attackHeld && combatTargetYaw !== null) {
  const yawDelta = shortestAngle(combatTargetYaw - currentYaw);
  const assist = clamp(yawDelta, -assistMaxRate, assistMaxRate) * assistStrength;
  targetYawRate += assist;
}
```

Recommended initial values:

```ts
braceAimAssistStrength = 0.45;
braceAimAssistMaxRate = 1.0; // rad/s
braceAimAssistArcDot = -0.15; // forgiving, not full lock-on
```

### 3.3 Reduce turn volatility

Current values in `src/physics/tuning.ts` are aggressive:

```ts
maxYawRate: 3.0,
turnSharpness: 18.0,
yawRateSharpness: 16.0,
turnTorquePerKg: 3.0,
```

Try this **Learnable Clumsy V1** preset:

```ts
maxYawRate: 2.0,
turnSharpness: 9.0,
yawRateSharpness: 7.0,
turnTorquePerKg: 2.4,
turnTiltDamp: 1.6,
forwardAccel: 3.0,
backwardAccel: 1.8,
horizontalBrake: 1.0,
slopeStabilityBoost: 3.2,
```

Why: you want turning to be slower but less explosive. Fast turn response is not the same as good control. The current snap-to-yaw-rate behavior can feel like steering a drunk shopping cart because the body receives strong yaw corrections before the feet/support state catches up.

### 3.4 Timebox the “compass legs” experiment

The A/D alternating-leg compass movement idea has value, but only as an experiment. It does not generalize cleanly to quadrupeds/crawlers unless you abstract it as **support group A / support group B**.

Do not make it the default now.

Implement only behind a debug toggle:

```ts
locomotionMode = 'auto_gait' | 'support_step_debug';
```

For biped:

- holding `A` plants right foot, raises/swings left side, applies small yaw/advance around right support
- holding `D` plants left foot, raises/swings right side, applies small yaw/advance around left support
- tapping alternately moves forward through wobble

For quadruped:

- group A = FL + BR
- group B = FR + BL
- same concept, but it will probably feel less readable

Timebox: **one evening max**. If it does not immediately improve learnability, kill it. The mainline fix is brace aim + spawn yaw + calmer turning.

---

## 4. Attack oomph plan

## 4.1 Restore charge telegraph, but make it appendage-local

Do not use one shared `meatMaterial.emissiveIntensity` for the whole beast. That makes the whole monster glow and is hard to read. Instead, create an `AttackTelegraphView` per beast that renders near the active appendage.

Add:

```ts
src/combat/attack-telegraph-view.ts
```

Responsibilities:

- find the active appendage/tip/body world position
- draw a glow/aura around it while `WINDUP` / `HELD`
- scale intensity by `chargeNorm`
- change visual tier at quick/ready/heavy
- hide immediately in `IDLE` / `RECOVER`

Visual bands:

| Tier | Hold | Visual | Meaning |
|---|---:|---|---|
| quick | low | small pulsing glow | fast jab/slap |
| ready | medium | brighter aura + short trailing arc | normal committed hit |
| heavy | full | overcharged glow + warning pulse | big payoff, big whiff cost |

Suggested implementation:

- small emissive sphere or ring near tip/body
- a short transparent arc/ghost trail showing swing path
- optional point light only on heavy charge, capped intensity

This gives the player a reason to fear a held `J`.

## 4.2 Make heavy hits event-classed, not just “more damage”

Add an impact class to `DamageEvent`:

```ts
type ImpactClass = 'passive' | 'quick' | 'ready' | 'heavy' | 'heavy-clean' | 'blocked' | 'glancing';
```

Or derive it in `hit-feedback.ts` from:

- `source`
- `chargeTier`
- `blocked`
- `glancing`
- `amount`
- `knockbackScale`

For `heavy-clean`:

- splash text: `KRAK!`, `BOOM!`, or `MEATSHOT!`
- hitstop: `0.045–0.07s`
- camera shake: `0.55–0.8`
- shockwave ring at impact point
- victim launch multiplier: `2.3–3.0×` current ready hit
- extra meat chunk burst
- maybe a one-frame exposure/white flash

In `src/physics/damage.ts`, current heavy launch uses:

```ts
chargeLaunch = heavy ? 1.7 : ready ? 1.22 : 0.9;
```

Try:

```ts
chargeLaunch =
  event.chargeTier === 'heavy' && !event.glancing && !event.blocked ? 2.65 :
  event.chargeTier === 'heavy' ? 1.85 :
  event.chargeTier === 'ready' ? 1.22 :
  0.9;
```

Also raise active heavy feedback rather than baseline damage only. The player should feel the launch even if health damage is not huge.

## 4.3 Add whiff punishment after commit resolution

Currently stamina cost is paid on commit. That makes hits and misses feel too similar. Change the contract:

- commit always pays base cost
- confirmed hit pays no extra cost or may refund a small amount
- missed charged hit pays a large whiff tax
- heavy miss can drain stamina to near zero

In `AttackController`, during `COMMIT` expiration:

```ts
if (!this.hitRegisteredThisCommit) {
  this.pendingMiss = true;
  this.applyWhiffPenalty(stamina);
}
```

Suggested whiff penalties:

```ts
quick miss:  +4 stamina
ready miss:  +14 stamina
heavy miss:  set stamina to min(current, 8) or subtract 45
```

This creates the boxing feeling: a loaded punch that misses empties you and prevents immediate re-windup.

Also expose miss feedback:

- sound: already exists
- text: `WHIFF!` for ready/heavy misses only
- animation: slight over-rotation / stumble impulse for heavy miss

## 4.4 The arm is too short; add explicit weapon tips

The current arm is a short capsule chain. Even if it mechanically hits, it does not read like a weapon.

Jam-safe fix: add a visible and/or physical **weapon tip** per attack profile.

- blunt: meaty fist/club attached near elbow tip
- spike: small point/horn tip
- shield: broad front pad/plate
- quadruped: head/horn/front shield, not under-belly legs

This does not require full Gene Lab sculpting. Add authored auxiliary bodies or visual-only meshes now, then let Workshop V2 scale them.

For gameplay honesty, prefer physical bodies eventually:

```ts
weapon_tip_r
weapon_tip_l
head_horn
shield_pad
```

But if time is tight, use a visual tip + intentional-hit range for V1, then physical body for V2.

---

## 5. Severance contract fix

## 5.1 Rule

A detached limb must never be driven by motors, attack state, visual rig, or active-hit logic.

If the primary attack appendage is gone:

- cancel current attack immediately
- mark primary attack as disabled or degraded
- display `DISARMED!` once
- optional: swap to backup attack if authored

## 5.2 Implementation

Add attachment queries to `BeastInstance`:

```ts
isSegmentAttached(name: string): boolean
areSegmentsAttached(names: string[]): boolean
```

Simplest path: after `processSeverance()` returns events, call:

```ts
s.beast.markSegmentDetached(s.segment)
```

Maintain a local `detachedSegments = new Set<string>()` inside `BeastInstance`. Do not force `BeastInstance` to know about `DamageResolver` internals.

In `BeastInstance.syncFromPhysics()`:

- always sync detached meshes directly from physics
- never pass detached meshes through `applyAttackVisualPose()` or custom rigs

In `AttackController` or `BeastInstance.applyInput()`:

```ts
const required = new Set([
  slot.appendageRoot,
  ...slot.drivenJoints,
  ...(slot.activeBodies ?? slot.hitSegments),
]);

if (!beast.areSegmentsAttached([...required])) {
  attackController.cancelAndDisableUntilRestored();
}
```

In `DamageResolver.tryResolveIntentionalHit()`:

- ignore active bodies that are detached
- spike tips must fail if `tipSegment` detached

## 5.3 Fix mass after severance

Current locomotion mass uses `skeleton.allBodies`, so severed limbs still count as creature mass. That contradicts the design.

Add an attached-body mass API:

```ts
beast.getAttachedMass(): number
```

Then change biped/quad locomotion to use attached mass when available instead of raw skeleton mass.

This matters for:

- stamina regen
- movement force
- turn torque
- jump impulse
- perceived “losing mass” gameplay

---

## 6. Workshop V2: thin but actually meaningful

Current workshop is useful as UI scaffolding but not as a game feature. It clones templates and tweaks multipliers. That is why all custom beasts feel same-ish.

Do **not** build full SDF sculpting yet. Build a **combat contract workshop**.

## 6.1 New knobs to expose

Add exactly these:

### Body

- archetype: biped / quadruped
- weight class: light / middle / heavy / superheavy
- body size: small / normal / chonk
- stability bias: wobbly / balanced / stable

### Weapon

- weapon type: hammer / spike / shield / headbutt
- weapon socket: right arm / left arm / head/front / forebody
- weapon length: short / medium / long
- weapon mass: light / normal / heavy
- charge style: quick / balanced / heavy

### Visual

- color preset
- eye style or tiny cosmetic tag if time permits

## 6.2 Every knob must alter real data

Examples:

| Knob | Must change |
|---|---|
| weight class | torso mass, limb mass, stamina regen/cost, knockback resistance |
| body size | collider dimensions, visual scale, maybe total HP |
| stability bias | support/upright multiplier or foot size/friction |
| weapon length | visual and active-hit reach / tip offset |
| weapon mass | attack windup/recover time, stamina cost, damage/knockback |
| charge style | windup time, max charge, whiff tax, heavy payoff |

The workshop needs visible stat bars:

- speed
- stability
- reach
- damage
- stamina economy
- control difficulty

Do not show fake stats. If a stat does not connect to code, do not show it.

## 6.3 Quadruped attack fix

Stop presenting quadrupeds as if they “punch.” They do not read that way.

Quadruped defaults should be:

- **headbutt** — visible front-body dip, then head/chest ram
- **shield shove** — brace wide, front pad blocks, then shove
- later: **horn spike** — precision front spike

Stomper’s current attack is semantically a forequarters shove, but it still reads like invisible under-belly leg motion. Give it a visible head/front weapon.

---

## 7. Multiplayer PRD addition — replace/extend PRD §8

## 7.1 Goal

Ship a **1v1 online fight** that works across two browser tabs/machines using match codes, without login.

Non-goals for V1:

- rollback netcode
- deterministic lockstep
- ranked matchmaking
- persistent accounts
- reconnect/resume
- authoritative anti-cheat
- full spectator scaling

The goal is to impress quickly: “send friend a code, bash meat together.”

## 7.2 Architecture

Use **host-authoritative physics**.

- P1 creates a room and becomes `host`.
- P2 joins as `guest`.
- Bun WebSocket server relays messages and manages room membership.
- Host simulates both beasts.
- Guest sends input frames to host through server.
- Host sends state snapshots to guest and spectators.
- Guest renders snapshots with interpolation. Guest does not decide damage/winner.

Why host-authoritative instead of server physics:

- fastest to ship
- server stays simple
- no need to run Rapier headlessly on the server this week
- host already has working local simulation

Known downside: guest control feels network-latency delayed. Accept for jam V1, reduce pain with low snapshot delay and combat brace forgiveness.

## 7.3 Files to add

```txt
server/index.ts                  # Bun WS room server
src/network/protocol.ts          # shared message types
src/network/ws-client.ts         # browser WS wrapper
src/network/network-match.ts     # host/guest match adapter
src/network/snapshot-interp.ts   # remote body interpolation
```

Update:

```txt
src/main.ts
src/ui/home-screen.ts
src/ui/game-shell.ts
src/combat/match.ts
src/beast/beast-data.ts
src/beast/workshop.ts
```

## 7.4 Room lifecycle

### Host flow

1. Player selects beast.
2. Clicks `HOST MATCH`.
3. Client connects WS and sends `create_room`.
4. Server returns `room_created` with code `MEAT-XXXX`.
5. Host sends selected beast definition.
6. Host waits in lobby.
7. Guest joins and sends selected beast definition.
8. Host receives guest beast, spawns both, starts countdown.
9. Host simulates match and broadcasts snapshots.
10. Host sends final result.

### Guest flow

1. Player selects beast.
2. Enters match code and clicks `JOIN`.
3. Client sends `join_room` with code.
4. Server confirms room and forwards guest beast to host.
5. Guest waits for `match_start` and host snapshots.
6. Guest sends input every fixed frame or at 30–60 Hz.
7. Guest renders authoritative snapshots.

## 7.5 Protocol

Use JSON for V1. Payloads are small enough: two beasts × roughly 10–14 bodies × transforms at 30 Hz is acceptable for jam.

### Client → Server

```ts
type ClientMessage =
  | Hello
  | CreateRoom
  | JoinRoom
  | LeaveRoom
  | BeastSelect
  | PlayerReady
  | InputFrame
  | HostSnapshot
  | MatchEvent
  | Ping;
```

### Server → Client

```ts
type ServerMessage =
  | Welcome
  | RoomCreated
  | RoomJoined
  | PeerJoined
  | PeerLeft
  | BeastSelected
  | MatchStart
  | InputFrame
  | HostSnapshot
  | MatchEvent
  | ErrorMessage
  | Pong;
```

### Message shapes

```ts
interface Hello {
  type: 'hello';
  clientId: string;       // localStorage UUID
  protocolVersion: 1;
}

interface CreateRoom {
  type: 'create_room';
  beast: SerializedBeast;
}

interface RoomCreated {
  type: 'room_created';
  roomCode: string;       // MEAT-XXXX
  role: 'host';
}

interface JoinRoom {
  type: 'join_room';
  roomCode: string;
  beast: SerializedBeast;
}

interface RoomJoined {
  type: 'room_joined';
  roomCode: string;
  role: 'guest';
  hostBeast: SerializedBeast;
}

interface PeerJoined {
  type: 'peer_joined';
  peerId: string;
  beast: SerializedBeast;
}

interface PlayerReady {
  type: 'ready';
  ready: boolean;
}

interface MatchStart {
  type: 'match_start';
  seed: number;
  startAtServerTime: number;
  hostBeast: SerializedBeast;
  guestBeast: SerializedBeast;
}

interface InputFrame {
  type: 'input_frame';
  player: 'host' | 'guest';
  frame: number;
  keys: string[];          // e.g. ['W', 'J']
  edges?: {
    pressed: string[];
    released: string[];
  };
}

interface HostSnapshot {
  type: 'host_snapshot';
  frame: number;
  serverTime: number;
  match: {
    phase: 'COUNTDOWN' | 'FIGHTING' | 'ENDED';
    timer: number;
    result?: 'host' | 'guest' | 'draw';
  };
  beasts: SerializedBeastState[];
  events: SerializedMatchEvent[];
}
```

### Beast state snapshot

Use segment names, not numeric body IDs. Segment order is too easy to break when workshop knobs add/remove appendages.

```ts
interface SerializedBeastState {
  player: 'host' | 'guest';
  stamina: number;       // 0..1
  mass: number;          // 0..1
  attack: {
    state: 'IDLE' | 'WINDUP' | 'HELD' | 'COMMIT' | 'RECOVER';
    chargeNorm: number;
    chargeTier: 'quick' | 'ready' | 'heavy';
  };
  segments: Array<{
    name: string;
    attached: boolean;
    hp?: number;
    pos: [number, number, number];
    rot: [number, number, number, number];
    linvel?: [number, number, number];
    angvel?: [number, number, number];
  }>;
}
```

### Match event snapshot

```ts
type SerializedMatchEvent =
  | {
      type: 'damage';
      victim: 'host' | 'guest';
      attacker?: 'host' | 'guest';
      segment: string;
      amount: number;
      source: 'passive' | 'active';
      profile?: 'blunt' | 'spike' | 'shield';
      chargeTier?: 'quick' | 'ready' | 'heavy';
      splashText: string;
      point: [number, number, number];
      shake: number;
    }
  | {
      type: 'severance';
      beast: 'host' | 'guest';
      segment: string;
      point: [number, number, number];
    }
  | {
      type: 'audio';
      name: string;
      point?: [number, number, number];
    };
```

## 7.6 Server behavior

The server is dumb but strict.

Responsibilities:

- assign room code
- track host/guest/spectators
- relay guest input to host
- relay host snapshots to guest/spectators
- drop invalid/oversized payloads
- expire empty rooms
- ping/pong heartbeat

Room limits:

```ts
maxPlayers = 2
maxSpectators = 16 // optional V1, can set 0 initially
roomTtlEmpty = 30 seconds
roomTtlWaiting = 10 minutes
maxMessageBytes = 64_000
inputRateLimit = 90/sec
snapshotRateLimit = 40/sec
```

No server-side trust beyond room structure. Host can cheat. That is acceptable for jam V1.

## 7.7 Client host adapter

Host owns the real simulation.

Host does:

- spawn both beasts locally
- map local keyboard to host beast
- map incoming guest `InputFrame` to guest beast input override
- run physics/damage/match as now
- serialize snapshots at 30 Hz
- send snapshots to server

Guest input handling on host:

- buffer by frame
- use latest input if the next frame is missing
- if input stale for > 250 ms, release movement and attack keys

## 7.8 Client guest adapter

Guest does not run authoritative damage.

Guest does:

- send local input frames to host through server
- receive `HostSnapshot`
- interpolate rendered bodies with a small delay, e.g. 100 ms
- render HUD from host snapshot
- play events from host snapshot once

For V1, guest may still run local physics arena for visuals, but remote beast body transforms should be set from snapshots, not simulated.

Simplest implementation path:

- create a `RemoteBeastView` that uses the same `BeastInstance` visuals but not live locomotion
- or spawn normal BeastInstances, then set their rigid body transforms from snapshots and do not call `applyInput()` on guest

## 7.9 Spectators

Spectator mode is optional after player 1v1 works.

If added:

- spectator joins `watch_room`
- receives host snapshots at 10–15 Hz
- interpolates with larger delay, e.g. 200 ms
- no input messages
- free camera or locked camera

## 7.10 UI changes

Home left panel should have:

- `BASH BOT`
- `HOST MATCH`
- `JOIN MATCH` code input + button

Current “Join Match” UI exists but routes to a deferred branch in `main.ts`. Wire it.

Lobby panel:

- show room code large
- copy code button
- selected beast cards for host/guest
- ready states
- start automatically once both ready for V1

## 7.11 Acceptance criteria for Multiplayer V1

Must pass:

- Two tabs can connect to one room by code.
- Host and guest each control their own beast.
- Host sees guest input affect guest beast.
- Guest sees both beasts moving from host snapshots.
- Active attacks, damage, severance, stamina, mass, and result sync to guest.
- Bot mode still works unchanged.
- A full 3-minute online match does not crash the server.
- If guest disconnects, host returns to lobby or gets a clean “peer left” message.

Do not ship spectator until this is true.

---

## 8. Concrete next sprint checklist

## Day 1 — stop lying to the player

- [ ] Apply spawn yaw; verify match starts face-to-face.
- [ ] Add combat target references and `J`-held brace aim assist.
- [ ] Lower turn volatility preset.
- [ ] Re-enable appendage-local charge telegraph.
- [ ] Add heavy charge band visual.
- [ ] Add whiff stamina penalty.

## Day 2 — make hits feel like hits

- [ ] Add heavy-clean impact class.
- [ ] Add shockwave / flash / bigger chunk burst for heavy-clean hits.
- [ ] Increase heavy-clean launch.
- [ ] Add visible weapon tips for Chonkus/Noodlesnake.
- [ ] Re-author Stomper/Butterchonk as headbutt/front-shield attacks, not hidden leg punches.

## Day 3 — severance and workshop truth

- [ ] Add detached segment tracking to `BeastInstance`.
- [ ] Attack slots disable/degrade if required segments detach.
- [ ] Custom attack visual rigs skip detached segments.
- [ ] Locomotion mass excludes detached segments.
- [ ] Workshop V2 adds weight/body/weapon length/weapon mass/stability knobs.
- [ ] Stat bars show real derived values.

## Day 4 — multiplayer skeleton

- [ ] Add shared protocol types.
- [ ] Implement Bun WS room server.
- [ ] Wire host match button and join flow.
- [ ] Host/guest beast exchange.
- [ ] Guest input relayed to host.

## Day 5 — multiplayer state sync

- [ ] Host snapshots at 30 Hz.
- [ ] Guest interpolation.
- [ ] Damage/severance/audio event sync.
- [ ] Match result sync.
- [ ] Run two-tab 3-minute soak test.

---

## 9. Kill list

Do not spend time on these before the above works:

- wings
- full SDF sculpting
- certification polish
- more archetypes
- rollback netcode
- mesh BVH combat collision
- ranked matchmaking
- account storage
- geometry-derived spike/shield detection

---

## 10. Highest-risk decisions

### Risk: movement still feels unlearnable after yaw/brace tuning

Fallback: make `J` brace mode stronger and frame it as “aim stance.” Movement can stay goofy; attack setup must be reliable.

### Risk: guest multiplayer feels laggy

Fallback: present online as “experimental meatlink,” keep bot as primary polish path. For jam judging, working online is more valuable than perfect online.

### Risk: workshop still feels cosmetic

Fallback: drop color and focus on weapon type + length + mass. Gameplay differentiation beats palette differentiation.

### Risk: severance breaks attacks too often

Fallback: every beast gets a fallback `body_bash` after losing weapon appendage. It is weak but prevents “I am helpless now” unless that is intentionally a KO state.

---

## 11. The actual product line now

MEATBASH is not “build any monster and hope physics happens.”

It is:

> Build a stupid meat weapon, pilot it badly, telegraph a dumb oversized hit, either land a glorious meat boom or whiff and collapse in shame.

Everything next should reinforce that sentence.
