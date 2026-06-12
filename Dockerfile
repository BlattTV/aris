# Standort-Analyse Deutschland – Container-Image
# Build:  docker build -t standort-analyse .
# Run:    docker run -d -p 8080:8080 -v sa-daten:/data standort-analyse
FROM node:20-alpine

# git nur für den optionalen Auto-Update-Modus (AUTO_UPDATE=1)
RUN apk add --no-cache git

WORKDIR /app
COPY . .

ENV PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:8080/api/status >/dev/null || exit 1

ENTRYPOINT ["/bin/sh", "/app/deploy/docker-entrypoint.sh"]
