FROM node:24.15.0-bookworm-slim

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      fontconfig \
      fonts-dejavu-core \
      libreoffice-calc \
    && rm -rf /var/lib/apt/lists/* \
    && soffice --headless --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

USER node

EXPOSE 3001

CMD ["node", "server.js"]
