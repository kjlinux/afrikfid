FROM node:22-alpine

WORKDIR /app

# Dépendances
COPY package*.json ./
RUN npm ci --omit=dev

# Sources
COPY src/ ./src/
COPY .env.example .env.example

# Répertoire des données SQLite (monté en volume en production)
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 4001

# Node 22: SQLite expérimental requis
CMD ["node", "--experimental-sqlite", "src/index.js"]
