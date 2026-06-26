# Always-on hosted build of Gooping with Friends.
# Players just open the public URL — no installer, no tunnel, no "host must stay open".
FROM node:20-alpine
WORKDIR /app

# Install only production deps (skips electron/electron-builder).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./
COPY src ./src
COPY public ./public

ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
