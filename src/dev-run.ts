/**
 * Local development stack runner.
 *
 * Starts the HTTP app dev server and the websocket relay together so the
 * default `bun run dev` command matches the advertised host/join flow.
 */

import { resolve } from 'path';

const cwd = resolve(import.meta.dir, '..');
const bunBin = process.execPath;

const children = [
  {
    name: 'app',
    proc: Bun.spawn([bunBin, 'run', 'src/dev-server.ts'], {
      cwd,
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  },
  {
    name: 'relay',
    proc: Bun.spawn([bunBin, 'run', 'server/index.ts'], {
      cwd,
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  },
];

let shuttingDown = false;

const shutdown = (code: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.proc.exitCode === null) {
      child.proc.kill();
    }
  }
  setTimeout(() => process.exit(code), 50);
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => shutdown(0));
}

for (const child of children) {
  void child.proc.exited.then((code) => {
    if (shuttingDown) return;
    console.error(`[dev] ${child.name} exited with code ${code}`);
    shutdown(code === 0 ? 1 : code);
  });
}

await Promise.race(children.map((child) => child.proc.exited));
