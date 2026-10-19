FROM node:18-slim AS dependencies

# Dependency stage: this is reused when only application source changes.
RUN apt-get update \
		&& apt-get install -y --no-install-recommends \
			ca-certificates \
			python3 \
			ffmpeg \
			wget \
		&& ln -sf /usr/bin/python3 /usr/local/bin/python \
		&& rm -rf /var/lib/apt/lists/*

RUN wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
		-O /usr/local/bin/yt-dlp \
		&& chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM dependencies AS app

WORKDIR /app
COPY . .

ENV PORT=7777

EXPOSE 7777

CMD ["node", "index.js"]
