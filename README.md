# MEATBASH

MEATBASH is a Bun + Three.js arena prototype for Vibejam 2026. The current
build ships a playable local 1v1 bot fight, attack-intent combat on `J` / `K`,
per-segment damage and severance, contextual music by Tragikomik, and a quick
workshop that forges custom beasts straight from the home screen.

## Run

```bash
bun install
bun run dev
```

The dev server runs at [http://localhost:3000](http://localhost:3000) and
rebuilds on refresh.

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
bun run build  # production bundle in dist/
bun run zip    # review/archive zip (builds first)
```

## Current scope

- Playable premades: Chonkus, Stomper, Noodlesnake, Butterchonk
- Quick workshop: biped/quadruped archetype, primary attack profile, charge
  bias, color preset, localStorage persistence
- Arena-only flow for now: home screen and bot matches are live

Not built yet: multiplayer, full Gene Lab sculpting, Darwin Certification,
server-backed beast storage.

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
- [docs/TASKS.md](docs/TASKS.md)
- [docs/NOW_NEXT_LATER.md](docs/NOW_NEXT_LATER.md)
- [CLAUDE_CONTEXT.md](CLAUDE_CONTEXT.md)
