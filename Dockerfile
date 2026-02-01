# Minimal production image with yt-dlp + ffmpeg
FROM node:20-slim

WORKDIR /app

# System deps for yt-dlp/ffmpeg
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
  && pip3 install --no-cache-dir -U yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Install node deps first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# App source
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
