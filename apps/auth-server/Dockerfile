FROM node:26-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOME=/home/node

COPY dist ./dist

USER node

CMD ["node", "./dist/server.js"]
