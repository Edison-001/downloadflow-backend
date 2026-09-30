FROM node:20-bookworm-slim

# Installer FFmpeg, Python et les outils nécessaires
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        ca-certificates \
        curl \
        unzip && \
    rm -rf /var/lib/apt/lists/*

# Installer Deno
RUN curl -fsSL https://deno.land/install.sh | sh

ENV DENO_INSTALL=/root/.deno
ENV PATH=/root/.deno/bin:$PATH

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

# Copier le projet
COPY . .

# Port Render
ENV PORT=10000

EXPOSE 10000

CMD ["npm", "start"]