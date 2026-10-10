FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY --chown=node:node . .

RUN rm -rf node_modules \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm install --omit=dev --no-audit --no-fund \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /runtime/data/files /app/data/files \
    && chown -R node:node /app /runtime

USER node

EXPOSE 8080
CMD ["node", "server.js"]
