import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CODEX_HOME = process.env.CODEX_HOME ?? path.join(process.env.HOME || '', '.codex');
const playwrightModuleUrl = pathToFileURL(
  path.join(CODEX_HOME, 'skills', 'develop-web-game', 'node_modules', 'playwright', 'index.mjs')
).href;
const { chromium } = await import(playwrightModuleUrl);

const BASE_URL = process.env.MEATBASH_URL ?? 'http://localhost:3000';
const OUT_DIR = process.env.MEATBASH_OUT_DIR ?? 'output/runtime-probes/workshop-smoke';

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.locator('text=ENTER GENE LAB').click({ force: true });
await page.waitForTimeout(400);

const fillByLabel = async (labelText, value) => {
  const fields = await page.locator('.mb-workshop-field').elementHandles();
  for (const field of fields) {
    const label = await field.$eval('label', (el) => el.textContent || '');
    if (!label.includes(labelText)) continue;
    const input = await field.$('input');
    if (!input) continue;
    await input.fill(value);
    return;
  }
  throw new Error(`Missing workshop input field: ${labelText}`);
};

const selectByLabel = async (labelText, value) => {
  const fields = await page.locator('.mb-workshop-field').elementHandles();
  for (const field of fields) {
    const label = await field.$eval('label', (el) => el.textContent || '');
    if (!label.includes(labelText)) continue;
    const select = await field.$('select');
    if (!select) continue;
    await select.selectOption(value);
    return;
  }
  throw new Error(`Missing workshop field: ${labelText}`);
};

await fillByLabel('Name', 'Rammer');
await selectByLabel('Archetype', 'quadruped');
await selectByLabel('Weight Class', 'heavy');
await selectByLabel('Body Size', 'chonk');
await selectByLabel('Stability Bias', 'stable');
await selectByLabel('Weapon Type', 'headbutt');
await selectByLabel('Weapon Socket', 'head_front');
await selectByLabel('Weapon Length', 'long');
await selectByLabel('Weapon Mass', 'heavy');
await selectByLabel('Charge Style', 'heavy');
await selectByLabel('Color', 'ember');

await page.locator('text=Forge Custom Beast').click({ force: true });
await page.waitForTimeout(600);

const labStatus = await page.locator('.mb-workshop-status').textContent();
const forgedCards = await page.locator('text=Rammer').count();
await page.screenshot({ path: path.join(OUT_DIR, 'lab.png') });

await page.locator('text=BACK TO MENU').click({ force: true });
await page.waitForTimeout(300);
await page.locator('text=BASH BOT').click({ force: true });
await page.waitForTimeout(5000);

const arenaState = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
await page.screenshot({ path: path.join(OUT_DIR, 'arena.png') });
fs.writeFileSync(
  path.join(OUT_DIR, 'summary.json'),
  JSON.stringify(
    {
      labStatus,
      forgedCards,
      selectedBeastId: arenaState.selectedBeastId,
      screen: arenaState.screen,
      playerName: arenaState.player?.name,
    },
    null,
    2
  )
);

await browser.close();

console.log(JSON.stringify({
  labStatus,
  forgedCards,
  selectedBeastId: arenaState.selectedBeastId,
  screen: arenaState.screen,
  playerName: arenaState.player?.name,
}, null, 2));
