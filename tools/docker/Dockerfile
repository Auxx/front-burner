# Front Burner's image: the one that is tested is the one that ships. CI builds
# it and scans it with Trivy (the `image` job of .github/workflows/ci.yml,
# NF-11.10); a local build uses the working tree as it is.
#
# Build from the workspace root (see README.md):
#   docker build -f tools/docker/Dockerfile -t front-burner:test .
#
# Add `--build-arg FRONT_BURNER_VERSION=1.4.2` to give the image a version
# other than package.json's.

ARG NODE_VERSION=24.22.1

# ---- build: the backend and the web client ----------------------------------
FROM node:${NODE_VERSION}-trixie AS build

ENV NX_DAEMON=false \
    NX_NO_CLOUD=true \
    NX_SKIP_NX_CACHE=true \
    HUSKY=0

WORKDIR /workspace

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .

# The instance's version (NF-7.6): a release build sets it from its tag; any
# other build keeps package.json's. Both builds below read package.json, so the
# backend and the web client always agree (A-8.7).
ARG FRONT_BURNER_VERSION=
RUN if [ -n "$FRONT_BURNER_VERSION" ]; then npm pkg set version="$FRONT_BURNER_VERSION"; fi

# The backend's build also writes a package.json and lockfile with only its
# runtime dependencies next to main.js. The chunk map, which the server reads
# to preload a route's chunks, is written from the build's metafile, which the
# image does not need (A-8.18); the web client's files are compressed once,
# here, and served as they are (A-7.9).
RUN npx nx run server:build:production \
    && npx nx run web:build:production \
    && node apps/web/scripts/chunk-map.mjs dist/apps/web \
    && rm dist/apps/web/browser-stats.json \
    && node apps/web/scripts/precompress.mjs dist/apps/web/browser

# ---- deps: the backend's production dependencies ----------------------------
FROM node:${NODE_VERSION}-trixie AS deps

WORKDIR /app
COPY --from=build /workspace/dist/apps/server/package.json /workspace/dist/apps/server/package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----------------------------------------------------------------
# Trixie ships git 2.47, the oldest version the backend accepts (A-5.7).
FROM node:${NODE_VERSION}-trixie-slim AS runtime

# The base image lags behind Debian's security updates, so its packages are
# upgraded too. The server needs Node.js alone at runtime (NF-11.11): the
# package managers that the Node.js image bundles (npm, corepack, yarn) are
# removed, as their own dependencies bring vulnerabilities into the image.
# tini is the container's PID 1 (plan 160): git's detached maintenance leaves
# its process to PID 1, and Node.js never reaps it, so without an init every
# fetch, merge and commit left a zombie until the pids limit stopped git.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends git openssh-client ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production \
    FRONT_BURNER_DATA_DIR=/data \
    FRONT_BURNER_PORT=8080

# The server finds the web client at ../web/browser, relative to main.js.
WORKDIR /app/server
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /workspace/dist/apps/server ./
COPY --from=build /workspace/dist/apps/web /app/web

# A fixed non-root UID (NF-5.6): the image's `node` user, 1000. A named volume
# mounted on /data takes this directory's owner.
RUN mkdir /data && chown node:node /data
USER 1000:1000
VOLUME /data

EXPOSE 8080

# The start can take a minute or more among many working copies, as recovery
# visits each one (NF-9.4; plan 152: 46 s among 2,500), so failed checks don't
# count for 5 minutes. Docker reports `healthy` at the first check that passes,
# even within that time, and checks every 2 s meanwhile, so that it comes soon
# after the instance is ready.
HEALTHCHECK --interval=10s --timeout=3s --start-period=300s --start-interval=2s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.FRONT_BURNER_PORT || 8080) + '/api/health/ready').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# tini passes SIGTERM on to the backend, which stops as NF-9.2 says, and exits
# with its exit code.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "main.js"]
