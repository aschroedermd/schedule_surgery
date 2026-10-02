# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# Read-only source-repo token exists only for this build step, never in a layer.
RUN --mount=type=secret,id=github_token,required=true \
    GIT_CONFIG_COUNT=3 GIT_CONFIG_KEY_0=credential.helper \
    GIT_CONFIG_KEY_1=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_1=ssh://git@github.com/ \
    GIT_CONFIG_KEY_2=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_2=git@github.com: \
    GIT_CONFIG_VALUE_0='!f() { echo username=x-access-token; printf "password="; cat /run/secrets/github_token; }; f' npm ci

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
