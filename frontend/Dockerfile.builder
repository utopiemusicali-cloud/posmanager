# Dockerfile usato solo per la build in produzione.
# Costruisce il React app e scrive i file in /app/dist (montato come volume).
FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json* ./
RUN npm install --silent
COPY . .
RUN npm run build

# Stage finale: copia i file compilati nel volume e termina
FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/dist ./dist
CMD ["sh", "-c", "cp -r /app/dist/. /output/ && echo 'Frontend build copiato nel volume.'"]
