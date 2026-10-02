# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# The read-only deploy key and verified GitHub host keys exist only in this step.
RUN --mount=type=secret,id=source_ssh_key,required=true \
    --mount=type=secret,id=source_known_hosts,required=true \
    GIT_SSH_COMMAND='ssh -i /run/secrets/source_ssh_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/run/secrets/source_known_hosts' npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM deps AS production-deps
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY requirements-call-builder.txt ./
RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements-call-builder.txt
COPY package*.json ./
COPY --from=production-deps /app/node_modules ./node_modules
COPY src ./src
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["npm", "start"]
