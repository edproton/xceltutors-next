# Use the official Bun image
FROM oven/bun:1.0 as base
WORKDIR /app

# Install dependencies
COPY package.json bun.lockb ./
RUN bun install --production

# Copy application code
COPY . .

# If you need to run Prisma, uncomment these lines:
RUN bunx prisma generate
RUN bunx prisma migrate deploy

# Expose the port your app runs on
EXPOSE 3000

# Start the server
CMD ["bun", "src/index.ts"]