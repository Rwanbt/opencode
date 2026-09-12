# Dockerfile pour Unifia Workbench v1.0.0
# Build: docker build -t unifia:latest .
# Run: docker run -it --rm unifia --help

FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/unifia/package.json packages/unifia/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN bun run build

# === Runtime stage ===
FROM oven/bun:1.3-alpine AS runtime

WORKDIR /app

# Install runtime deps only
RUN apk add --no-cache git curl bash

# Copy built artifacts
COPY --from=builder /app/packages/contracts/dist /app/packages/contracts/dist
COPY --from=builder /app/packages/unifia/bin /app/bin
COPY --from=builder /app/scripts /app/scripts

# Make scripts executable
RUN chmod +x /app/scripts/*.sh /app/scripts/*.cmd 2>/dev/null || true

# Add to PATH
ENV PATH="/app/bin:${PATH}"

# Verify
RUN /app/scripts/unifia-verify.sh --version 2>&1 || true

# Default command : run the doctor (validate install)
# Override with: docker run unifia unifia-migrate.sh --dry-run
ENTRYPOINT ["/app/scripts/unifia-doctor.sh"]
CMD ["--json"]
