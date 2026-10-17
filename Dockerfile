FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json server/
COPY client/package.json client/package-lock.json client/

RUN npm install && npm --prefix server install && npm --prefix client install

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "start"]
