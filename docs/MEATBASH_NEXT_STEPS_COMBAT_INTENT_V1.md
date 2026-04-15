# MEATBASH — What To Do Next

**Date:** 2026-04-15  
**Status:** Movement exists. Damage exists. Arena contact honesty exists. The next problem is not locomotion polish in isolation — it is **combat intent** and **combat readability**.

---

## 1. Executive decision

The next milestone is:

> A player can intentionally raise an appendage, strike with it on purpose, understand whether the hit connected, and immediately see why it mattered.

Until that exists, more movement experiments, wings, certification, and a large Gene Lab are mostly scope theater.

The correct order now is:

1. **Intentional attacks**
2. **Attack-aware damage**
3. **Hit feedback and readability**
4. **Beast cards / archetype communication**
5. **Minimal gene-lab hooks for attack identity**
6. **Only then** revisit locomotion feel again if it still blocks fun

---

## 2. Current state snapshot

What is already good enough to build on:

- clumsy locomotion exists
- beasts can stand on slanted terrain
- rocks collide honestly enough to matter
- jump exists
- damage from collisions exists
- biped and quadruped both exist
- arms now add silhouette and combat potential
- intro screen / shell exists

What is still missing from the actual game loop:

- **reliable player agency in dealing damage**
- **clear telegraph before danger**
- **clear payoff after a successful hit**
- **clear differentiation between beasts before the match starts**
- **clear combat roles for appendage shapes**

Right now the funniest moments are still mostly accidental. That is not enough. The game needs **intentional slapstick**.

---

## 3. Hard scope cuts for this phase

Do **not** build these before Combat Intent V1 is playable:

- wings / flapping mobility
- geometry-derived spike detection from arbitrary mesh shape
- Darwin certification polish
- full freeform gene lab
- new locomotion control schemes as the default input model

Reason: all of them widen the surface area while the core fight loop is still not readable.

---

## 4. The next playable milestone

### Combat Intent V1 — definition of done

A player should be able to:

- approach an enemy
- raise a known attack appendage
- hold it briefly to telegraph / charge
- either cancel safely or commit to a strike
- land an intentional hit on a dummy or bot
- immediately get strong feedback: pose, glow, shake, impact text, meat loss

A spectator should be able to tell:

- which beast is light or heavy
- what the beast’s attack profile is
- when a strike is charging
- whether a hit was weak, strong, blocked, glancing, or penetrating

---

## 5. System 1 — attack slots

### Goal

Every beast gets at least **one primary attack slot**.

That slot answers four questions:

- which appendage is the weapon
- what pose does it use for windup / strike / recovery
- what profile does it have mechanically
- what stamina and damage budget does it consume

### Why this matters

Right now damage is mostly “physics happened.”

Attack slots turn it into:

- **I raised my arm**
- **I committed to a swing**
- **I hit with a blunt/shield/spike profile**
- **the other beast lost meat because of that decision**

### Required file changes

Add or modify:

- `src/beast/beast-data.ts`
- `src/beast/premades.ts`
- `src/beast/beast-instance.ts`
- `src/combat/attack-controller.ts` **new**
- `src/combat/attack-profiles.ts` **new**
- `src/combat/attack-types.ts` **new optional**
- `src/combat/bot-ai.ts`
- `src/physics/damage.ts`

### Data model

Add this to beast definitions:

```ts
type AttackProfile = 'blunt' | 'spike' | 'shield';
type AttackState = 'IDLE' | 'WINDUP' | 'HELD' | 'COMMIT' | 'RECOVER';

interface AttackSlotDefinition {
  id: 'primary';
  appendageRoot: string;       // e.g. shoulder_r, head, hip_fl_pair
  drivenJoints: string[];      // joints whose targets get overridden
  hitSegments: string[];       // colliders that count as active weapon bodies
  profile: AttackProfile;

  windupPose: Record<string, number>;
  strikePose: Record<string, number>;
  recoverPose: Record<string, number>;

  windupTime: number;
  recoverTime: number;
  minHoldForCharge: number;
  maxChargeTime: number;

  holdDrainPerSec: number;
  strikeCostLight: number;
  strikeCostHeavy: number;

  damageMulLight: number;
  damageMulHeavy: number;
  knockbackMul: number;

  rootLungeForward: number;
  rootLungeUp: number;
  rootYawAssist: number;
}
```

Then extend `BeastDefinition`:

```ts
interface BeastDefinition {
  // existing fields...
  attackSlots?: AttackSlotDefinition[];
  weightClassHint?: 'light' | 'middle' | 'heavy' | 'superheavy';
}
```

### First-pass control scheme

Use one simple two-button system:

- `J` = raise / hold
- release `J` = cancel
- `K` while raised = strike

Rules:

- tapping `J` briefly should still raise the appendage
- holding `J` drains stamina slowly
- releasing `J` without striking cancels and starts recovery immediately
- pressing `K` during `WINDUP` or `HELD` commits to the strike
- strike spends a chunk of stamina
- once in `COMMIT`, the player cannot cancel
- once in `RECOVER`, locomotion is reduced until recovery ends

If you want to keep this future-proof for player remapping, name the actions internally:

- `attack_raise_primary`
- `attack_commit_primary`

Do **not** hardwire future design around `J/K`, but use them now for the jam.

### Attack state machine

Each slot runs this:

```ts
IDLE -> WINDUP -> HELD -> COMMIT -> RECOVER -> IDLE
```

Behavior:

#### `IDLE`
- no pose override
- no stamina drain
- no active hit window
- stamina may regenerate normally

#### `WINDUP`
- move appendage toward windup pose
- reduced movement / reduced turn torque
- start telegraph visuals
- no hitbox yet
- player can still cancel by releasing raise

#### `HELD`
- appendage stays cocked
- telegraph intensifies
- holding drains stamina per second
- movement is slowed further
- player may cancel or commit

#### `COMMIT`
- strike pose + root lunge fire
- active hit window opens for a short span
- strike cost paid once at commit
- no cancel
- locomotion stability penalty applies briefly

#### `RECOVER`
- appendage returns to neutral
- active hit window is closed
- movement and turning are partially reduced
- stamina regen can restart at a reduced rate, then full rate when back to `IDLE`

### Charge behavior

Your glow idea is good, but make the telegraph be **pose first, glow second**.

Why:

- glow is readable
- pose is more honest and more funny
- pose works even if effects are low-fi or disabled

Recommended charge model for the jam build:

- **quick hit**: hold under `0.18s`
- **ready hit**: hold `0.18s–0.55s`
- **heavy hit**: hold `0.55s+`, capped at `0.9s`

Do not make charge infinite. That encourages dumb turtling.

Charge affects:

- damage multiplier
- root lunge magnitude
- knockback
- splash text size/intensity
- screen shake intensity
- stamina cost

Do **not** make charge affect hit window length too much. Heavy attacks should be stronger, not magically easier to land.

---

## 6. System 2 — attack profiles

### Goal

Do not infer combat semantics from freeform geometry yet. Use explicit profiles.

Profiles are:

- `blunt`
- `spike`
- `shield`

### Why explicit profiles win right now

Trying to derive “this mesh is pointy” from arbitrary gene-lab sculpted blobs is a time sink and a debugging trap.

The right move is:

- **shape is visual**
- **profile is gameplay**

Later, the gene lab can let the player choose profile and then style the appendage visually to match.

### Profile behaviors

#### Blunt
Use for hammer arms, fists, forelimb smacks, headbutts.

Properties:

- wide hit validity
- strong knockback
- medium flesh damage
- good on body hits
- poor vs raised shield
- forgiving to use

Damage identity:

- high impulse
- medium penetration
- bigger victim stumble

#### Spike
Use for horns, stingers, beaks, tusks, tip weapons.

Properties:

- small valid hit region
- higher flesh damage if the **tip** connects cleanly
- lower broad knockback
- poor if impact angle is bad
- can self-punish against shield / armor if desired later

Damage identity:

- high precision reward
- low forgiveness
- best on direct line-up attacks

Jam-safe spike rule:

- require contact on a marked “tip” segment or tip point
- require relative velocity to align reasonably with appendage forward vector

That is enough. Do not build arbitrary mesh-pointiness detection.

#### Shield
Use for plate forelimbs, broad chitin slab, shell-smack, ram plate.

Properties:

- while raised, reduces frontal incoming damage
- strike does low flesh damage
- strike does strong shove / destabilize
- best for opening enemy balance rather than chunking meat

Damage identity:

- low raw damage
- high control / disruption
- readable defensive posture

### First-pass balance defaults

Use these as rough starting points, not gospel:

```ts
const ATTACK_PROFILES = {
  blunt: {
    activeWindow: 0.16,
    blockReduction: 0.15,
    damageMul: 1.0,
    knockbackMul: 1.2,
    precisionBias: 0.0,
  },
  spike: {
    activeWindow: 0.10,
    blockReduction: 0.05,
    damageMul: 1.25,
    knockbackMul: 0.8,
    precisionBias: 1.0,
  },
  shield: {
    activeWindow: 0.14,
    blockReduction: 0.50,
    damageMul: 0.65,
    knockbackMul: 1.4,
    precisionBias: -0.2,
  },
};
```

---

## 7. System 3 — attack-aware damage

### Goal

Passive collisions remain funny, but active strikes must matter more than random bumping.

### Required changes

Modify `src/physics/damage.ts` so the damage resolver understands:

- whether the attacking collider belongs to an active attack slot
- which attack profile is active
- whether the contact happened during the active hit window
- whether the attack was quick / ready / heavy

### New damage split

Use two channels:

#### Passive collision damage
Keep it, but lower its importance.

Use it for:

- accidental body slams
- rock collisions
- stumble comedy
- environmental punishment

It should still contribute, but not dominate the fight.

#### Active strike damage
Use it when:

- attack state is `COMMIT`
- collider is part of `hitSegments`
- active window is open
- target is not same beast

This should apply:

- stronger damage multiplier
- stronger knockback / impulse
- optional extra instability to victim
- more feedback

### First-pass formula

Keep it simple:

```ts
passiveDamage = baseCollisionDamage * passiveMul;

activeDamage = baseCollisionDamage
  * profile.damageMul
  * chargeDamageMul
  * appendageMassMul
  * hitQualityMul;
```

Where:

- `chargeDamageMul` = 0.85 / 1.0 / 1.35 for quick / ready / heavy
- `appendageMassMul` depends on the mass of the attack appendage
- `hitQualityMul` rewards clean spike-tip alignment or broad blunt impact

### Mass-based appendage tuning

This is where the gene lab starts to matter.

Calculate:

```ts
appendageMass = sum(mass of all hitSegments)
```

Then scale:

- heavy appendage -> slower windup, more stamina cost, more impact
- light appendage -> faster windup, lower cost, less broad power

Recommended first-pass rules:

```ts
holdDrainPerSec *= sqrt(appendageMass / baselineMass)
strikeCost *= appendageMass / baselineMass
recoverTime *= lerp(0.85, 1.4, normalizedAppendageMass)
damageMul *= lerp(0.9, 1.25, normalizedAppendageMass)
```

This gives real identity without complicated authoring.

---

## 8. System 4 — combat feedback and payoff

### Goal

The player needs immediate proof that their decision worked.

Right now you are thinking in systems. The player feels moments.

This phase needs those moments.

### 8.1 Hit confirm stack

On a meaningful active hit, trigger:

1. **very short hitstop**
2. **screen shake**
3. **impact splash text**
4. **meat chunks / splatter**
5. **victim flash / wound pulse**
6. **HUD mass tick-down**

Do not ship attacks without this stack. They will feel limp.

### 8.2 Splash text rules

Use world-anchored or target-anchored text near the hit, not generic center-screen spam.

Allowed events:

- `BONK!` for blunt
- `STAB!` for spike clean hit
- `BASH!` or `SHOVE!` for shield hit
- `BLOCK!` when raised shield absorbs the strike
- `GLANCE!` for weak or poor-angle contact
- `CRUNCH!` for heavy hit / major meat loss

Do not over-randomize this. Consistency teaches the player the rules.

### 8.3 Screen shake

Add a small configurable camera shake method now.

Suggested levels:

- passive collision: `0.05–0.10`
- quick strike: `0.12`
- ready strike: `0.20`
- heavy strike: `0.30`
- shield shove: horizontal-biased shake

Shake should be short, punchy, and decaying. Do not make the whole game nauseating.

### 8.4 Telegraph visuals

Your charge-glow idea is good as the **secondary** telegraph.

Use this stack:

- appendage visibly raises into a readable windup pose
- emissive pulse or outline grows while charging
- optional subtle “meat hum” or charge audio
- at heavy charge, appendage glow should be unmistakable

Make charge visually cap at max charge so the player knows “you are fully loaded.”

### Required file changes

- `src/engine/camera.ts` — add shake API
- `src/ui/match-hud.ts` — add transient combat text / readiness states
- `src/particles/meat-chunks.ts` — hook attack hits into existing particles
- `src/audio/audio-manager.ts` — optional stubs for hit cues
- `src/combat/hit-feedback.ts` **new**

---

## 9. System 5 — beast cards and pre-fight readability

### Goal

Before the fight starts, the player should know:

- what this beast basically does
- how heavy it is
- what its primary attack profile is

### Beast card fields

Update beast cards to show:

- name
- archetype
- weight class
- primary attack profile
- one-line playstyle summary

Example:

- `CHONKUS` — BIPED — HEAVY — BLUNT
  - “Slow tank with big punish arm.”

- `STOMPER` — QUADRUPED — HEAVY — SHIELD
  - “Stable shover. Wins by balance breaks.”

### Weight class

Use only a few classes:

- `LIGHT`
- `MIDDLE`
- `HEAVY`
- `SUPERHEAVY` if needed later

If your mass ranges are still unstable, show both:

- class label
- actual mass in kg or arbitrary mass units

### Required file changes

- `src/beast/beast-data.ts`
- `src/beast/premades.ts`
- `src/ui/home-screen.ts`

---

## 10. System 6 — bot combat intent

### Goal

The bot must at least demonstrate the attack loop so the player can test against something purposeful.

### Bot rules for V1

When near opponent:

- if not roughly facing target -> turn toward target
- if target is in front arc and within approach range -> press raise
- if target stays in range during hold -> commit strike
- if target leaves range or bot loses balance -> cancel or abandon
- if stamina is low -> back off / idle briefly

This is enough. Do not build genius AI.

### Bot behavioral states

Use something this small:

```ts
type BotState = 'APPROACH' | 'WINDUP' | 'COMMIT' | 'RECOVER' | 'PANIC';
```

The bot should occasionally screw up. That is on-brand.

### Required file changes

- `src/combat/bot-ai.ts`
- maybe `src/combat/match.ts` if state hook-up is needed

---

## 11. Minimal gene-lab hooks for later

Do **not** build the full lab now.

But make sure the combat system is authored in a way the future lab can plug into.

### The lab only needs to be able to decide these later:

- which appendage is primary attack slot
- which profile it uses: blunt / spike / shield
- rough appendage scale / mass bias
- optional charge bias or stamina bias

### That means today’s definitions must support:

- appendage identity
- profile selection
- pose selection
- hit segment tagging

If you skip this now and hardcode everything into one-off premades, you will regret it when you start the lab.

---

## 12. Movement: what to do with your new idea

### Your idea

A toggle mode where legs become stiff and movement becomes more like pivot-stepping:

- press one side, raise that side
- rotate/pivot on the other support leg
- move by alternating side pressure, almost like compass-stepping into the opponent
- once near, orient the beast and strike

### Honest assessment

As a **shipping replacement** for the current controller: **no**.

As a **small experimental locomotion branch** to test whether “support-leg readability” feels better than the current hovery wobble: **yes, maybe**.

### Why it is dangerous as the next main task

Because it creates a second locomotion architecture right when the game finally reached “clumsily movable.”

That means:

- more code paths
- more archetype edge cases
- more bot logic branches
- more documentation drift
- delayed combat milestone

And worst of all: it still does not solve the main problem, which is **intentional damage dealing**.

### The useful insight hidden in your idea

The useful part is **not** the player-facing A-D-A-D control scheme.

The useful part is this:

> locomotion becomes more readable when the game clearly knows which limb group is the support set and which is the swing set.

That insight does generalize.

### How it generalizes across archetypes

Internal support groups can work like this:

- **biped:** left support / right support
- **quadruped:** diagonal pair A / diagonal pair B
- **hexapod:** tripod A / tripod B
- **octoped:** quad group A / quad group B

So if you want to test this concept, make it an **internal gait experiment**, not a second player-facing control religion.

### Recommendation

Do **not** replace WASD now.

If you insist on testing the idea, do it behind a debug toggle:

```ts
locomotionMode: 'autoGait' | 'pivotStepExperiment'
```

Rules for that experiment:

- biped only at first
- no bot support initially
- no doc changes until it proves better
- one evening max
- kill it quickly if it does not obviously improve readability

### What success would look like

The experiment is only worth keeping if all of these improve at once:

- less float / balloon feeling
- easier intentional facing
- no major loss of comedy
- no extra deadlocks on slopes or rocks
- no huge archetype-specific rewrite cost

If it fails even two of those, drop it.

---

## 13. Suggested implementation order

### Day / Block A — intentional combat skeleton

1. add `AttackSlotDefinition` to beast data
2. hardcode one primary slot for Chonkus and one for Stomper
3. build `AttackController`
4. implement `J` raise / `K` strike / release cancel
5. apply pose overrides and root lunge

### Day / Block B — attack-aware damage

1. lower passive collision damage importance
2. mark active hit windows
3. apply profile and charge multipliers
4. add appendage mass scaling
5. add block behavior for raised shield profile

### Day / Block C — feedback/readability

1. hitstop
2. screen shake
3. splash text
4. beast cards with weight + attack type
5. telegraph glow + charge cap state

### Day / Block D — bot and balancing

1. bot uses raise / commit loop
2. test all premades for readability
3. tune stamina drain and recovery
4. tune heavy-vs-light attack feel

---

## 14. Concrete starting presets

These are not final balance values. They are sensible first passes.

### Chonkus

- archetype: biped
- primary profile: `blunt`
- appendage: right arm
- windup: large side-cocked arm
- charge: slow
- strike: high root lunge + high knockback
- hold drain: medium-high
- strike cost: high
- recovery: medium-slow

Identity:

- punishes hard
- obvious telegraph
- easy to understand
- great for the first demo

### Stomper

- archetype: quadruped
- primary profile: `shield`
- appendage: front body / front pair slam
- windup: forebody raises / braces
- strike: shove / destabilize
- hold drain: medium
- strike cost: medium
- recovery: fast-medium

Identity:

- lower raw damage
- better at ruining enemy balance
- readable as a stable bully

### Noodlesnake

- archetype: biped
- primary profile: `spike` or light `blunt`
- appendage: lighter arm / head peck
- fast windup
- fast recovery
- lower damage unless clean hit

Identity:

- high activity
- low certainty
- funny but skill-rewarding

---

## 15. Acceptance criteria

This phase is done only when all of these are true:

### Player readability

- a new player can land a deliberate hit on a dummy in under **15 seconds**
- a new player can explain what Chonkus’s attack does after one round
- a spectator can identify `blunt`, `spike`, and `shield` behavior without reading docs

### Gameplay

- passive bump damage still exists but no longer dominates all outcomes
- holding charge has a meaningful stamina tradeoff
- canceling charge feels safe and readable
- heavy charge is visibly different from quick strike
- bot occasionally uses the full raise → strike loop

### Presentation

- active hits create visible payoff
- beast cards show weight class and attack profile
- telegraph is readable from gameplay camera
- screen shake is strong enough to feel, weak enough not to annoy

---

## 16. Documentation cleanup required now

Your docs are drifting. Fix that before the project lies to you again.

### Problems

#### `docs/MEATBASH_PRD.md` is no longer a trustworthy source of truth for controls
It still contains old or conflicting control language in multiple sections:

- Q/W locomotion references still exist
- wings still read like a core feature instead of a cut / maybe-later feature
- certification still reads more central than it currently is
- locomotion section still talks in older torque language rather than the real active-ragdoll + WASD state-machine setup

#### `docs/TASKS.md` and `code/TASKS.md` are duplicated and already drifting
You have two task backlogs.
That is stupid. Keep one.

#### `docs/CLAUDE_CONTEXT.md` and `code/CLAUDE.md` are duplicated and drifting
Again: one canonical agent-context doc, not two almost-the-same files.

#### `docs/Phase2.md` is effectively a historical snapshot, not a current plan
That is fine if you treat it as archive.
It is not fine if people treat it as the active roadmap.

### What to do

#### Keep these as canonical

- `docs/MEATBASH_PRD.md` = product vision + long-term design
- `docs/TASKS.md` = current backlog / execution order
- `docs/CLAUDE_CONTEXT.md` = current agent context

#### Treat these as mirrors or kill them

- `code/TASKS.md` -> delete or autogenerate from `docs/TASKS.md`
- `code/CLAUDE.md` -> delete or replace with a 3-line pointer to `docs/CLAUDE_CONTEXT.md`

#### Update PRD sections now

At minimum, update:

- elevator pitch to emphasize **WASD active-ragdoll arena combat** and **intentional attack slots**
- controls / key-binding section
- locomotion section
- premade beasts section to include default attack profiles
- roadmap / phases so Combat Intent V1 is explicit
- wings status: optional / cut-for-now
- certification status: still part of vision, not next immediate priority

#### Add one new doc

Create and maintain:

- `docs/NOW_NEXT_LATER.md`

Suggested content:

- **Now:** Combat Intent V1
- **Next:** Minimal gene lab hooks + networking if combat is readable
- **Later:** certification, extra archetypes, wings, polish

This will save you from using the PRD as a scrum board.

---

## 17. Immediate tasks to assign

### Task A — attack data + controller

**Files:**
- `src/beast/beast-data.ts`
- `src/beast/premades.ts`
- `src/combat/attack-controller.ts`
- `src/beast/beast-instance.ts`

**Deliverable:**
Two beasts can raise/cancel/commit one intentional attack each.

### Task B — attack-aware damage

**Files:**
- `src/physics/damage.ts`
- `src/combat/attack-profiles.ts`

**Deliverable:**
Active attacks matter more than passive body bumps.

### Task C — feedback

**Files:**
- `src/engine/camera.ts`
- `src/ui/match-hud.ts`
- `src/combat/hit-feedback.ts`
- `src/particles/meat-chunks.ts`

**Deliverable:**
Hits feel rewarding and legible.

### Task D — pre-fight readability

**Files:**
- `src/ui/home-screen.ts`
- `src/beast/beast-data.ts`
- `src/beast/premades.ts`

**Deliverable:**
Beast cards show attack type and weight class.

### Task E — doc cleanup

**Files:**
- `docs/MEATBASH_PRD.md`
- `docs/TASKS.md`
- `docs/CLAUDE_CONTEXT.md`
- delete or reduce duplicate mirrors in `code/`

**Deliverable:**
One truthful plan, not five stale ones.

---

## 18. Final call

Do not burn another chunk of time trying to discover the perfect movement preset in a vacuum.

You are close enough on locomotion to make combat the real judge now.

If combat becomes intentional and readable, you will suddenly know which locomotion flaws are actually fatal and which were just annoying during sandbox testing.

Right now the next correct move is not “more motion theory.”
It is:

> **make one intentional attack loop feel good and obvious.**

