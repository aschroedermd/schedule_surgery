# Security Notes

This repository is intended to be safe to store as a private GitHub repo and deploy to a private DigitalOcean Droplet.

## Do Commit

- Source code
- Docker deployment files
- Documentation
- `.env.example`
- `.env.production.example`

## Do Not Commit

- `.env`
- `.env.production`
- database backups or dumps
- real browser-user password stores
- real API keys
- real `APP_SECRET` or `POSTGRES_PASSWORD`

The `.gitignore` is configured to keep those files out of Git.

## Production Secrets

Set these only on the Droplet in `.env.production`:

- `POSTGRES_PASSWORD`
- `APP_SECRET`
- `ADMIN_PASSWORD`
- `USER_STORE_PATH`
- `ADMIN_API_KEY`
- `VIEWER_API_KEY`

Use long random values for the database password, app secret, and API keys. `ADMIN_PASSWORD` seeds the first persistent admin account only. Browser-user passwords are stored as hashes in `USER_STORE_PATH`; do not commit that file or copy it into chat. New-user creation and admin password resets can generate a temporary password that is shown once and should be shared directly with the intended user. Rotate API keys if they are pasted into a chat, ticket, or untrusted tool.

## GitHub And DigitalOcean

For a private GitHub repo, the Droplet should use either:

- a read-only GitHub deploy key for this repository, or
- your SSH key/agent during manual setup.

Do not put GitHub tokens in the repository. Do not expose Postgres port `5432` publicly. The production compose file keeps Postgres internal and exposes only Caddy on ports `80` and `443`.
