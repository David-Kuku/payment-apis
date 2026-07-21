# ── Development Dockerfile ────────────────────────────────────────────────────
# A single-stage image for local development. It installs dependencies INSIDE
# the image, so you never run `npm install` on your host again — you just
# rebuild this image when package.json changes. Code hot-reloads via a volume
# mount defined in docker-compose.yml (tsx watch).

FROM node:24-slim

# bcrypt is a NATIVE module. On brand-new Node versions a prebuilt binary may not
# exist, so npm compiles it from source — which needs these build tools. We
# install them, then clean the apt cache to keep the image smaller.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy ONLY the manifests first. Docker caches each layer, so as long as these
# files don't change, the (slow) npm install layer below is reused from cache —
# even when you edit your source code. Big speedup on rebuilds.
COPY package.json package-lock.json* ./
RUN npm install

# Copy the rest of the source (used for the initial image; live edits come from
# the volume mount at runtime).
COPY . .

EXPOSE 3000

# Default command: run the dev server with hot reload.
CMD ["npm", "run", "dev"]
