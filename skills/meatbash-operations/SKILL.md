---
name: meatbash-operations
description: Use when deploying, updating, or operating the MEATBASH app on a server. Covers the real SSH key and host defaults, Bun-based build and serve workflow, systemd service management, and deployment verification for this repo.
---

# MEATBASH Operations

Use this skill for MEATBASH server work: deploys, updates, service restarts,
health checks, and ops troubleshooting.

## First read

- Read [`../../docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) before making
  server changes.
- Use the committed systemd unit at
  [`../../deploy/meatbash.service`](../../deploy/meatbash.service).
- Use the committed relay unit at
  [`../../deploy/meatbash-relay.service`](../../deploy/meatbash-relay.service).
- The Bun production entrypoint is
  [`../../src/prod-server.ts`](../../src/prod-server.ts).

## Access defaults for this repo

- SSH key path on the Codex machine:
  `/Users/swader/.ssh/codex-kvasyr-prod`
- Public key label: `codex-kvasyr-prod`
- Current MEATBASH access commands:

```bash
ssh -i /Users/swader/.ssh/codex-kvasyr-prod swader@meatbash.bitfalls.com
ssh -i /Users/swader/.ssh/codex-kvasyr-prod swader@178.62.192.123
```

- Shared apps root convention: `/var/www`
- App proxy target: `127.0.0.1:3010`
- Relay proxy target: `127.0.0.1:3011`

## Deployment rules

- Use **Bun**, not Node or PM2.
- Use **systemd** service files, not ad hoc background processes.
- Build from `/var/www/meatbash`.
- After updates: `bun install --frozen-lockfile`, `bun run build`, then
  `systemctl restart meatbash meatbash-relay`.

## Standard flow

1. Verify SSH and sudo access first.
2. Sync or clone the repo under `/var/www/meatbash`.
3. Build from `/var/www/meatbash`.
4. Install or refresh `deploy/meatbash.service`.
5. Install or refresh `deploy/meatbash-relay.service`.
6. Install or refresh the nginx vhost for `meatbash.bitfalls.com`, including
   the `/ws` upgrade route.
7. Restart both services and verify with `systemctl`, `journalctl`, and `curl`.

## Access verification

Use the command from `docs/DEPLOYMENT.md` to confirm:

- host resolves
- SSH key auth works
- `sudo -n true` succeeds without prompting

If passwordless sudo fails, stop and fix server bootstrap before attempting
deploy automation.

## Common maintenance commands

```bash
cd /var/www/meatbash
~/.bun/bin/bun install --frozen-lockfile
~/.bun/bin/bun run build
sudo systemctl restart meatbash
sudo systemctl restart meatbash-relay
sudo systemctl status --no-pager meatbash
sudo systemctl status --no-pager meatbash-relay
sudo journalctl -u meatbash -n 200 --no-pager
sudo journalctl -u meatbash-relay -n 200 --no-pager
curl -I http://127.0.0.1:3010/
curl -i -N \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==' \
  http://127.0.0.1:3011/ws | sed -n '1,10p'
curl -i -N \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==' \
  https://meatbash.bitfalls.com/ws | sed -n '1,10p'
```
