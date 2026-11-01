FROM node:26-trixie-slim AS native

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux /usr/local/bin/yt-dlp

# Keep native dependencies but leave distroless's glibc and its matching loader together.
RUN mkdir /runtime-libs && \
    dpkg-query -L libc6 | sed 's@^/lib/@/usr/lib/@' > /tmp/libc-files && \
    ldd /usr/bin/ffmpeg /usr/bin/ffprobe /usr/local/bin/yt-dlp | \
    awk '/=> \/(lib|usr\/lib)/ {print $3} /^\/(lib|usr\/lib)/ {print $1}' | \
    sed 's@^/lib/@/usr/lib/@' | grep -Fvx -f /tmp/libc-files | sort -u | xargs -r -I '{}' cp --parents --dereference '{}' /runtime-libs

FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:9b945e92c1b5463a4b75f11e8417515e4bea7355f6adfd79ec220fbbe905dda8

WORKDIR /app

ENV NODE_ENV=production
ENV HOME=/home/node
ENV XDG_CACHE_HOME=/tmp
# yt-dlp's JavaScript challenges resolve node through PATH.
ENV PATH=/nodejs/bin:/usr/local/bin:/usr/bin:/bin

COPY --from=native /runtime-libs/ /
COPY --from=native /usr/bin/ffmpeg /usr/bin/ffmpeg
COPY --from=native /usr/bin/ffprobe /usr/bin/ffprobe
COPY --from=native /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp
COPY dist ./dist

USER 1000:1000

CMD ["./dist/server.js"]
