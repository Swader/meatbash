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
import { ImpactShockwaves } from './particles/impact-shockwaves';
import { applyHitFeedback } from './combat/hit-feedback';
import {
  MAX_WORKSHOP_BEASTS,
  createWorkshopBeast,
  loadWorkshopBeasts,
  saveWorkshopBeasts,
} from './beast/workshop';
import { NetworkMatch } from './network/network-match';
import { RemoteInputBuffer } from './network/remote-input';
import { SnapshotInterpolator, interpolateBeastState } from './network/snapshot-interp';
import type {
  HostSnapshotMessage,
  InputFrameMessage,
  NetworkRole,
  SerializedBeastState,
  SerializedMatchEvent,
} from './network/protocol';

function getRelayUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const override = typeof (window as any).__MEATBASH_RELAY_URL === 'string'
    ? String((window as any).__MEATBASH_RELAY_URL).trim()
    : '';
  if (override) return override;
  const host = window.location.hostname || 'localhost';
  const lowerHost = host.toLowerCase();
  const isLocalDevHost =
    lowerHost === 'localhost' ||
    lowerHost === '127.0.0.1' ||
    lowerHost === '0.0.0.0' ||
    lowerHost === '[::1]' ||
    lowerHost.endsWith('.localhost') ||
    /^127(?:\.\d{1,3}){3}\.(nip\.io|sslip\.io)$/.test(lowerHost);
  if (!isLocalDevHost) {
    return `${window.location.origin.replace(/^http/, protocol)}/ws`;
  }
  const rawPort = Number.parseInt(window.location.port, 10);
  const port = Number.isFinite(rawPort) ? rawPort + 1 : 3001;
  return `${protocol}://${host}:${port}/ws`;
}

const REMOTE_SNAPSHOT_TIMEOUT_MS = 750;

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
      const nextCustomBeasts = [created, ...customBeasts].slice(0, MAX_WORKSHOP_BEASTS);
      if (!saveWorkshopBeasts(nextCustomBeasts)) {
        return null;
      }
      customBeasts = nextCustomBeasts;
      return toBeastListing(created);
    },
  });
  void home;
  const matchHud = new MatchHud();
  const debugHud = new DebugHud();
  const musicCredit = new MusicCreditWidget();
  const hasInjectedAdvanceTime = typeof (window as any).advanceTime === 'function';
  const relayUrl = getRelayUrl();

  audio.setMusicContext('menu');
  debugHud.setStateVisible(false);

  initTuningPanel();
  loadingMsg.style.display = 'none';

  // ---- Combat systems (persistent across matches) ----
  const damage = new DamageResolver();
  const meatChunks = new MeatChunks(scene);
  const impactShockwaves = new ImpactShockwaves(scene);

  // ---- Active match state (reset on each new fight) ----
  let player: BeastInstance | null = null;
  let opponent: BeastInstance | null = null;
  let botAI: BotAI | null = null;
  let remoteInput: RemoteInputBuffer | null = null;
  let match: MatchController | null = null;
  let networkRole: NetworkRole | null = null;
  let networkRoomCode: string | null = null;
  let latestRemoteSnapshot: HostSnapshotMessage | null = null;
  let lastProcessedRemoteSnapshotFrame = -1;
  let snapshotSendAccumulator = 0;
  let pendingNetworkEvents: SerializedMatchEvent[] = [];
  let chargeShakeCooldown = 0;
  const snapshotInterpolator = new SnapshotInterpolator();
  let opponentDef = getPremade('stomper')!;
  let lastDamageEvents: Array<{
    source: string;
    segment: string;
    amount: number;
    profile?: string;
    splashText: string;
    age: number;
  }> = [];

  const network = new NetworkMatch(relayUrl, {
    onRoomCreated: (roomCode) => {
      networkRole = 'host';
      networkRoomCode = roomCode;
      home.setHomeStatus(`Room ${roomCode} created. Waiting for guest...`);
    },
    onJoinedRoom: (roomCode) => {
      networkRole = 'guest';
      networkRoomCode = roomCode;
      home.setHomeStatus(`Joined ${roomCode}. Waiting for host to start...`);
    },
    onPeerJoined: (roomCode, guestBeast) => {
      const hostBeast = network.getLocalBeast();
      if (!hostBeast) {
        home.setHomeStatus(`Room ${roomCode} ready, but the host beast is missing.`);
        return;
      }
      void (async () => {
        await startHostMatch(hostBeast, guestBeast, roomCode);
        network.sendMatchStart(hostBeast, guestBeast);
      })();
    },
    onMatchStart: (message) => {
      if (networkRole === 'guest') {
        void startGuestMatch(message.guestBeast, message.hostBeast, message.roomCode);
      }
    },
    onSnapshot: (snapshot) => {
      latestRemoteSnapshot = snapshot;
      snapshotInterpolator.push(snapshot);
      if (snapshot.frame === lastProcessedRemoteSnapshotFrame) return;
      lastProcessedRemoteSnapshotFrame = snapshot.frame;
      if (networkRole === 'guest') {
        processRemoteEvents(snapshot.events);
      }
    },
    onInputFrame: (frame) => {
      if (networkRole === 'host') {
        remoteInput?.applyFrame(frame);
      }
    },
    onPeerLeft: () => {
      if (shell.getCurrentScreen() === 'ARENA') {
        returnToHome('Peer left the room.');
        return;
      }
      if (networkRole === 'guest') {
        void network.disconnect();
        networkRole = null;
        networkRoomCode = null;
      }
      home.setHomeStatus('Peer left the room.');
    },
    onDisconnected: () => {
      const wasOnline = networkRole !== null;
      teardownMatch();
      networkRole = null;
      networkRoomCode = null;
      latestRemoteSnapshot = null;
      if (wasOnline) {
        home.setHomeStatus('Relay disconnected. Returned to menu.');
      }
      shell.transition('HOME');
    },
    onError: (message) => {
      home.setHomeStatus(message);
    },
  });

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
    remoteInput = null;
    match = null;
    latestRemoteSnapshot = null;
    lastProcessedRemoteSnapshotFrame = -1;
    snapshotSendAccumulator = 0;
    pendingNetworkEvents = [];
    snapshotInterpolator.reset();
    lastDamageEvents = [];
    // Empty the loop's beast list (mutated in place)
    (loop as any).config.beasts.length = 0;
  };

  const registerLoopBeasts = (...beastsToRegister: BeastInstance[]) => {
    const beasts = (loop as any).config.beasts as BeastInstance[];
    beasts.length = 0;
    beasts.push(...beastsToRegister);
  };

  /**
   * Spawn player + opponent + bot AI + fresh match controller.
   * Called when the player clicks "Make a match" on the home screen.
   */
  const startBotMatch = async (playerBeastId: string) => {
    await network.disconnect();
    networkRole = null;
    networkRoomCode = null;
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
    player.setCombatTarget(opponent);
    opponent.setCombatTarget(player);

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

    // Controls are locked during countdown, but the locomotion controller
    // stays alive so beasts stand up and face each other instead of slumping
    // into random orientations before the fight starts.
    player.inputActive = false;
    opponent.inputActive = false;

    match = new MatchController({}, (phase) => {
      if (phase === 'ENDED') {
        // Show result for a couple of seconds then let the player restart
      }
    });

    // Register the beasts with the loop so fixedUpdate calls applyInput
    // and the camera follows the first beast (player).
    registerLoopBeasts(player, opponent);

    shell.transition('ARENA');
  };

  const startHostMatch = async (
    hostBeast: BeastDefinition,
    guestBeast: BeastDefinition,
    roomCode: string
  ) => {
    try {
      await audio.init();
    } catch (err) {
      console.warn('Audio init failed:', err);
    }
    teardownMatch();
    networkRole = 'host';
    networkRoomCode = roomCode;
    opponentDef = guestBeast;

    player = spawnBeast(hostBeast, scene, physics, {
      x: -3,
      z: 0,
      yaw: Math.PI / 2,
      beastIndex: 0,
    });
    opponent = spawnBeast(guestBeast, scene, physics, {
      x: 3,
      z: 0,
      yaw: -Math.PI / 2,
      beastIndex: 1,
    });
    player.setCombatTarget(opponent);
    opponent.setCombatTarget(player);
    damage.register(player, physics.rapier, physics.world);
    damage.register(opponent, physics.rapier, physics.world);
    remoteInput = new RemoteInputBuffer();
    opponent.inputOverride = remoteInput as any;
    player.inputActive = false;
    opponent.inputActive = false;
    match = new MatchController();
    registerLoopBeasts(player, opponent);
    shell.transition('ARENA');
  };

  const startGuestMatch = async (
    guestBeast: BeastDefinition,
    hostBeast: BeastDefinition,
    roomCode: string
  ) => {
    try {
      await audio.init();
    } catch (err) {
      console.warn('Audio init failed:', err);
    }
    teardownMatch();
    networkRole = 'guest';
    networkRoomCode = roomCode;
    opponentDef = hostBeast;

    player = spawnBeast(guestBeast, scene, physics, {
      x: 3,
      z: 0,
      yaw: -Math.PI / 2,
      beastIndex: 0,
    });
    opponent = spawnBeast(hostBeast, scene, physics, {
      x: -3,
      z: 0,
      yaw: Math.PI / 2,
      beastIndex: 1,
    });
    player.setCombatTarget(opponent);
    opponent.setCombatTarget(player);
    player.inputActive = false;
    opponent.inputActive = false;
    match = null;
    registerLoopBeasts(player, opponent);
    shell.transition('ARENA');
  };

  /** Hand the player back to the home screen, discarding the current match. */
  const returnToHome = (statusMessage?: string) => {
    teardownMatch();
    if (networkRole) {
      void network.disconnect();
      networkRole = null;
      networkRoomCode = null;
    }
    home.setHomeStatus(
      statusMessage ??
        'Bot fights and match-code hosting are live. Pick a beast, host a room, or join one by code.'
    );
    shell.transition('HOME');
  };
  matchHud.setCallbacks({
    onBackToMenu: () => returnToHome(),
  });

  // ---- Register screens with the shell ----
  shell.registerScreen('LAB', {
    setVisible: (v) => {
      home.setMode('lab');
      home.setVisible(v);
    },
  });
  shell.registerScreen('HOME', {
    setVisible: (v) => {
      home.setMode('home');
      home.setVisible(v);
    },
  });
  shell.registerScreen('ARENA', {
    setVisible: (v) => matchHud.setVisible(v),
  });

  // HOME is the initial shell state. Because HOME and LAB share one DOM root,
  // explicitly sync the landing screen after registration so the later LAB
  // registration cannot leave the overlay hidden on first load.
  home.setMode('home');
  home.setVisible(true);
  matchHud.setVisible(false);

  // ---- Wire shell callbacks ----
  shell.setCallbacks({
    onStartMatch: (beastId, mode, joinCode) => {
      const selected = resolveBeastDefinition(beastId) || getPremade(DEFAULT_BEAST_ID)!;
      if (mode === 'bot') {
        void startBotMatch(beastId);
        return;
      }
      if (mode === 'host') {
        void network.host(selected);
        return;
      }
      home.setHomeStatus('Joining room...');
      void network.join(joinCode || '', selected);
    },
    onOpenLab: () => {
      shell.transition('LAB');
    },
    onOpenCertification: () => {
      // Deferred — Certification block
    },
    onScreenChanged: (to) => {
      debugHud.setStateVisible(to === 'ARENA');
      const musicContext =
        to === 'ARENA' ? 'battle' :
        to === 'LAB' ? 'lab' :
        'menu';
      audio.setMusicContext(musicContext);
    },
  });

  // ---- Global keyboard shortcuts: ESC (leave match), R (restart) ----
  window.addEventListener('keydown', (e) => {
    const currentScreen = shell.getCurrentScreen();
    if (currentScreen === 'LAB' && e.key === 'Escape') {
      shell.transition('HOME');
      return;
    }
    if (currentScreen !== 'ARENA') return;
    if (e.key === 'Escape') {
      returnToHome();
    } else if (e.key === 'r' || e.key === 'R') {
      if (match?.isEnded() && player && networkRole === null) {
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

  const canonicalKeys: Array<'W' | 'A' | 'S' | 'D' | 'J' | 'K' | ' '> = ['W', 'A', 'S', 'D', 'J', 'K', ' '];
  const encodeKey = (key: string) => (key === ' ' ? 'SPACE' : key);
  const decodeResultForLocal = (result: NetworkRole | 'draw' | undefined) => {
    if (!result) return undefined;
    if (result === 'draw') return 'draw';
    return result === networkRole ? 'win' : 'lose';
  };
  const hudStatusForMatch = (
    phase: 'COUNTDOWN' | 'FIGHTING' | 'ENDED',
    countdownSec?: number
  ) =>
    phase === 'ENDED'
      ? 'ended'
      : countdownSec != null
        ? 'countdown'
        : 'fighting';
  const beastForRole = (role: NetworkRole): BeastInstance | null => {
    if (!player || !opponent) return null;
    if (networkRole === 'guest') {
      return role === 'guest' ? player : opponent;
    }
    return role === 'host' ? player : opponent;
  };
  const buildInputFrame = (frame: number): InputFrameMessage => ({
    type: 'input_frame',
    frame,
    keys: canonicalKeys.filter((key) => input.isDown(key)).map(encodeKey),
    edges: {
      pressed: canonicalKeys.filter((key) => input.justPressed(key)).map(encodeKey),
      released: canonicalKeys.filter((key) => input.justReleased(key)).map(encodeKey),
    },
  });
  const serializeBeastState = (beast: BeastInstance, role: NetworkRole): SerializedBeastState => {
    const state = damage.getState(beast);
    const telemetry = beast.getAttackTelemetry();
    return {
      player: role,
      stamina: beast.getStaminaFraction(),
      mass: state?.getMassFraction() ?? 1,
      attack: {
        state: telemetry?.state ?? 'IDLE',
        profile: telemetry?.profile ?? 'blunt',
        chargeNorm: telemetry?.chargeNorm ?? 0,
        chargeTier: telemetry?.chargeTier ?? 'quick',
        holdSeconds: telemetry?.holdSeconds ?? 0,
        isBlocking: telemetry?.isBlocking ?? false,
        stateProgress: telemetry?.stateProgress ?? 0,
        visualRigType: telemetry?.visualRigType ?? 'generic',
      },
      segments: [...beast.skeleton.joints.entries()].map(([name, joint]) => {
        const pos = joint.body.translation();
        const rot = joint.body.rotation();
        return {
          name,
          attached: beast.isSegmentAttached(name),
          pos: [pos.x, pos.y, pos.z] as [number, number, number],
          rot: [rot.x, rot.y, rot.z, rot.w] as [number, number, number, number],
        };
      }),
    };
  };
  const buildHostSnapshot = (frame: number): HostSnapshotMessage | null => {
    if (!player || !opponent || !match) return null;
    const snap = match.snapshot();
    const result =
      snap.result === 'win' ? 'host' :
      snap.result === 'lose' ? 'guest' :
      snap.result === 'draw' ? 'draw' :
      undefined;
    return {
      type: 'host_snapshot',
      frame,
      serverTime: Date.now(),
      match: {
        phase: snap.phase,
        timer: snap.timer,
        countdownSec: snap.countdownSec,
        result,
      },
      beasts: [
        serializeBeastState(player, 'host'),
        serializeBeastState(opponent, 'guest'),
      ],
      events: pendingNetworkEvents.splice(0),
    };
  };
  const applyRemoteStateToBeast = (beast: BeastInstance, state: SerializedBeastState) => {
    for (const segment of state.segments) {
      if (!segment.attached) {
        beast.markSegmentDetached(segment.name);
      }
      const body = beast.getJointBody(segment.name);
      if (!body) continue;
      body.setTranslation({ x: segment.pos[0], y: segment.pos[1], z: segment.pos[2] }, true);
      body.setRotation({ x: segment.rot[0], y: segment.rot[1], z: segment.rot[2], w: segment.rot[3] }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    beast.setRemoteAttackTelemetry(state.attack);
    beast.syncFromPhysics();
  };
  const processRemoteEvents = (events: SerializedMatchEvent[]) => {
    if (!events.length) return;
    const nextDamageEvents = events
      .filter((event): event is Extract<SerializedMatchEvent, { type: 'damage' }> => event.type === 'damage')
      .map((event) => ({
        source: event.source,
        segment: event.segment,
        amount: Number(event.amount.toFixed(3)),
        splashText: event.splashText,
        age: 1.25,
      }));
    if (nextDamageEvents.length) {
      lastDamageEvents = [...nextDamageEvents, ...lastDamageEvents].slice(0, 12);
    }

    for (const event of events) {
      if (event.type === 'damage') {
        matchHud.pushCombatText(event.splashText);
        meatChunks.spawn(
          { x: event.point[0], y: event.point[1], z: event.point[2] },
          event.impactClass === 'heavy-clean' ? 16 : 8,
          event.impactClass === 'heavy-clean' ? 5.2 : 3.2
        );
        if (event.impactClass === 'heavy-clean') {
          impactShockwaves.spawn({ x: event.point[0], y: event.point[1], z: event.point[2] }, 1.25);
        }
        const victimBeast = event.victim ? beastForRole(event.victim) : null;
        victimBeast?.flashImpact(event.impactClass === 'heavy-clean' ? 0.95 : 0.45, event.impactClass === 'heavy-clean' ? 0.11 : 0.06);
        audio.playSfx(`hit_body`, event.point[0], event.point[1], event.point[2]);
      } else if (event.type === 'severance') {
        meatChunks.spawn({ x: event.point[0], y: event.point[1], z: event.point[2] }, 12, 4.5);
        beastForRole(event.beast)?.markSegmentDetached(event.segment);
      } else if (event.type === 'audio') {
        const soundSource = beastForRole(event.beast);
        const pos = soundSource?.getPosition();
        audio.playSfx(event.name, pos?.x, pos?.y, pos?.z);
      }
    }
  };

  // ---- Game loop ----
  const loop = new GameLoop({
    renderer,
    scene,
    camera,
    physics,
    input,
    // Empty for home screen — when in arena we push both beasts below
    beasts: [],
    onBeforeFixedStep: (_dt, frame) => {
      if (networkRole === 'guest' && shell.getCurrentScreen() === 'ARENA') {
        network.sendInput(buildInputFrame(frame));
      }
    },

    // Per-fixed-step: drain contact events into damage, process severance,
    // spawn meat chunks. Must happen AFTER physics.step and BEFORE beast sync.
    onPostPhysics: (dt) => {
      if (!player || !opponent || !match || !match.isFighting() || networkRole === 'guest') return;

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
        const heavyBoom = ev.impactClass === 'heavy-clean' ? 1.85 : 1;
        const srcMul = (ev.source === 'active' ? 1.45 : 1) * ev.feedbackMul * heavyBoom;
        const count = Math.min(22, 1 + Math.floor((ev.amount / 3) * srcMul));
        const speed =
          2 +
          ev.impactSpeed * (ev.source === 'active' ? 0.5 : 0.32) * Math.max(0.85, ev.feedbackMul) * heavyBoom;
        meatChunks.spawn(ev.point, count, speed, undefined, srcMul);
        if (ev.impactClass === 'heavy-clean') {
          impactShockwaves.spawn(ev.point, 1.3);
          ev.victim.flashImpact(0.95, 0.11);
        }
        if (networkRole === 'host') {
          pendingNetworkEvents.push({
            type: 'damage',
            victim: ev.victim === player ? 'host' : 'guest',
            attacker:
              ev.attacker == null ? undefined :
              ev.attacker === player ? 'host' :
              'guest',
            segment: ev.segment,
            amount: ev.amount,
            source: ev.source,
            splashText: ev.splashText,
            impactClass: ev.impactClass,
            point: [ev.point.x, ev.point.y, ev.point.z],
            shake: ev.shake,
          });
        }
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
        if (networkRole === 'host') {
          pendingNetworkEvents.push({
            type: 'severance',
            beast: s.beast === player ? 'host' : 'guest',
            segment: s.segment,
            point: [s.position.x, s.position.y, s.position.z],
          });
        }
      }
    },

    onVariableUpdate: (dt) => {
      updateArena(dt);
      meatChunks.update(dt);
      impactShockwaves.update(dt);
      musicCredit.update(audio.getCurrentMusicInfo(), audio.getMusicWaveformBars());
      chargeShakeCooldown = Math.max(0, chargeShakeCooldown - dt);
      lastDamageEvents = lastDamageEvents
        .map((ev) => ({ ...ev, age: ev.age - dt }))
        .filter((ev) => ev.age > 0);

      for (const beast of [player, opponent]) {
        if (!beast) continue;
        const pos = beast.getPosition();
        for (const ev of beast.consumeAudioEvents()) {
          audio.playSfx(ev.type, pos.x, pos.y, pos.z);
          if (networkRole === 'host') {
            pendingNetworkEvents.push({
              type: 'audio',
              beast: beast === player ? 'host' : 'guest',
              name: ev.type,
            });
          }
        }
        for (const text of beast.consumeHudEvents()) {
          matchHud.pushCombatText(text);
        }
      }

      if (shell.getCurrentScreen() === 'ARENA' && player && chargeShakeCooldown <= 0) {
        const tele = player.getAttackTelemetry();
        if (tele && (tele.state === 'WINDUP' || tele.state === 'HELD')) {
          const intensity =
            0.018 +
            tele.chargeNorm * 0.05 +
            (tele.chargeTier === 'heavy' ? 0.03 : tele.chargeTier === 'ready' ? 0.012 : 0);
          loop.addCameraShake(intensity, 0.055, 0.55);
          chargeShakeCooldown = tele.chargeTier === 'heavy' ? 0.035 : 0.05;
        }
      }

      if (networkRole === 'guest' && shell.getCurrentScreen() === 'ARENA' && player && opponent && latestRemoteSnapshot) {
        if (!snapshotInterpolator.isCurrentFresh(REMOTE_SNAPSHOT_TIMEOUT_MS)) {
          returnToHome('Connection stalled. Returned to menu.');
          return;
        }
        const sampled = snapshotInterpolator.sample();
        if (sampled.current) {
          const currentGuest = sampled.current.beasts.find((state) => state.player === 'guest');
          const currentHost = sampled.current.beasts.find((state) => state.player === 'host');
          const previousGuest = sampled.previous?.beasts.find((state) => state.player === 'guest') ?? null;
          const previousHost = sampled.previous?.beasts.find((state) => state.player === 'host') ?? null;
          if (currentGuest) applyRemoteStateToBeast(player, interpolateBeastState(previousGuest, currentGuest, sampled.alpha));
          if (currentHost) applyRemoteStateToBeast(opponent, interpolateBeastState(previousHost, currentHost, sampled.alpha));

          player.inputActive = false;
          opponent.inputActive = false;
          matchHud.setMatchState({
            timer: sampled.current.match.timer,
            p1Mass: currentGuest?.mass ?? 1,
            p2Mass: currentHost?.mass ?? 1,
            p1Stamina: currentGuest?.stamina ?? 1,
            p2Stamina: currentHost?.stamina ?? 1,
            status: hudStatusForMatch(sampled.current.match.phase, sampled.current.match.countdownSec),
            countdownSec: sampled.current.match.countdownSec,
            result: decodeResultForLocal(sampled.current.match.result) as any,
            canRestart: false,
            p1Name: player.definition?.name || 'YOU',
            p2Name: opponent.definition?.name || 'HOST',
            p1AttackState: currentGuest?.attack.state ?? 'IDLE',
            p2AttackState: currentHost?.attack.state ?? 'IDLE',
          });
        }
        return;
      }

      if (shell.getCurrentScreen() === 'ARENA' && match && player && opponent) {
        // Report real mass fractions from the damage system
        const pState = damage.getState(player);
        const oState = damage.getState(opponent);
        const p1Mass = pState ? pState.getMassFraction() : 1.0;
        const p2Mass = oState ? oState.getMassFraction() : 1.0;
        match.reportMass(p1Mass, p2Mass);

        // Advance match timer after feeding this frame's real mass state.
        match.update(dt);
        const snap = match.snapshot();

        // Gate beast control: frozen during COUNTDOWN and ENDED, live during FIGHTING
        const fighting = match.isFighting();
        player.inputActive = fighting;
        opponent.inputActive = fighting;

        matchHud.setMatchState({
          timer: snap.timer,
          p1Mass: snap.p1Mass,
          p2Mass: snap.p2Mass,
          p1Stamina: player.getStaminaFraction(),
          p2Stamina: opponent.getStaminaFraction(),
          status: hudStatusForMatch(snap.phase, snap.countdownSec),
          countdownSec: snap.countdownSec,
          result: snap.result as any,
          canRestart: networkRole === null,
          p1Name: player.definition?.name || 'YOU',
          p2Name: opponent.definition?.name || 'BOT',
          p1AttackState: player.getAttackTelemetry()?.state ?? 'IDLE',
          p2AttackState: opponent.getAttackTelemetry()?.state ?? 'IDLE',
        });

        if (networkRole === 'host') {
          snapshotSendAccumulator += dt;
          if (snapshotSendAccumulator >= 1 / 30) {
            const hostSnapshot = buildHostSnapshot(loop.getFixedFrame());
            if (hostSnapshot) {
              network.sendSnapshot(hostSnapshot);
            }
            snapshotSendAccumulator = 0;
          }
        }
      }
    },
    onPostRender: () => {
      debugHud.setStateVisible(shell.getCurrentScreen() === 'ARENA');
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
    const remoteGuestState = latestRemoteSnapshot?.beasts.find((state) => state.player === 'guest');
    const remoteHostState = latestRemoteSnapshot?.beasts.find((state) => state.player === 'host');
    const payload = {
      coordinateSystem: 'Three.js world; +X right, +Y up, +Z forward.',
      screen: shell.getCurrentScreen(),
      selectedBeastId: home.getSelectedBeastId(),
      network: {
        role: networkRole,
        roomCode: networkRoomCode,
        relayUrl,
      },
      match:
        match
          ? {
              phase: match.snapshot().phase,
              timer: Number(match.snapshot().timer.toFixed(2)),
            }
          : latestRemoteSnapshot
            ? {
                phase: latestRemoteSnapshot.match.phase,
                timer: Number(latestRemoteSnapshot.match.timer.toFixed(2)),
              }
            : null,
      player: player
        ? {
            name: player.definition?.name ?? 'PLAYER',
            position: player.getPosition(),
            yaw: Number(player.getYaw().toFixed(2)),
            stamina: Number((networkRole === 'guest' ? (remoteGuestState?.stamina ?? 1) : player.getStaminaFraction()).toFixed(2)),
            mass: Number((networkRole === 'guest' ? (remoteGuestState?.mass ?? 1) : (damage.getState(player)?.getMassFraction() ?? 1)).toFixed(2)),
            attack: networkRole === 'guest' ? remoteGuestState?.attack ?? null : player.getAttackTelemetry(),
          }
        : null,
      opponent: opponent
        ? {
            name: opponent.definition?.name ?? 'BOT',
            position: opponent.getPosition(),
            yaw: Number(opponent.getYaw().toFixed(2)),
            stamina: Number((networkRole === 'guest' ? (remoteHostState?.stamina ?? 1) : opponent.getStaminaFraction()).toFixed(2)),
            mass: Number((networkRole === 'guest' ? (remoteHostState?.mass ?? 1) : (damage.getState(opponent)?.getMassFraction() ?? 1)).toFixed(2)),
            attack: networkRole === 'guest' ? remoteHostState?.attack ?? null : opponent.getAttackTelemetry(),
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
