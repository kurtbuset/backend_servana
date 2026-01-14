FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

COPY .env ./

EXPOSE 5000

CMD ["npm", "start"]
