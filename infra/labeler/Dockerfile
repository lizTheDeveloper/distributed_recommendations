# syntax=docker/dockerfile:1
# Moderation labeler (services/labeler). Build from the repo root:
#   docker compose -f infra/labeler/compose.yaml build
# The labeler imports packages/moderation, packages/bridge and packages/core by
# relative path, so those sources are copied at the same relative locations.
# The base image is pinned by digest (multi-arch index of node:22.22.0-alpine3.22,
# read from Docker Hub on 2026-10-19). Node 22.22 has node:sqlite built in.

FROM node:22.22.0-alpine3.22@sha256:7aa86fa052f6e4b101557ccb56717cb4311be1334381f526fe013418fe157384 AS deps
WORKDIR /app
COPY packages/moderation/package.json packages/moderation/package-lock.json packages/moderation/.npmrc packages/moderation/
COPY packages/bridge/package.json packages/bridge/package-lock.json packages/bridge/
COPY services/labeler/package.json services/labeler/package-lock.json services/labeler/.npmrc services/labeler/
# --ignore-scripts on every install (THREAT_MODEL T24); exact versions from the lockfiles.
RUN for d in packages/moderation packages/bridge services/labeler; do \
      (cd "$d" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund) || exit 1; \
    done

FROM node:22.22.0-alpine3.22@sha256:7aa86fa052f6e4b101557ccb56717cb4311be1334381f526fe013418fe157384
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY packages/core/src packages/core/src
COPY packages/moderation/src packages/moderation/src
COPY packages/bridge/src packages/bridge/src
COPY services/labeler/src services/labeler/src
RUN mkdir -p /data && chown node:node /data
USER node
WORKDIR /app/services/labeler
ENTRYPOINT ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=UNDICI-EHPA", "src/cli.ts"]
CMD ["--help"]
