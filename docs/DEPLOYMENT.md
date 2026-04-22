# MEATBASH Deployment

This app should be deployed with **Bun + systemd**. Do not use PM2, Node, or
an ad hoc static-file daemon.

The shipped game now has two runtime pieces:

- the HTTP app server on `127.0.0.1:3010`
- the websocket relay on `127.0.0.1:3011`

## Current access defaults

- Current MEATBASH deploy target: `swader@meatbash.bitfalls.com`
- Fallback direct host: `swader@178.62.192.123`
- SSH key path used by Codex on this machine: `/Users/swader/.ssh/codex-kvasyr-prod`
- Public key:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHaoD/KJt22Oyy4L4EQRp5IR9RfJ4KNAqEThTc8OhY0g codex-kvasyr-prod
```

- Shared apps root convention: `/var/www`
- Existing access check on 2026-04-21:
  - SSH login with the key works against both `swader@meatbash.bitfalls.com`
    and `swader@178.62.192.123`
  - `sudo -n true` succeeds there
  - nginx and certbot are already installed on the host
  - port `3000` is already occupied by `rarity.service`, so MEATBASH should
    use its own app port behind nginx

## New server bootstrap

Run this on the new server as the target deploy user after initial login.
This installs the Codex deploy key and enables passwordless sudo for that
same user. Replace `swader` only if the server uses a different account.

```bash
DEPLOY_USER=swader
install -d -m 700 "/home/$DEPLOY_USER/.ssh"
cat <<'EOF' >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHaoD/KJt22Oyy4L4EQRp5IR9RfJ4KNAqEThTc8OhY0g codex-kvasyr-prod
EOF
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" | sudo tee "/etc/sudoers.d/90-$DEPLOY_USER-nopasswd" >/dev/null
sudo chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER-nopasswd"
sudo visudo -cf "/etc/sudoers.d/90-$DEPLOY_USER-nopasswd"
```

## Local verification command

From the Codex machine, verify SSH and passwordless sudo with:

```bash
ssh -i /Users/swader/.ssh/codex-kvasyr-prod \
  -o BatchMode=yes \
  -o StrictHostKeyChecking=accept-new \
  swader@YOUR_HOST \
  'hostname && whoami && sudo -n true && echo sudo-ok'
```

## Server prerequisites

Install Bun for the deploy user if it is missing:

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
~/.bun/bin/bun --version
```

## App layout

Recommended checkout path:

```text
/var/www/meatbash
```

Repo app root:

```text
/var/www/meatbash
```

## First deploy

```bash
sudo mkdir -p /var/www
sudo chown -R swader:swader /var/www
cd /var/www
git clone https://github.com/Swader/meatbash.git meatbash
cd /var/www/meatbash
~/.bun/bin/bun install --frozen-lockfile
~/.bun/bin/bun run build
```

Install the systemd unit:

```bash
sudo cp /var/www/meatbash/deploy/meatbash.service /etc/systemd/system/meatbash.service
sudo cp /var/www/meatbash/deploy/meatbash-relay.service /etc/systemd/system/meatbash-relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now meatbash
sudo systemctl enable --now meatbash-relay
sudo systemctl restart meatbash
sudo systemctl restart meatbash-relay
sudo systemctl status --no-pager meatbash
sudo systemctl status --no-pager meatbash-relay
```

The unit starts `bun run serve`, which uses `src/prod-server.ts` to serve the
built `dist/` directory on `127.0.0.1:3010`.

`meatbash-relay.service` starts `bun run relay`, which exposes the room-code
websocket relay on `127.0.0.1:3011`.

Install the nginx vhost:

```bash
cat <<'EOF' | sudo tee /etc/nginx/sites-available/meatbash >/dev/null
server {
    server_name meatbash.bitfalls.com;

    location /ws {
        proxy_pass http://127.0.0.1:3011/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/meatbash /etc/nginx/sites-enabled/meatbash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d meatbash.bitfalls.com --non-interactive --agree-tos -m swader@bitfalls.com --redirect
```

## Update / redeploy

```bash
cd /var/www/meatbash
git fetch --all --prune
git pull --ff-only
~/.bun/bin/bun install --frozen-lockfile
~/.bun/bin/bun run build
sudo systemctl restart meatbash
sudo systemctl restart meatbash-relay
sudo systemctl status --no-pager meatbash
sudo systemctl status --no-pager meatbash-relay
```

## Logs and health checks

```bash
sudo journalctl -u meatbash -n 200 --no-pager
sudo journalctl -u meatbash -f
sudo journalctl -u meatbash-relay -n 200 --no-pager
sudo journalctl -u meatbash-relay -f
curl -I http://127.0.0.1:3010/
curl -I http://127.0.0.1:3011/
curl -I https://meatbash.bitfalls.com/
```

## Reverse proxy

Point `meatbash.bitfalls.com` at the Bun service, typically via nginx or
Caddy proxying to:

```text
http://127.0.0.1:3010        # app
ws://127.0.0.1:3011/ws      # relay
```

Keep TLS/proxy config outside this repo; the runtime should stay two plain Bun
systemd units behind the reverse proxy.
