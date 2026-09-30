FROM node:20-bookworm-slim

# Installer FFmpeg et les outils nécessaires
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        ca-certificates \
        curl && \
    rm -rf /var/lib/apt/lists/*

# Installer yt-dlp
RUN curl -L \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Dossier de travail
WORKDIR /app

# Installer les dépendances Node
COPY package*.json ./
RUN npm ci --omit=dev

# Copier le reste du projet
COPY . .

# Port utilisé par Render
ENV PORT=10000

EXPOSE 10000

# Démarrer DownloadFlow
CMD ["npm", "start"]