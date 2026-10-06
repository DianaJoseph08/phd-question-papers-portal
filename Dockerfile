FROM node:20-slim

WORKDIR /app

# Install build essentials for native sqlite3 build
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code, database, and uploaded documents
COPY . .

# Cloud Run injects PORT environment variable (default 8080)
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
