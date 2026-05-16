FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4173
ENV DATABASE_PATH=/app/data/database.sqlite

RUN mkdir -p /app/data

EXPOSE 4173

CMD ["node", "server.js"]
