import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CODEX_HOME = process.env.CODEX_HOME ?? path.join(process.env.HOME || '', '.codex');
const playwrightModuleUrl = pathToFileURL(
  path.join(CODEX_HOME, 'skills', 'develop-web-game', 'node_modules', 'playwright', 'index.mjs')
).href;
const { chromium } = await import(playwrightModuleUrl);

const BASE_URL = process.env.MEATBASH_URL ?? 'http://localhost:3000';
const OUT_DIR = process.env.MEATBASH_OUT_DIR ?? 'output/runtime-probes/combat-smoke';

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.locator('text=BASH BOT').click({ force: true });
await page.waitForTimeout(4200);

const dispatchKey = async (type, key, code) => {
  await page.evaluate(
    ({ eventType, eventKey, eventCode }) => {
      window.dispatchEvent(new KeyboardEvent(eventType, {
        key: eventKey,
        code: eventCode,
        bubbles: true,
      }));
    },
    { eventType: type, eventKey: key, eventCode: code }
  );
};

// Turn away first so the heavy commit is much more likely to whiff.
await dispatchKey('keydown', 'D', 'KeyD');
await page.waitForTimeout(900);
await dispatchKey('keyup', 'D', 'KeyD');

await dispatchKey('keydown', 'B', 'KeyB');
await page.waitForTimeout(1200);
const heldState = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
await page.screenshot({ path: path.join(OUT_DIR, 'held.png') });

await dispatchKey('keydown', 'Enter', 'Enter');
await page.waitForTimeout(120);
await dispatchKey('keyup', 'Enter', 'Enter');
await dispatchKey('keyup', 'B', 'KeyB');
await page.waitForTimeout(800);

const endState = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
await page.screenshot({ path: path.join(OUT_DIR, 'post-commit.png') });

fs.writeFileSync(
  path.join(OUT_DIR, 'summary.json'),
  JSON.stringify(
    {
      heldAttack: heldState.player?.attack,
      heldStamina: heldState.player?.stamina,
      endAttack: endState.player?.attack,
      endStamina: endState.player?.stamina,
      recentAudio: endState.recentAudio,
      recentDamageEvents: endState.recentDamageEvents,
    },
    null,
    2
  )
);

await browser.close();

console.log(JSON.stringify({
  heldAttack: heldState.player?.attack,
  heldStamina: heldState.player?.stamina,
  endAttack: endState.player?.attack,
  endStamina: endState.player?.stamina,
  recentAudio: endState.recentAudio,
}, null, 2));
