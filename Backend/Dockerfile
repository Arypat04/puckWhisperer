FROM node:20-alpine

WORKDIR /app

# Installs only the four packages server.js actually imports, rather than
# `npm install` off package.json (which also lists unrelated frontend deps
# - vite, react, react-dom - left over from an earlier folder merge).
RUN npm init -y && \
    npm pkg set type=module && \
    npm install express@5.1.0 cors@2.8.5 dotenv@17.2.0 mongodb@6.17.0

COPY server.js ./

EXPOSE 8080

CMD ["node", "server.js"]
