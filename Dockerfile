# Production Dockerfile for Neogram Retro Workstation
FROM node:22-alpine AS runner

WORKDIR /app

# Install system dependencies needed for native modules (sharp, postgres)
RUN apk add --no-cache python3 make g++ libc6-compat

# Copy package descriptors
COPY package*.json ./

# Install production and build dependencies
RUN npm ci

# Copy application source code
COPY . .

# Compile Sass retro stylesheets to public/css/neogram.css, then drop build-only packages
# (sass, typescript, playwright, ...) so they don't ship in the runtime image.
RUN npm run sass:build && npm prune --omit=dev

# Ensure persistent runtime directories exist
RUN mkdir -p /app/dist/static-galleries /app/public/uploads /app/public/uploads/avatars /app/public/uploads/images /app/public/uploads/thumbs

# Only the runtime-writable directories belong to the non-root user. Application code and
# node_modules stay root-owned (read-only for `node`), so a compromised process cannot rewrite them.
# eleventy/src/_data is rewritten per build by the static generator.
RUN chown -R node:node /app/dist /app/public/uploads /app/eleventy/src/_data

USER node

# Environment defaults
ENV NODE_ENV=production
ENV PORT=4000

# Health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the server directly under node with the tsx loader (no npx / tsx CLI wrapper processes,
# which cost ~100MB of the container's memory budget).
CMD ["node", "--import", "tsx", "server/index.ts"]
