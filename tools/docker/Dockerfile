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
# runtime dependencies next to main.js.
RUN npx nx run server:build:production \
    && npx nx run web:build:production

# ---- deps: the backend's production dependencies ----------------------------
FROM node:${NODE_VERSION}-trixie AS deps

WORKDIR /app
COPY --from=build /workspace/dist/apps/server/package.json /workspace/dist/apps/server/package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----------------------------------------------------------------
# Trixie ships git 2.47, the oldest version the backend accepts (A-5.7).
FROM node:${NODE_VERSION}-trixie-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.FRONT_BURNER_PORT || 8080) + '/api/health/ready').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "main.js"]
