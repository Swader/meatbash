# MEATBASH

MEATBASH is a Bun + Three.js arena prototype for Vibejam 2026. The current
build ships a playable local 1v1 bot fight, attack-intent combat on `J` / `K`,
per-segment damage and severance, contextual music by Tragikomik, and a quick
Gene Lab workshop that forges custom beasts from the `ENTER GENE LAB` flow.

## Run

```bash
bun install
bun run dev
```

`bun run dev` starts both the app and the match-code relay:

- app: [http://localhost:3000](http://localhost:3000)
- relay: `ws://localhost:3001/ws`

The app rebuilds on refresh.

## Controls

- `WASD` move
- `SPACE` jump / panic flail
- `J` raise and hold the primary attack
- `K` commit the held attack
- `ESC` leave the arena
- `R` restart after the match ends

## Scripts

```bash
bun run dev    # local dev server
bun run dev:app # app-only dev server
bun run build  # production bundle in dist/
bun run relay  # websocket relay
bun run typecheck
bun run zip    # review/archive zip (builds first)
```

## Current scope

- Playable premades: Chonkus, Stomper, Noodlesnake, Butterchonk
- Quick Gene Lab workshop: biped/quadruped archetype, primary attack profile,
  charge bias, color preset, localStorage persistence
- Match-code multiplayer: host/join room flow over the Bun websocket relay
- Arena flow: home screen, bot fights, and online 1v1 are live

Not built yet: spectator mode, full Gene Lab sculpting, Darwin Certification,
and server-backed beast storage.

## Debug hooks

There is no formal test suite yet. Browser verification is helped by a few
runtime hooks exposed from `src/main.ts`:

- `window.render_game_to_text()`
- `window.advanceTime(ms)` when a harness injects deterministic stepping
- `window.__getPlayer()`
- `window.__getOpponent()`
- `window.__physics`

## Docs

- [docs/MEATBASH_PRD.md](docs/MEATBASH_PRD.md)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/TASKS.md](docs/TASKS.md)
- [docs/NOW_NEXT_LATER.md](docs/NOW_NEXT_LATER.md)
- [CLAUDE_CONTEXT.md](CLAUDE_CONTEXT.md)
