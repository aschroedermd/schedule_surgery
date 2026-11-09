# Publish the scheduling app to DigitalOcean

Push to GitHub for version tracking. From the checkout at the pushed main commit, run the publisher on the operator machine. A push alone does not publish. Both scheduling repository Actions workflows are manual.

```bash
export PLANNER_SSH_KEY="$HOME/.ssh/do_schedule_surgery"
export PLANNER_KNOWN_HOSTS="$PWD/.local/tester-deploy/production_known_hosts"
export PLANNER_SOURCE_KEY="$PWD/.local/tester-deploy/source_read_key"
export PLANNER_SOURCE_KNOWN_HOSTS="$PWD/.local/tester-deploy/github_known_hosts"
scripts/deploy/publish root@159.89.226.139
```

Use Node 22, the project's Python Call Builder environment, and an SSH login authorized to manage Docker on this droplet. The source key is used to fetch the pinned tester UI dependency. Keep these keys on the operator machine. For a new host, install the tracked `deploy/production/update.sh` as root-owned executable `/usr/local/bin/deploy-planner` and configure the production Compose project as described in the DigitalOcean and tester setup guides.

The publisher installs dependencies, runs the tests, and builds the client from an archive of the committed source. For ordinary app changes, it sends the compiled client and application source over SSH. Docker assembles them with the existing production runtime on the droplet. The direct release uses no GitHub-hosted build or image registry. The release lock checks the previous version before switching the app. The activator checks container health and rolls back if activation fails.

For changes to runtime dependencies or the Dockerfile, use `scripts/deploy/publish --full root@159.89.226.139` with a working Docker Buildx builder on the operator machine. This builds the complete Linux AMD64 image there and transfers it over SSH. Changes to production Compose, Caddy or host configuration require a separate explicit host update.

Verify the public app at https://schedule.andrewschroeder.org/ and https://schedule.andrewschroeder.org/api/healthz. On the droplet, `/opt/schedule_surgery/webapp-release.env` records the healthy image. The current and previous release remain available. To roll back, run the following on the droplet with the actual prior local image tag:

```bash
cd /opt/schedule_surgery
active_image=$(sed -n 's/^PLANNER_IMAGE=//p' webapp-release.env)
/usr/local/bin/deploy-planner "$prior_image" --local "$active_image"
```

Verify HTTPS after rollback.
