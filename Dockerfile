# Build stage
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src/ ./src/

RUN npm run build

# Production stage
FROM node:20-bookworm-slim

# Install OrcaSlicer dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget ca-certificates libglib2.0-0 libgtk-3-0 libgl1 libglu1-mesa \
    libxrender1 libxkbcommon0 libfontconfig1 libfreetype6 \
    && rm -rf /var/lib/apt/lists/*

# Install OrcaSlicer CLI
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then \
      ORCA_URL="https://github.com/SoftFever/OrcaSlicer/releases/download/v2.2.0/OrcaSlicer_Linux_V2.2.0.tar.gz"; \
    else \
      ORCA_URL="https://github.com/SoftFever/OrcaSlicer/releases/download/v2.2.0/OrcaSlicer_Linux_V2.2.0.tar.gz"; \
    fi && \
    wget -q -O /tmp/orca.tar.gz "$ORCA_URL" && \
    mkdir -p /opt/orcaslicer && \
    tar -xzf /tmp/orca.tar.gz -C /opt/orcaslicer && \
    rm /tmp/orca.tar.gz && \
    ln -s /opt/orcaslicer/orca-slicer /usr/local/bin/orca-slicer || \
    ln -s /opt/orcaslicer/OrcaSlicer /usr/local/bin/orca-slicer || true

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY public/ ./public/
COPY profiles/ ./profiles/

EXPOSE 3000

CMD ["node", "dist/main"]
