FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:9b945e92c1b5463a4b75f11e8417515e4bea7355f6adfd79ec220fbbe905dda8

WORKDIR /app

ENV NODE_ENV=production
ENV HOME=/home/node

COPY dist ./dist

USER 1000:1000

CMD ["./dist/server.js"]
