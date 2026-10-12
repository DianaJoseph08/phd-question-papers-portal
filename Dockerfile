FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install --omit=dev --build-from-source --no-audit --no-fund

COPY --chown=node:node . .

RUN mkdir -p /runtime/data/files /app/data/files \
    && chown -R node:node /app /runtime

USER node

EXPOSE 8080
CMD ["node", "server.js"]
