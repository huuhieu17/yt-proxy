const express = require('express');
const { spawn } = require('child_process');
const ytDlp = require('yt-dlp-exec');
const ffmpegPath = require('ffmpeg-static');
const { createYoutubeRouter } = require('./services/youtube');
const { createSoundCloudRouter } = require('./services/soundcloud');

const app = express();
const PORT = process.env.PORT || 3000;
const ytDlpRunner = process.env.YTDLP_BIN
  ? ytDlp.create(process.env.YTDLP_BIN)
  : ytDlp;

async function runYtDlp(url, flags = {}, timeout = 30000) {
  try {
    return await ytDlpRunner(url, flags, { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error('yt-dlp is unavailable. Run npm install to install dependencies.');
    }
    throw error;
  }
}

function getFfmpegCommand() {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  if (ffmpegPath) return ffmpegPath;
  throw new Error('ffmpeg is unavailable. Run npm install to install dependencies.');
}

function extractVideoId(input) {
  if (!input) return null;
  const value = String(input).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  try {
    const parsedUrl = new URL(value);
    const host = parsedUrl.hostname.toLowerCase();
    if (host.includes('youtu.be')) {
      const id = parsedUrl.pathname.replace('/', '').trim();
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    const id = parsedUrl.searchParams.get('v');
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function parseLimit(rawLimit, defaultValue = 10, max = 50) {
  const parsed = parseInt(rawLimit, 10);
  return Number.isNaN(parsed) ? defaultValue : Math.max(1, Math.min(parsed, max));
}

function parseBitrate(rawBitrate) {
  const value = String(rawBitrate || '192k').trim().toLowerCase();
  return /^\d{2,3}k$/.test(value) ? value : '192k';
}

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const routeDependencies = { runYtDlp, spawn, getFfmpegCommand, extractVideoId, parseLimit, parseBitrate };
app.use('/youtube', createYoutubeRouter(routeDependencies));
app.use('/soundcloud', createSoundCloudRouter(routeDependencies));
app.use('/', createYoutubeRouter(routeDependencies));

app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Steve Music API',
    services: { youtube: '/youtube', soundcloud: '/soundcloud' },
    endpoints: [
      '/youtube/search?q=song+name&limit=10',
      '/youtube/info?videoId=YOUTUBE_VIDEO_ID',
      '/youtube/play?videoId=YOUTUBE_VIDEO_ID&bitrate=192k',
      '/soundcloud/search?q=track+name&limit=10',
      '/soundcloud/related?url=SOUNDCLOUD_TRACK_URL&limit=10',
      '/soundcloud/info?url=SOUNDCLOUD_TRACK_URL',
      '/soundcloud/play?url=SOUNDCLOUD_TRACK_URL&bitrate=192k'
    ]
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Steve Music API running on port ${PORT}`);
});
