# DigitalOcean Deployment

This deployment is designed for a small private group: roughly 20 total users and fewer than 10 concurrent users.

Recommended setup: one small Ubuntu Droplet running Docker Compose with:

- App container
- Postgres container with a persistent Docker volume
- Caddy container for HTTPS

## What You Need In DigitalOcean

1. Create a Droplet.
   - Image: Ubuntu 24.04 LTS
   - Size: Basic shared CPU is fine. 1 GB RAM works; 2 GB is more comfortable.
   - Authentication: SSH key
2. Optional but recommended: create a domain or subdomain.
   - Example: `schedule.yourdomain.com`
   - Add an `A` record pointing to the Droplet public IP.
3. Firewall:
   - Allow SSH `22` from your IP if possible.
   - Allow HTTP `80`.
   - Allow HTTPS `443`.
   - Do not expose Postgres `5432`.

## Server Setup

SSH into the Droplet:

```bash
ssh root@YOUR_DROPLET_IP
```

Install Docker:

```bash
apt update
apt install -y ca-certificates curl git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Set a basic firewall:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## Put The App On The Droplet

If the project is in a GitHub repo:

```bash
git clone YOUR_REPO_URL /opt/schedule_surgery
cd /opt/schedule_surgery
```

If not, upload it from your Mac:

```bash
rsync -av --exclude node_modules --exclude dist --exclude .env /Users/aws/Code/schedule_surgery/ root@YOUR_DROPLET_IP:/opt/schedule_surgery/
ssh root@YOUR_DROPLET_IP
cd /opt/schedule_surgery
```

## Create Production Secrets

On the Droplet:

```bash
cp .env.production.example .env.production
```

Generate secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Edit `.env.production`:

```bash
nano .env.production
```

Set:

```text
APP_DOMAIN=schedule.yourdomain.com
PUBLIC_BASE_URL=https://schedule.yourdomain.com

POSTGRES_PASSWORD=<long random password>
APP_SECRET=<long random secret>

ADMIN_PASSWORD=<initial admin login password>
SEED_USER_PASSWORD=<optional temporary seeded-resident password>
USER_STORE_PATH=/data/users.json

# Optional: only needed for scripts, MCP servers, or external tools.
ADMIN_API_KEY=<long random admin API key>
VIEWER_API_KEY=<long random viewer API key>
```

`ADMIN_PASSWORD` is only used when the persistent browser-user store is first created. `SEED_USER_PASSWORD` is only used when resident-linked seeded users are created for the first time; users see the password-change screen on every login with that temporary password until they change it. The production compose file stores browser users and password hashes in the `planner-users` Docker volume at `/data/users.json`, so rebuilds do not reset changed passwords or privileges.

If you do not have a domain yet, change the `Caddyfile` first line from `{$APP_DOMAIN}` to `:80`, set:

```text
APP_DOMAIN=:80
PUBLIC_BASE_URL=http://YOUR_DROPLET_IP
```

HTTPS requires a real domain pointing to the Droplet.

## Start Production

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

Check status:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl -I https://schedule.yourdomain.com/api/healthz
```

Open:

```text
https://schedule.yourdomain.com
```

API docs:

```text
https://schedule.yourdomain.com/api/docs
https://schedule.yourdomain.com/api/openapi.json
```

## Move Your Current Local Data To The Droplet

On your Mac, from `/Users/aws/Code/schedule_surgery`:

```bash
docker compose exec -T db pg_dump -U planner -d surgery_schedule > planner-backup.sql
scp planner-backup.sql root@YOUR_DROPLET_IP:/opt/schedule_surgery/planner-backup.sql
```

On the Droplet:

```bash
cd /opt/schedule_surgery
docker compose --env-file .env.production -f docker-compose.production.yml exec -T db psql -U planner -d surgery_schedule < planner-backup.sql
docker compose --env-file .env.production -f docker-compose.production.yml restart app
```

## Updating Later

If using Git:

```bash
cd /opt/schedule_surgery
git pull
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

If using rsync, upload the project again and run the same compose command.

## Backups

Manual backup:

```bash
docker compose --env-file .env.production -f docker-compose.production.yml exec -T db pg_dump -U planner -d surgery_schedule > planner-backup-$(date +%Y%m%d).sql
```

Copy backup off the Droplet:

```bash
scp root@YOUR_DROPLET_IP:/opt/schedule_surgery/planner-backup-YYYYMMDD.sql .
```

## Operational Notes

- This setup is intentionally small and simple.
- Postgres is not exposed publicly.
- Caddy handles HTTPS.
- The app stores no PHI by design.
- Keep `.env.production` private.
- API keys are optional. If you use them for scripts or external tools, rotate them if they are pasted into the wrong place.
