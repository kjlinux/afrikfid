FROM node:22-alpine

WORKDIR /app

# Dépendances
COPY package*.json ./
RUN npm ci --omit=dev

# Sources
COPY src/ ./src/
COPY .env.example .env.example

# Répertoire uploads KYC accessible en écriture par l'utilisateur node
RUN mkdir -p /app/uploads/kyc && chown -R node:node /app/uploads

USER node

EXPOSE 4001

CMD ["node", "src/index.js"]
