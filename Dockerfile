FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
ENV HOST=0.0.0.0 PORT=4173
EXPOSE 4173
USER node
CMD ["npm", "start"]
