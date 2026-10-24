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

# Compile Sass retro stylesheets to public/css/neogram.css
RUN npm run sass:build

# Set ownership to non-root node user and switch
RUN chown -R node:node /app

USER node

# Environment defaults
ENV NODE_ENV=production
ENV PORT=4000

# Health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start server using tsx
CMD ["npx", "tsx", "server/index.ts"]
