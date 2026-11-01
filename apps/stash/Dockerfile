FROM node:26-trixie-slim AS native

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux /usr/local/bin/yt-dlp

WORKDIR /app

# The bundle leaves out ONNX Runtime and sharp. Whisper needs only the target CPU binaries, not CUDA or other platforms.
RUN ONNXRUNTIME_NODE_INSTALL=skip npm install --no-save onnxruntime-node sharp && \
    npm cache clean --force && \
    rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin node_modules/onnxruntime-node/bin/napi-v6/win32 && \
    find node_modules/onnxruntime-node/bin/napi-v6/linux -mindepth 1 -maxdepth 1 ! -name "$(node -p 'process.arch')" -exec rm -rf {} +

# Keep the native media tools' shared libraries, not apt, npm, or their build environment.
RUN mkdir /runtime-libs && \
    { ldd /usr/bin/ffmpeg /usr/bin/ffprobe /usr/local/bin/yt-dlp; find node_modules -type f \( -name '*.node' -o -name '*.so*' \) -exec ldd {} \;; } | \
    awk '/=> \/(lib|usr\/lib)/ {print $3} /^\/(lib|usr\/lib)/ {print $1}' | \
    sed 's@^/lib/@/usr/lib/@' | sort -u | xargs -r -I '{}' cp --parents --dereference '{}' /runtime-libs

FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:9b945e92c1b5463a4b75f11e8417515e4bea7355f6adfd79ec220fbbe905dda8

WORKDIR /app

ENV NODE_ENV=production
ENV HOME=/home/node
ENV PATH=/nodejs/bin:/usr/local/bin:/usr/bin:/bin

COPY --from=native /runtime-libs/ /
COPY --from=native /usr/bin/ffmpeg /usr/bin/ffmpeg
COPY --from=native /usr/bin/ffprobe /usr/bin/ffprobe
COPY --from=native /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
COPY --from=native /app/node_modules ./node_modules
COPY dist ./dist

USER 1000:1000

CMD ["./dist/server.js"]
