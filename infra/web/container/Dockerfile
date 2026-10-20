# Builds apps/web and serves dist/ with nginx. Build context is the repository root:
#   docker build -f infra/web/container/Dockerfile .
# The tests run during the build, so a failing test fails the image.
FROM node:22.20.0-alpine AS build
ENV npm_config_audit=false npm_config_fund=false
WORKDIR /src
# apps/web imports several packages from source (scripts/build.mjs resolves their bare
# imports from apps/web/node_modules); only packages/match installs its own.
COPY packages packages
COPY apps/web apps/web
COPY apps/mobile/brand.json apps/mobile/brand.json
COPY curation curation
RUN node --test curation/test/*.test.mjs
RUN cd packages/match && npm ci --ignore-scripts
RUN cd apps/web && npm ci --ignore-scripts && npm test && npm run build

FROM nginx:1.29.2-alpine
COPY infra/web/container/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
