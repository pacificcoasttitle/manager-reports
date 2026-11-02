FROM node:24.15.0-bookworm-slim

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      fontconfig \
      fonts-dejavu-core \
      libreoffice-calc \
      unzip \
    && rm -rf /var/lib/apt/lists/* \
    && soffice --headless --version

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server.js ./

USER node

EXPOSE 8080

CMD ["node", "server.js"]
