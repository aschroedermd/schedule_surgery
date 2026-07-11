FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
ARG NODE_BUILD_HEAP_MB=192
RUN NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB}" npm run build:client

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["npm", "start"]
