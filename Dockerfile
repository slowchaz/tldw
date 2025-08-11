# Use the official Node.js 18 image
FROM node:18-slim

# Install system dependencies required for yt-dlp
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp globally
RUN pip3 install --break-system-packages yt-dlp

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm globally and install dependencies
RUN npm install -g pnpm && pnpm install --no-frozen-lockfile

# Copy source code
COPY . .

# Create cookies directory
RUN mkdir -p /app/cookies

# Build the Next.js application
RUN pnpm build

# Expose the port that Next.js runs on
EXPOSE 3000

# Start the application
CMD ["pnpm", "start"]
