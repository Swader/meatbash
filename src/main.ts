import { initRenderer } from './engine/renderer';
import { createScene } from './engine/scene';
import { createCamera } from './engine/camera';
import { InputManager } from './engine/input';
import { GameLoop } from './engine/loop';
import { RapierWorld } from './physics/rapier-world';
import { createPhysicsArena } from './beast/test-beast';
import { AudioManager } from './audio/audio-manager';
import { DebugHud } from './ui/debug-hud';
import { initTuningPanel } from './physics/tuning';
import { GameShell } from './ui/game-shell';
import { HomeScreen } from './ui/home-screen';
import { MatchHud } from './ui/match-hud';
import { MusicCreditWidget } from './ui/music-credit';
import { PREMADE_BEASTS, DEFAULT_BEAST_ID, getPremade } from './beast/premades';
import { toBeastListing, type BeastDefinition } from './beast/beast-data';
import { spawnBeast } from './beast/beast-factory';
import { BotAI } from './combat/bot-ai';
import { MatchController, type MatchResult as CombatResult } from './combat/match';
import { BeastInstance } from './beast/beast-instance';
import { DamageResolver } from './physics/damage';
import { processSeverance } from './physics/severance';
import { MeatChunks } from './particles/meat-chunks';
import { applyHitFeedback } from './combat/hit-feedback';
import { createWorkshopBeast, loadWorkshopBeasts, saveWorkshopBeasts } from './beast/workshop';

async function main() {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const loadingMsg = document.getElementById('loading-msg')!;

  // ---- Core init ----
  const renderer = await initRenderer(canvas);
  const physics = new RapierWorld();
  await physics.init();

  const { scene, arena, updateArena } = createScene();
  const camera = createCamera(canvas);
  const input = new InputManager();
  const audio = new AudioManager();

  createPhysicsArena(physics, arena.rockData);

  let customBeasts: BeastDefinition[] = loadWorkshopBeasts();
  const resolveBeastDefinition = (id: string): BeastDefinition | undefined =>
    customBeasts.find((beast) => beast.id === id) ?? getPremade(id);

  // ---- UI: game shell + screens ----
  const shell = new GameShell();
  const home = new HomeScreen({
    shell,
    defaultBeasts: PREMADE_BEASTS.map(toBeastListing),
    userBeasts: customBeasts.map(toBeastListing),
    onCreateWorkshopBeast: (draft) => {
      const created = createWorkshopBeast(draft);
      customBeasts = [created, ...customBeasts].slice(0, 16);
      saveWorkshopBeasts(customBeasts);
      return toBeastListing(created);
    },
  });
  void home;
  const matchHud = new MatchHud();
  const debugHud = new DebugHud();
  const musicCredit = new MusicCreditWidget();
  const hasInjectedAdvanceTime = typeof (window as any).advanceTime === 'function';

  audio.setMusicContext('menu');

  initTuningPanel();
  loadingMsg.style.display = 'none';

  // ---- Combat systems (persistent across matches) ----
  const damage = new DamageResolver();
  const meatChunks = new MeatChunks(scene);

  // ---- Active match state (reset on each new fight) ----
  let player: BeastInstance | null = null;
  let opponent: BeastInstance | null = null;
  let botAI: BotAI | null = null;
  let match: MatchController | null = null;
  let opponentDef = getPremade('stomper')!;
  let lastDamageEvents: Array<{
    source: string;
    segment: string;
    amount: number;
    profile?: string;
    splashText: string;
    age: number;
  }> = [];

  /**
   * Tear down the currently-running match, if any. Removes both beasts
   * from the scene + physics world and clears the loop's beast list.
   * Safe to call at any time.
   */
  const teardownMatch = () => {
    for (const b of [player, opponent]) {
      if (!b) continue;
      damage.unregister(b);
      scene.remove(b.group);
      for (const body of b.skeleton.allBodies) {
        physics.world.removeRigidBody(body);
      }
    }
    player = null;
    opponent = null;
    botAI = null;
    match = null;
    // Empty the loop's beast list (mutated in place)
    (loop as any).config.beasts.length = 0;
  };

  /**
   * Spawn player + opponent + bot AI + fresh match controller.
   * Called when the player clicks "Make a match" on the home screen.
   */
  const startBotMatch = async (playerBeastId: string) => {
    try {
      await audio.init();
    } catch (err) {
      console.warn('Audio init failed:', err);
    }
    teardownMatch();

    const playerDef = resolveBeastDefinition(playerBeastId) || getPremade(DEFAULT_BEAST_ID)!;

    // Pick an opponent — a different premade than the player's pick
    const candidates = PREMADE_BEASTS.filter((b) => b.id !== playerBeastId);
    opponentDef = candidates[Math.floor(Math.random() * candidates.length)] || PREMADE_BEASTS[1];

    // Spawn facing each other a few meters apart.
    // Each beast gets a unique beastIndex so their collision groups let
    // them collide WITH EACH OTHER but not with their own body parts.
    player = spawnBeast(playerDef, scene, physics, { x: -3, z: 0, beastIndex: 0 });
    opponent = spawnBeast(opponentDef, scene, physics, { x: 3, z: 0, beastIndex: 1 });

    // Register for contact damage tracking
    damage.register(player, physics.rapier, physics.world);
    damage.register(opponent, physics.rapier, physics.world);

    // Bot AI observes the opponent and presses virtual keys
    botAI = new BotAI(() => {
      const sp = opponent!.getPosition();
      const tp = player!.getPosition();
      return {
        selfX: sp.x,
        selfZ: sp.z,
        selfYaw: opponent!.getYaw(),
        selfGrounded: opponent!.isGrounded(),
        targetX: tp.x,
        targetZ: tp.z,
        hasStamina: opponent!.getStaminaFraction() > 0.1,
      };
    });

    // Route the bot's synthetic input through the opponent beast
    opponent.inputOverride = botAI as any;

    // Beasts are frozen during countdown — only start simulating
    // their locomotion when the match enters FIGHTING.
    player.inputActive = false;
    opponent.inputActive = false;

    match = new MatchController({}, (phase) => {
      if (phase === 'ENDED') {
        // Show result for a couple of seconds then let the player restart
      }
    });

    // Register the beasts with the loop so fixedUpdate calls applyInput
    // and the camera follows the first beast (player).
    const beasts = (loop as any).config.beasts as BeastInstance[];
    beasts.length = 0;
    beasts.push(player, opponent);

    shell.transition('ARENA');
  };

  /** Hand the player back to the home screen, discarding the current match. */
  const returnToHome = () => {
    teardownMatch();
    shell.transition('HOME');
  };

  // ---- Register screens with the shell ----
  shell.registerScreen('HOME', {
    setVisible: (v) => home.setVisible(v),
  });
  shell.registerScreen('ARENA', {
    setVisible: (v) => matchHud.setVisible(v),
  });

  // ---- Wire shell callbacks ----
  shell.setCallbacks({
    onStartMatch: (beastId, mode) => {
      if (mode === 'bot') void startBotMatch(beastId);
      // 'join'/'host' deferred to networking block
    },
    onOpenLab: () => {
      // Deferred — Gene Lab block
    },
    onOpenCertification: () => {
      // Deferred — Certification block
    },
    onScreenChanged: (to) => {
      const musicContext =
        to === 'ARENA' ? 'battle' :
        to === 'LAB' ? 'lab' :
        'menu';
      audio.setMusicContext(musicContext);
    },
  });

  // ---- Global keyboard shortcuts: ESC (leave match), R (restart) ----
  window.addEventListener('keydown', (e) => {
    if (shell.getCurrentScreen() !== 'ARENA') return;
    if (e.key === 'Escape') {
      returnToHome();
    } else if (e.key === 'r' || e.key === 'R') {
      if (match?.isEnded() && player) {
        // Restart with the same player beast
        startBotMatch(player.definition?.id || DEFAULT_BEAST_ID);
      }
    }
  });

  // Expose for debugging
  (window as any).__physics = physics;
  (window as any).__shell = shell;
  (window as any).__getPlayer = () => player;
  (window as any).__getOpponent = () => opponent;

  // ---- Game loop ----
  const loop = new GameLoop({
    renderer,
    scene,
    camera,
    physics,
    input,
    // Empty for home screen — when in arena we push both beasts below
    beasts: [],

    // Per-fixed-step: drain contact events into damage, process severance,
    // spawn meat chunks. Must happen AFTER physics.step and BEFORE beast sync.
    onPostPhysics: (dt) => {
      if (!player || !opponent || !match || !match.isFighting()) return;

      damage.processEvents(physics.eventQueue, physics.world, dt);
      damage.processIntentionalHits(player, opponent);
      const events = damage.drainEvents();
      if (events.length > 0) {
        const next = events.map((ev) => ({
          source: ev.source,
          segment: ev.segment,
          amount: Number(ev.amount.toFixed(3)),
          profile: ev.profile,
          splashText: ev.splashText,
          age: 1.25,
        }));
        lastDamageEvents = [...next, ...lastDamageEvents].slice(0, 12);
      }
      for (const ev of events) {
        // Spawn chunk count + speed based on impact quality.
        const srcMul = (ev.source === 'active' ? 1.45 : 1) * ev.feedbackMul;
        const count = Math.min(14, 1 + Math.floor((ev.amount / 3) * srcMul));
        const speed = 2 + ev.impactSpeed * (ev.source === 'active' ? 0.5 : 0.32) * Math.max(0.85, ev.feedbackMul);
        meatChunks.spawn(ev.point, count, speed, undefined, srcMul);
      }
      const hitstop = applyHitFeedback(events, {
        addShake: (intensity, duration, horizontalBias) =>
          loop.addCameraShake(intensity, duration, horizontalBias ?? 0.5),
        pushCombatText: (text) => matchHud.pushCombatText(text),
        playSfx: (name, x, y, z) => audio.playSfx(name, x, y, z),
      });
      if (hitstop > 0) loop.addHitstop(hitstop);

      // Check for severed limbs
      const severed = processSeverance([player, opponent], damage, physics);
      for (const s of severed) {
        meatChunks.spawn(s.position, 12, 4.5);
      }
    },

    onVariableUpdate: (dt) => {
      updateArena(dt);
      meatChunks.update(dt);
      musicCredit.update(audio.getCurrentMusicInfo(), audio.getMusicWaveformBars());
      lastDamageEvents = lastDamageEvents
        .map((ev) => ({ ...ev, age: ev.age - dt }))
        .filter((ev) => ev.age > 0);

      for (const beast of [player, opponent]) {
        if (!beast) continue;
        const pos = beast.getPosition();
        for (const ev of beast.consumeAudioEvents()) {
          audio.playSfx(ev.type, pos.x, pos.y, pos.z);
        }
      }

      if (shell.getCurrentScreen() === 'ARENA' && match && player && opponent) {
        // Advance match timer
        match.update(dt);
        const snap = match.snapshot();

        // Gate beast control: frozen during COUNTDOWN and ENDED, live during FIGHTING
        const fighting = match.isFighting();
        player.inputActive = fighting;
        opponent.inputActive = fighting;

        // Report real mass fractions from the damage system
        const pState = damage.getState(player);
        const oState = damage.getState(opponent);
        const p1Mass = pState ? pState.getMassFraction() : 1.0;
        const p2Mass = oState ? oState.getMassFraction() : 1.0;
        match.reportMass(p1Mass, p2Mass);

        matchHud.setMatchState({
          timer: snap.timer,
          p1Mass: snap.p1Mass,
          p2Mass: snap.p2Mass,
          p1Stamina: player.getStaminaFraction(),
          p2Stamina: opponent.getStaminaFraction(),
          status: snap.phase === 'COUNTDOWN' ? 'countdown' :
                  snap.phase === 'FIGHTING' ? 'fighting' : 'ended',
          countdownSec: snap.phase === 'COUNTDOWN' ? snap.countdownSec : undefined,
          result: snap.result as any,
          p1Name: player.definition?.name || 'YOU',
          p2Name: opponent.definition?.name || 'BOT',
          p1AttackState: player.getAttackTelemetry()?.state ?? 'IDLE',
          p2AttackState: opponent.getAttackTelemetry()?.state ?? 'IDLE',
        });
      }
    },
    onPostRender: () => {
      if (player) {
        debugHud.update(
          player.getStaminaPercent(),
          loop.getFps(),
          player.getDebugState()
        );
      } else {
        debugHud.update(100, loop.getFps());
      }
    },
  });

  (window as any).render_game_to_text = () => {
    const payload = {
      coordinateSystem: 'Three.js world; +X right, +Y up, +Z forward.',
      screen: shell.getCurrentScreen(),
      selectedBeastId: home.getSelectedBeastId(),
      match: match
        ? {
            phase: match.snapshot().phase,
            timer: Number(match.snapshot().timer.toFixed(2)),
          }
        : null,
      player: player
        ? {
            name: player.definition?.name ?? 'PLAYER',
            position: player.getPosition(),
            yaw: Number(player.getYaw().toFixed(2)),
            stamina: Number(player.getStaminaFraction().toFixed(2)),
            mass: Number((damage.getState(player)?.getMassFraction() ?? 1).toFixed(2)),
            attack: player.getAttackTelemetry(),
          }
        : null,
      opponent: opponent
        ? {
            name: opponent.definition?.name ?? 'BOT',
            position: opponent.getPosition(),
            yaw: Number(opponent.getYaw().toFixed(2)),
            stamina: Number(opponent.getStaminaFraction().toFixed(2)),
            mass: Number((damage.getState(opponent)?.getMassFraction() ?? 1).toFixed(2)),
            attack: opponent.getAttackTelemetry(),
          }
        : null,
      controls: {
        movement: 'WASD',
        raisePrimary: 'J',
        commitPrimary: 'K',
        jump: 'SPACE',
      },
      recentDamageEvents: lastDamageEvents,
      recentAudio: audio.getRecentPlays(),
      music: audio.getCurrentMusicInfo(),
    };
    return JSON.stringify(payload);
  };

  if (hasInjectedAdvanceTime) {
    (window as any).advanceTime = async (ms: number) => {
      loop.advance(ms / 1000);
    };
    loop.advance(0);
  } else {
    loop.start();
  }
}

main().catch((err) => {
  console.error('MEATBASH failed to start:', err);
  const loadingMsg = document.getElementById('loading-msg');
  if (loadingMsg) {
    loadingMsg.innerHTML = `
      <div style="color: #ff4444">🥩 MEATBASH failed to load 🥩</div>
      <div style="font-size: 14px; margin-top: 8px; opacity: 0.8">${err.message}</div>
      <div style="font-size: 12px; margin-top: 4px; opacity: 0.5">Try Chrome/Edge with WebGPU enabled</div>
    `;
  }
});
