import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CODEX_HOME = process.env.CODEX_HOME ?? path.join(process.env.HOME || '', '.codex');
const playwrightModuleUrl = pathToFileURL(
  path.join(CODEX_HOME, 'skills', 'develop-web-game', 'node_modules', 'playwright', 'index.mjs')
).href;
const { chromium } = await import(playwrightModuleUrl);

const BASE_URL = process.env.MEATBASH_URL ?? 'http://localhost:3000';
const OUT_DIR = process.env.MEATBASH_OUT_DIR ?? 'output/runtime-probes/multiplayer-smoke';
const SOAK_MS = Number.parseInt(process.env.MEATBASH_SOAK_MS ?? '0', 10) || 0;

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

const hostPage = await browser.newPage();
const guestPage = await browser.newPage();
const errors = [];

for (const [label, page] of [['host', hostPage], ['guest', guestPage]]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push({ page: label, type: 'console.error', text: msg.text() });
    }
  });
  page.on('pageerror', (err) => {
    errors.push({ page: label, type: 'pageerror', text: String(err) });
  });
}

await Promise.all([
  hostPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' }),
  guestPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' }),
]);
await Promise.all([hostPage.waitForTimeout(800), guestPage.waitForTimeout(800)]);

await hostPage.locator('text=HOST MATCH').click({ force: true });
await hostPage.waitForFunction(() => {
  const status = document.querySelector('.mb-home-status');
  return !!status && /MEAT-[A-Z0-9]{4}/.test(status.textContent || '');
}, { timeout: 15000 });

const hostStatus = await hostPage.locator('.mb-home-status').textContent();
const roomCodeMatch = hostStatus?.match(/MEAT-[A-Z0-9]{4}/);
if (!roomCodeMatch) {
  throw new Error(`Failed to extract room code from host status: ${hostStatus}`);
}
const roomCode = roomCodeMatch[0];

await guestPage.fill('input[placeholder="ROOM CODE"]', roomCode);
await guestPage.locator('text=JOIN MATCH').click({ force: true });

await Promise.all([
  hostPage.waitForFunction(() => {
    try {
      const payload = JSON.parse(window.render_game_to_text());
      return payload.screen === 'ARENA' && payload.network?.role === 'host';
    } catch {
      return false;
    }
  }),
  guestPage.waitForFunction(() => {
    try {
      const payload = JSON.parse(window.render_game_to_text());
      return payload.screen === 'ARENA' && payload.network?.role === 'guest';
    } catch {
      return false;
    }
  }),
]);

const readState = async (page) =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));

await hostPage.waitForTimeout(4200);
await guestPage.waitForTimeout(4200);

const startHostState = await readState(hostPage);
const startGuestState = await readState(guestPage);

await Promise.all([
  hostPage.keyboard.down('w'),
  guestPage.keyboard.down('ArrowUp'),
]);
await Promise.all([
  hostPage.waitForTimeout(900),
  guestPage.waitForTimeout(900),
]);
await Promise.all([
  hostPage.keyboard.up('w'),
  guestPage.keyboard.up('ArrowUp'),
]);

await hostPage.waitForTimeout(800);
await guestPage.waitForTimeout(800);

if (SOAK_MS > 0) {
  await Promise.all([
    hostPage.waitForTimeout(SOAK_MS),
    guestPage.waitForTimeout(SOAK_MS),
  ]);
}

const endHostState = await readState(hostPage);
const endGuestState = await readState(guestPage);

const moved = (a, b) => {
  const dx = (a?.position?.x ?? 0) - (b?.position?.x ?? 0);
  const dz = (a?.position?.z ?? 0) - (b?.position?.z ?? 0);
  return Math.hypot(dx, dz);
};

const hostMoved = moved(endHostState.player, startHostState.player);
const guestMovedOnHost = moved(endHostState.opponent, startHostState.opponent);
const guestMovedLocally = moved(endGuestState.player, startGuestState.player);

if (hostMoved < 0.03) {
  throw new Error(`Host player did not move enough: ${hostMoved.toFixed(3)}`);
}
if (guestMovedOnHost < 0.03) {
  throw new Error(`Host never saw guest movement: ${guestMovedOnHost.toFixed(3)}`);
}
if (guestMovedLocally < 0.03) {
  throw new Error(`Guest did not receive its own authoritative movement: ${guestMovedLocally.toFixed(3)}`);
}

await hostPage.screenshot({ path: path.join(OUT_DIR, 'host-final.png') });
await guestPage.screenshot({ path: path.join(OUT_DIR, 'guest-final.png') });
fs.writeFileSync(path.join(OUT_DIR, 'host-state.json'), JSON.stringify(endHostState, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'guest-state.json'), JSON.stringify(endGuestState, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify({
  roomCode,
  hostMoved,
  guestMovedOnHost,
  guestMovedLocally,
  errors,
}, null, 2));

if (errors.length > 0) {
  fs.writeFileSync(path.join(OUT_DIR, 'errors.json'), JSON.stringify(errors, null, 2));
}

await browser.close();

console.log(JSON.stringify({
  roomCode,
  hostMoved,
  guestMovedOnHost,
  guestMovedLocally,
  errorCount: errors.length,
  soakMs: SOAK_MS,
}, null, 2));
