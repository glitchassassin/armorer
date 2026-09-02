FROM node:22-bookworm-slim

COPY . /app
WORKDIR /app

RUN npm ci

CMD ["npm", "run", "build"]
