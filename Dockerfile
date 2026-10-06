FROM node:22-slim

WORKDIR /app

# Install compilation tools for native SQLite
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy dependency definition
COPY package*.json ./

# Build sqlite3 directly from source against this container's GLIBC
RUN npm install --production --build-from-source=sqlite3

# Copy application files
COPY . .

# Set Cloud Run port
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
