# glibc, because ONNX Runtime ships no musl binary.
FROM node:26-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux /usr/local/bin/yt-dlp

WORKDIR /app

ENV NODE_ENV=production

# The bundle leaves out ONNX Runtime and sharp, which load native binaries.
RUN npm install --no-save onnxruntime-node sharp && npm cache clean --force

COPY dist ./dist

USER node

CMD ["node", "./dist/server.js"]
