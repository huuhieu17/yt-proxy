const express = require('express');
const { spawn } = require('child_process');
const ytDlp = require('yt-dlp-exec');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 3000;

async function runYtDlp(url, flags = {}, timeout = 30000) {
  try {
    return await ytDlp(url, flags, {
      timeout,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.message.includes('yt-dlp'))) {
      throw new Error('yt-dlp is unavailable. Run npm install to install dependencies.');
    }

    throw error;
  }
}

function getFfmpegCommand() {
  if (ffmpegPath) {
    return ffmpegPath;
  }

  throw new Error('ffmpeg is unavailable. Run npm install to install dependencies.');
}

function extractVideoId(input) {
  if (!input) {
    return null;
  }

  const value = String(input).trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) {
    return value;
  }

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
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  return Math.max(1, Math.min(parsed, max));
}

function parseBitrate(rawBitrate) {
  const value = String(rawBitrate || '192k').trim().toLowerCase();
  return /^\d{2,3}k$/.test(value) ? value : '192k';
}

// CORS for ESP32
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Xiaozhi Music API',
    endpoints: [
      '/search?q=song+name&limit=10',
      '/play?videoId=YOUTUBE_VIDEO_ID&bitrate=192k',
      '/stream/mp3?videoId=YOUTUBE_VIDEO_ID&bitrate=192k',
      '/recommends?videoId=YOUTUBE_VIDEO_ID&limit=10'
    ]
  });
});

// Search endpoint (return list of songs by query)
app.get('/search', async (req, res) => {
  const { q } = req.query;
  const limit = parseLimit(req.query.limit, 10, 50);

  if (!q) {
    return res.status(400).json({
      success: false,
      error: 'Missing query parameter: q'
    });
  }

  try {
    console.log(`[${new Date().toISOString()}] Searching list: ${q}, limit=${limit}`);

    const stdout = await runYtDlp(`ytsearch${limit}:${q}`, {
      flatPlaylist: true,
      dumpSingleJson: true,
      extractorArgs: 'youtube:player_client=android'
    });

    const payload = JSON.parse(stdout);
    const entries = Array.isArray(payload.entries) ? payload.entries : [];

    const songs = entries
      .map((item) => {
        const id = item.id || item.url;
        if (!id) {
          return null;
        }

        return {
          id,
          title: item.title || 'Unknown title',
          channel: item.uploader || item.channel || null,
          url: `https://www.youtube.com/watch?v=${id}`
        };
      })
      .filter(Boolean);

    res.json({
      success: true,
      query: q,
      count: songs.length,
      songs
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Search error:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to search songs from YouTube'
    });
  }
});

// Stream MP3 endpoint
app.get('/stream/mp3', async (req, res) => {
  const { videoId, url } = req.query;
  const bitrate = parseBitrate(req.query.bitrate);
  const resolvedVideoId = extractVideoId(videoId || url);

  if (!resolvedVideoId) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid videoId/url. Example: /stream/mp3?videoId=dQw4w9WgXcQ'
    });
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${resolvedVideoId}`;
    const stdout = await runYtDlp(videoUrl, {
      f: 'bestaudio/best',
      noPlaylist: true,
      getUrl: true,
      extractorArgs: 'youtube:player_client=android'
    });

    const sourceUrl = stdout.trim().split('\n').pop();
    if (!sourceUrl || !sourceUrl.startsWith('http')) {
      throw new Error('Failed to resolve source audio URL');
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');

    const ffmpeg = spawn(
      getFfmpegCommand(),
      ['-i', sourceUrl, '-vn', '-acodec', 'libmp3lame', '-ab', bitrate, '-f', 'mp3', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    ffmpeg.stdout.pipe(res);

    ffmpeg.on('error', (err) => {
      console.error(`[${new Date().toISOString()}] ffmpeg spawn error:`, err.message);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to start MP3 transcoder' });
      } else {
        res.end();
      }
    });

    ffmpeg.on('close', () => {
      if (!res.writableEnded) {
        res.end();
      }
    });

    req.on('close', () => {
      if (!ffmpeg.killed) {
        ffmpeg.kill('SIGKILL');
      }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] stream/mp3 error:`, error.message);
    const errorMessage = String(error.message || '');
    const isFfmpegMissing = errorMessage.includes('ffmpeg is unavailable');
    const isUnavailable =
      errorMessage.includes('This video is not available') ||
      errorMessage.includes('Video unavailable') ||
      errorMessage.includes('Private video') ||
      errorMessage.includes('Sign in to confirm your age');

    res.status(500).json({
      success: false,
      error: isFfmpegMissing
        ? 'MP3 transcoder is unavailable on server'
        : isUnavailable
          ? 'Video is unavailable or restricted on YouTube'
          : 'Failed to stream MP3 from YouTube'
    });
  }
});

// Play endpoint (returns MP3 URL)
app.get('/play', async (req, res) => {
  const { videoId, url } = req.query;
  const bitrate = parseBitrate(req.query.bitrate);
  const resolvedVideoId = extractVideoId(videoId || url);

  if (!resolvedVideoId) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid videoId/url. Example: /play?videoId=dQw4w9WgXcQ'
    });
  }

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${resolvedVideoId}`;
    const stdout = await runYtDlp(videoUrl, {
      noPlaylist: true,
      getTitle: true,
      extractorArgs: 'youtube:player_client=android'
    });

    const title = stdout.trim().split('\n')[0] || 'Unknown title';
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const mp3Url = `${baseUrl}/stream/mp3?videoId=${encodeURIComponent(resolvedVideoId)}&bitrate=${encodeURIComponent(bitrate)}`;

    res.json({
      success: true,
      id: resolvedVideoId,
      title,
      url: mp3Url,
      format: 'audio/mpeg',
      source: 'youtube',
      quality: `mp3-${bitrate}`
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Play error:`, error.message);
    const errorMessage = String(error.message || '');
    const isUnavailable =
      errorMessage.includes('This video is not available') ||
      errorMessage.includes('Video unavailable') ||
      errorMessage.includes('Private video') ||
      errorMessage.includes('Sign in to confirm your age');

    res.status(500).json({
      success: false,
      error: isUnavailable
        ? 'Video is unavailable or restricted on YouTube'
        : 'Failed to prepare MP3 play URL'
    });
  }
});

// Recommends endpoint
app.get('/recommends', async (req, res) => {
  const { videoId, url } = req.query;
  const resolvedVideoId = extractVideoId(videoId || url);
  const limit = parseLimit(req.query.limit, 10, 50);

  if (!resolvedVideoId) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid videoId/url. Example: /recommends?videoId=dQw4w9WgXcQ'
    });
  }

  try {
    console.log(`[${new Date().toISOString()}] Recommends for: ${resolvedVideoId}`);

    const mixUrl = `https://www.youtube.com/watch?v=${resolvedVideoId}&list=RD${resolvedVideoId}`;
    const stdout = await runYtDlp(mixUrl, {
      flatPlaylist: true,
      playlistEnd: limit + 1,
      dumpSingleJson: true,
      extractorArgs: 'youtube:player_client=android'
    });

    const playlist = JSON.parse(stdout);
    const entries = Array.isArray(playlist.entries) ? playlist.entries : [];

    const recommends = entries
      .map((item) => {
        const id = item.id || item.url;
        if (!id || id === resolvedVideoId) {
          return null;
        }

        return {
          id,
          title: item.title || 'Unknown title',
          channel: item.uploader || item.channel || null,
          url: `https://www.youtube.com/watch?v=${id}`
        };
      })
      .filter(Boolean)
      .slice(0, limit);

    res.json({
      success: true,
      sourceVideoId: resolvedVideoId,
      count: recommends.length,
      songs: recommends
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Recommends error:`, error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recommends from YouTube'
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Xiaozhi Music API running on port ${PORT}`);
});
