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
WIKI_FILE_STORE_PATH=/data/wiki-files

# Optional: only needed for scripts, MCP servers, or external tools.
ADMIN_API_KEY=<long random admin API key>
VIEWER_API_KEY=<long random viewer API key>

# Required for the default text assistant.
OPENAI_API_KEY=<OpenAI project API key>
CHAT_PROVIDER=openai
OPENAI_PRIMARY_MODEL=gpt-5.6-luna
OPENAI_FALLBACK_MODELS=gpt-5.6-terra

# Required for voice transcription and the optional OpenRouter text provider.
OPENROUTER_API_KEY=<OpenRouter API key>
CHAT_SETTINGS_PATH=/data/chat-settings.json
OPENROUTER_PRIMARY_MODEL=deepseek/deepseek-v4-flash
OPENROUTER_FALLBACK_MODELS=google/gemma-3-27b-it
OPENROUTER_TRANSCRIPTION_MODEL=nvidia/parakeet-tdt-0.6b-v3

# Required for spoken-response voices 1–5.
ELEVENLABS_API_KEY=<ElevenLabs API key>
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_VOICE_IDS=kSvMZug5ZFM9sKGpLAei,dWAnId3mzfl4fTszwtOG,0rEo3eAjssGDUCXHYENf,onwK4e9ZLuTAKqWW03F9,ia2hmHnWgMXcUgmY4yVU
CHAT_QUOTA_TIME_ZONE=America/New_York
```

`ADMIN_PASSWORD` is only used when the persistent browser-user store is first created. `SEED_USER_PASSWORD` is only used when resident-linked seeded users are created for the first time; users see the password-change screen on every login with that temporary password until they change it. The production compose file stores browser users and password hashes at `/data/users.json` and retained wiki reference files under `/data/wiki-files` in the persistent `planner-users` Docker volume, so rebuilds do not reset accounts, privileges, or downloadable wiki documents.

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

## Automatic Updates (Recommended)

The server can check `git@github.com:aschroedermd/schedule_surgery.git` on
`origin/main` every 15 seconds without depending on GitHub Actions credentials.
Install this after starting production successfully. This is an Ubuntu/systemd
service outside the application container, so replacing the app does not stop
its watcher. GitHub Actions may remain enabled for immediate push-triggered
updates; both paths share a server lock.

As root on the Droplet, from the checkout containing these scripts:

```bash
cd /opt/schedule_surgery
apt install -y python3 git
install -d -m 755 /usr/local/lib/schedule-surgery
install -m 644 scripts/deploy/update.py /usr/local/lib/schedule-surgery/update.py
# Back up an existing custom rebuild command before replacing it.
if [ -f /usr/local/bin/rebuild ]; then
  cp -p /usr/local/bin/rebuild /usr/local/bin/rebuild.before-auto-update
fi
install -m 755 scripts/deploy/rebuild /usr/local/bin/rebuild
# Create once; preserve your settings on subsequent installs.
if [ ! -f /etc/schedule-surgery-updater.json ]; then
  install -m 600 scripts/deploy/updater.example.json /etc/schedule-surgery-updater.json
fi
install -m 644 scripts/deploy/schedule-surgery-update.service /etc/systemd/system/
install -m 644 scripts/deploy/schedule-surgery-update.timer /etc/systemd/system/
```

Review `/etc/schedule-surgery-updater.json` for the actual checkout and secrets
file paths, remote and branch. Confirm `git -C /opt/schedule_surgery remote -v`
points to the intended repository. For a private repository, root needs its own
read-only GitHub deploy key and a verified GitHub host key in `/root/.ssh/known_hosts`.
The updater uses noninteractive SSH with strict host-key checking. Test fetch
as root before enabling the timer:

```bash
GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes' git -C /opt/schedule_surgery fetch --no-tags origin refs/heads/main
/usr/local/bin/rebuild
systemctl daemon-reload
systemctl enable --now schedule-surgery-update.timer
systemctl list-timers schedule-surgery-update.timer
journalctl -u schedule-surgery-update.service -n 100 --no-pager
```

The first rebuild verifies installation by building and deploying the current
remote tip. Use a recent Docker Compose plugin supporting `up --wait` and
`--wait-timeout`. If the existing stack was started with `-p CUSTOM_NAME`, add
`"project_name": "CUSTOM_NAME"` to the JSON configuration before the first run.
Otherwise the updater derives the original project's name from its Compose
configuration, preserving the named database/user volumes and network. It
requires one existing app container and refuses a project-name change after
its first successful deployment.

### Update behavior and recovery

- A check begins about every 15 seconds while idle (plus network latency).
  Build time is additional. Updates pushed during a build are picked up on the
  next check; the latest branch tip is fetched each time.
- A host lock serializes the timer, manual rebuilds, and GitHub Actions.
  Timer checks skip when busy; `/usr/local/bin/rebuild` waits and forces a build.
- Git source is archived into root-private release directories under
  `/var/lib/schedule-surgery-updater`. The checkout and `.env.production` are
  never reset, overwritten, or copied into a candidate. Tracked local edits are
  not included: production app changes must be pushed to the configured branch.
- A separate candidate image is built while the current app serves traffic.
  Build/fetch failure leaves it running. Activation recreates only `app` and
  waits for its health check. A failed activation restores the previous image
  and Compose configuration and returns failure. Successful SHA/source/project
  state is recorded atomically in `deployed.json` only after health succeeds.
- Failed commits are retried on the next tick; pushing a correction is detected
  automatically. Sources are bounded to the current/previous successful
  releases and the latest failed attempt. Docker build cache and old image tags
  require occasional disk maintenance; never prune volumes or the images
  needed for recovery. Logs appear in the system journal.
- The Postgres, browser-user/wiki files, and Caddy containers/volumes persist.
  Updating one app container causes a brief interruption; this is not a
  zero-downtime deployment. Back up data before database migrations: rollback
  restores app code/configuration, not database changes made by a newer app.
- Changes to the database, Caddy, host configuration, updater code or systemd
  units require explicit maintenance. The installed updater does not replace
  itself from Git. Repeat the install steps to update it. Do not run the old
  `git pull && compose up --build` path concurrently with this updater.

Check `journalctl` for rollback errors; a failed rollback needs operator action.
Stop automatic retries during investigation:

```bash
systemctl disable --now schedule-surgery-update.timer
# Wait for an already-running update to finish; disabling the timer does not kill it.
systemctl status schedule-surgery-update.service
```

Validate the updater locally with simulated Git/Docker lifecycle failures:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/deploy -p 'test_*.py'
docker compose --env-file .env.production.example -f docker-compose.production.yml config --quiet
```

These tests do not activate a real server; the initial server rebuild and
journal/HTTPS checks above are still needed to verify the installation.

For rsync-only installations, clone the GitHub repository first and point the
updater configuration at that checkout, or continue manual Compose rebuilds.

## Remote Deploys With GitHub Actions

The repository includes `.github/workflows/deploy-production.yml`. After the
one-time setup below (including installing the rebuild command in
[Automatic Updates](#automatic-updates-recommended)), every push to `main` runs the server's existing
`/usr/local/bin/rebuild` command from GitHub Actions. You can also run the
workflow manually in the **Actions** tab or invoke it from the GitHub API. No
public rebuild HTTP endpoint is added to the application.

### One-time server setup

Create a dedicated deployment user and allow it to run only the rebuild
command as root:

```bash
adduser --disabled-password --gecos '' deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
printf 'deploy ALL=(root) NOPASSWD: /usr/local/bin/rebuild\n' > /etc/sudoers.d/schedule-surgery-deploy
chmod 440 /etc/sudoers.d/schedule-surgery-deploy
visudo -cf /etc/sudoers.d/schedule-surgery-deploy
```

Ensure the repository and its Git working tree are usable by the command that
runs `rebuild`. If `/opt/schedule_surgery` is root-owned (the usual setup), the
restricted `sudo` rule above is sufficient. Keep `/usr/local/bin/rebuild`
root-owned and non-writable by `deploy`.

On the machine that will provide the private key (your computer is fine), make
a dedicated key pair:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/schedule-surgery-deploy -C 'schedule-surgery GitHub deploy'
```

Append the public-key line to `/home/deploy/.ssh/authorized_keys` on the
Droplet, then set safe permissions:

```bash
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
```

### GitHub configuration

In the repository's **Settings → Environments**, create an environment named
`production`. Add these environment variables:

```text
PRODUCTION_SSH_HOST=159.89.226.139
PRODUCTION_SSH_USER=deploy
```

Add these environment secrets:

```text
PRODUCTION_SSH_PRIVATE_KEY=<entire private key from ~/.ssh/schedule-surgery-deploy>
PRODUCTION_SSH_KNOWN_HOSTS=<the exact ssh-ed25519 host-key line for 159.89.226.139>
```

Obtain the host-key line while you are already connected to, or otherwise have
verified, the Droplet. For example, compare the displayed fingerprint against
the server before saving the output of:

```bash
ssh-keyscan -t ed25519 159.89.226.139
```

Do not replace `PRODUCTION_SSH_KNOWN_HOSTS` with an unchecked `ssh-keyscan`
inside the workflow; pinning the verified key prevents a man-in-the-middle
connection.

To trigger a rebuild programmatically, call GitHub's workflow-dispatch API
with a fine-grained personal access token that has **Actions: write** access to
this repository. Supply a unique request id so an API caller can find and
monitor the exact run it created:

```bash
curl --fail-with-body -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  https://api.github.com/repos/OWNER/REPO/actions/workflows/deploy-production.yml/dispatches \
  -d '{"ref":"main","inputs":{"request_id":"agent-20260902T120000Z"}}'
```

The request returns `200 OK` with the workflow run id and URLs when GitHub
accepts the deployment. That response does not mean the rebuild has succeeded;
its progress and rebuild output are available in the workflow run in GitHub
Actions. Agents should follow the correlation, polling, failure-handling, and
health-verification procedure in
[AGENT_API_GUIDE.md](AGENT_API_GUIDE.md#rebuild-and-deploy-the-production-server).

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
