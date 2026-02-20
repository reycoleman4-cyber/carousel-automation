# Install fontconfig/fonts for Sharp text overlay and ffmpeg for video text overlay
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f -v

ENV FONTCONFIG_PATH=/etc/fonts
ENV FONTCONFIG_FILE=/etc/fonts/fonts.conf

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3721

CMD ["node", "server.js"]
