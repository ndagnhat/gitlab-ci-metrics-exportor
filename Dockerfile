FROM node:20-alpine

WORKDIR /app

# Install production dependencies first to leverage Docker layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

ENV NODE_ENV=production
ENV PORT=9252
EXPOSE 9252

# Writable directory for the optional metrics persistence snapshot
# (set PERSISTENCE_PATH=/data/state.json and mount a volume here).
# Group-owned by root with group write so it also works on platforms
# (e.g. OpenShift) that run the container as an arbitrary UID in group 0.
RUN mkdir -p /data && chown node:0 /data && chmod g+rwX /data
VOLUME /data

USER node

HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9252)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
