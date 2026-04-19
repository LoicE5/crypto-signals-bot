FROM oven/bun:1-alpine

WORKDIR /app

# Install production dependencies first (layer caching)
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Copy only source files needed at runtime
COPY src/ ./src/
COPY tsconfig.json ./

# NDJSON output directory (mount a host volume here to persist across runs)
RUN mkdir -p ./output

CMD ["bun", "src/index.ts"]
