FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV HOST=0.0.0.0
ENV SECOND_PORT=7317
EXPOSE 7317

CMD ["npm", "start"]
