FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:9b945e92c1b5463a4b75f11e8417515e4bea7355f6adfd79ec220fbbe905dda8 AS base

FROM base

WORKDIR /app/package

ENV NODE_ENV=production
ENV HOME=/home/node
ENV HOST=0.0.0.0
ENV XDG_CACHE_HOME=/tmp
ENV PATH=/app/package/bin:/nodejs/bin:/usr/bin:/bin

COPY --from=base --chown=1000:1000 /home/nonroot /home/node
ADD package.tgz /app/

USER 1000:1000

CMD ["./dist/server.js"]
