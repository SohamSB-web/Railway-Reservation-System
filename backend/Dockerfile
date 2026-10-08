# Node.js Alpine base image for production-ready lightweight container
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy dependency specifications
COPY package.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy source code and data folders
COPY src ./src

# Expose backend REST & WebSocket port
EXPOSE 5000

# Set production environment
ENV NODE_ENV=production
ENV PORT=5000

# Start RTRS backend server
CMD ["node", "src/server.js"]
