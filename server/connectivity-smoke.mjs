import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CODEX_HOME = process.env.CODEX_HOME ?? path.join(process.env.HOME || '', '.codex');
const playwrightModuleUrl = pathToFileURL(
  path.join(CODEX_HOME, 'skills', 'develop-web-game', 'node_modules', 'playwright', 'index.mjs')
).href;
const { chromium } = await import(playwrightModuleUrl);

const BASE_URL = process.env.MEATBASH_URL ?? 'http://localhost:3000';
const OUT_DIR = process.env.MEATBASH_OUT_DIR ?? 'output/runtime-probes/connectivity-smoke';

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.locator('text=BASH BOT').click({ force: true });
await page.waitForFunction(() => {
  try {
    const payload = JSON.parse(window.render_game_to_text());
    return payload.match?.phase === 'FIGHTING';
  } catch {
    return false;
  }
}, { timeout: 15000 });

const dispatchKey = async (type, key, code) => {
  await page.evaluate(
    ({ eventType, eventKey, eventCode }) => {
      window.dispatchEvent(
        new KeyboardEvent(eventType, {
          key: eventKey,
          code: eventCode,
          bubbles: true,
        })
      );
    },
    { eventType: type, eventKey: key, eventCode: code }
  );
};

await page.evaluate(() => {
  const neutral = {
    isDown: () => false,
    justPressed: () => false,
    justReleased: () => false,
    beginFixedStep: () => {},
    endFrame: () => {},
    getHeldKeys: () => [],
  };
  const opponent = window.__getOpponent();
  opponent.inputOverride = neutral;
});

const runTrial = async (trialIdx, offsetZ) => {
  await page.evaluate(({ zOffset }) => {
    const player = window.__getPlayer();
    const opponent = window.__getOpponent();
    const orientBeast = (beast, targetX, targetZ, yaw) => {
      const torso = beast.skeleton.joints.get('torso').body.translation();
      const dx = targetX - torso.x;
      const dz = targetZ - torso.z;
      const half = yaw * 0.5;
      const q = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
      for (const body of beast.skeleton.allBodies) {
        const p = body.translation();
        body.setTranslation({ x: p.x + dx, y: p.y, z: p.z + dz }, true);
        body.setRotation(q, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    };
    orientBeast(opponent, 1.6, 0, -Math.PI / 2);
    orientBeast(player, 0.2, zOffset, Math.PI / 2);
  }, { zOffset: offsetZ });

  await page.waitForTimeout(180);
  await dispatchKey('keydown', 'w', 'KeyW');
  await dispatchKey('keydown', 'j', 'KeyJ');
  await page.waitForTimeout(780);
  await dispatchKey('keyup', 'w', 'KeyW');
  await dispatchKey('keydown', 'Enter', 'Enter');
  await page.waitForTimeout(110);
  await dispatchKey('keyup', 'Enter', 'Enter');
  await dispatchKey('keyup', 'j', 'KeyJ');
  await page.waitForTimeout(520);

  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  await page.screenshot({ path: path.join(OUT_DIR, `trial-${trialIdx}.png`) });
  return {
    offsetZ,
    opponentMass: state.opponent?.mass ?? 1,
    activeEvents: (state.recentDamageEvents ?? []).filter((event) => event.source === 'active'),
    recentDamageEvents: state.recentDamageEvents ?? [],
  };
};

const trials = [];
for (const [idx, offset] of [0.42, 0.2, -0.18].entries()) {
  trials.push(await runTrial(idx, offset));
}

fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(trials, null, 2));
await browser.close();

console.log(JSON.stringify(trials, null, 2));
