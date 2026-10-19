const { Router } = require('express');

function isSoundCloudUrl(input) {
  try {
    const host = new URL(String(input)).hostname.toLowerCase();
    return host === 'soundcloud.com' || host.endsWith('.soundcloud.com');
  } catch {
    return false;
  }
}

function parseYtDlpJson(output) {
  return typeof output === 'string' ? JSON.parse(output) : output;
}

function getSourceUrl(output) {
  if (typeof output !== 'string') {
    throw new Error('yt-dlp did not return a source URL');
  }

  const sourceUrl = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('http://') || line.startsWith('https://'))
    .pop();

  if (!sourceUrl) {
    throw new Error('Failed to resolve SoundCloud source audio URL');
  }

  return sourceUrl;
}

function createSoundCloudRouter({ runYtDlp, spawn, getFfmpegCommand, parseLimit, parseBitrate }) {
  const router = Router();

  router.get('/search', async (req, res) => {
    const { q } = req.query;
    const limit = parseLimit(req.query.limit, 10, 50);
    if (!q) return res.status(400).json({ success: false, error: 'Missing query parameter: q' });

    try {
      const stdout = await runYtDlp(`scsearch${limit}:${q}`, { flatPlaylist: true, dumpSingleJson: true });
      const payload = parseYtDlpJson(stdout);
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      const tracks = entries.map((item) => item && item.url ? {
        id: item.id || null,
        title: item.title || 'Unknown title',
        artist: item.uploader || item.artist || null,
        url: item.webpage_url || item.url,
        thumbnail: item.thumbnail || null
      } : null).filter(Boolean);
      res.json({ success: true, query: q, count: tracks.length, tracks });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] SoundCloud search error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to search SoundCloud' });
    }
  });

  router.get('/info', async (req, res) => {
    const { url } = req.query;
    if (!isSoundCloudUrl(url)) return res.status(400).json({ success: false, error: 'Missing or invalid SoundCloud url' });

    try {
      const stdout = await runYtDlp(url, { noPlaylist: true, dumpSingleJson: true, skipDownload: true });
      res.json({ success: true, info: parseYtDlpJson(stdout) });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] SoundCloud info error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to fetch SoundCloud track info' });
    }
  });

  router.get('/stream/mp3', async (req, res) => {
    const { url } = req.query;
    const bitrate = parseBitrate(req.query.bitrate);
    if (!isSoundCloudUrl(url)) return res.status(400).json({ success: false, error: 'Missing or invalid SoundCloud url' });

    let ffmpeg;
    try {
      const stdout = await runYtDlp(url, { f: 'bestaudio/best', noPlaylist: true, getUrl: true });
      const sourceUrl = getSourceUrl(stdout);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      ffmpeg = spawn(getFfmpegCommand(), [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', sourceUrl,
        '-vn',
        '-sn',
        '-dn',
        '-c:a', 'libmp3lame',
        '-b:a', bitrate,
        '-f', 'mp3',
        'pipe:1'
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on('data', (data) => {
        console.error(`[${new Date().toISOString()}] SoundCloud ffmpeg: ${data.toString().trim()}`);
      });
      ffmpeg.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] SoundCloud ffmpeg error:`, error.message);
        if (!res.headersSent) res.status(500).json({ success: false, error: 'Failed to start MP3 transcoder' });
        else res.end();
      });
      ffmpeg.on('close', (code) => {
        if (code !== 0) console.error(`[${new Date().toISOString()}] SoundCloud ffmpeg exited with code ${code}`);
        if (!res.writableEnded) res.end();
      });
      res.on('close', () => {
        if (!res.writableEnded && ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGKILL');
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] SoundCloud stream error:`, error.message);
      if (ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGKILL');
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Failed to stream MP3 from SoundCloud' });
    }
  });

  router.get('/play', async (req, res) => {
    const { url } = req.query;
    const bitrate = parseBitrate(req.query.bitrate);
    if (!isSoundCloudUrl(url)) return res.status(400).json({ success: false, error: 'Missing or invalid SoundCloud url' });

    try {
      const stdout = await runYtDlp(url, { noPlaylist: true, getTitle: true });
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      res.json({ success: true, title: stdout.trim().split('\n')[0] || 'Unknown title', url: `${baseUrl}/soundcloud/stream/mp3?url=${encodeURIComponent(url)}&bitrate=${encodeURIComponent(bitrate)}`, format: 'audio/mpeg', source: 'soundcloud', quality: `mp3-${bitrate}` });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] SoundCloud play error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to prepare SoundCloud play URL' });
    }
  });

  return router;
}

module.exports = { createSoundCloudRouter, isSoundCloudUrl };
