FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY main.js ./
COPY templates ./templates

# Env comes from Coolify Environment Variables — no .env in image.
CMD ["node", "main.js"]
