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

function normalizeTrack(item) {
  if (!item || !item.url) return null;
  return {
    id: item.id || null,
    title: item.title || 'Unknown title',
    artist: item.uploader || item.artist || null,
    url: item.webpage_url || item.url,
    thumbnail: item.thumbnail || null
  };
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
      const tracks = entries.map(normalizeTrack).filter(Boolean);
      res.json({ success: true, query: q, count: tracks.length, tracks });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] SoundCloud search error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to search SoundCloud' });
    }
  });

  router.get('/related', async (req, res) => {
    const { url } = req.query;
    const limit = parseLimit(req.query.limit, 10, 50);
    if (!isSoundCloudUrl(url)) {
      return res.status(400).json({ success: false, error: 'Missing or invalid SoundCloud url' });
    }

    try {
      const infoOutput = await runYtDlp(url, {
        noPlaylist: true,
        dumpSingleJson: true,
        skipDownload: true
      });
      const info = parseYtDlpJson(infoOutput);
      const artist = info.uploader || info.artist || '';
      const title = info.track || info.title || '';
      const query = `${artist} ${title}`.trim();
      if (!query) throw new Error('SoundCloud track has no searchable metadata');

      const searchOutput = await runYtDlp(`scsearch${Math.min(limit + 5, 50)}:${query}`, {
        flatPlaylist: true,
        dumpSingleJson: true
      });
      const payload = parseYtDlpJson(searchOutput);
      const currentId = info.id || null;
      const currentUrl = String(url).replace(/\/$/, '').toLowerCase();
      const tracks = (Array.isArray(payload.entries) ? payload.entries : [])
        .map(normalizeTrack)
        .filter((track) => track && track.id !== currentId && String(track.url).replace(/\/$/, '').toLowerCase() !== currentUrl)
        .slice(0, limit);

      res.json({
        success: true,
        source: { id: currentId, title: info.title || null, artist: artist || null, url },
        query,
        count: tracks.length,
        tracks
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] SoundCloud related error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to find related SoundCloud tracks' });
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
    let responseFinished = false;
    let ffmpegExited = false;
    let disconnectHandled = false;
    let forceKillTimer;
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
        ffmpegExited = true;
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (code !== 0 && !disconnectHandled) {
          console.error(
            `[${new Date().toISOString()}] SoundCloud ffmpeg exited with code ${code}, signal=${ffmpeg.signalCode || 'none'}`
          );
        }
        if (!res.writableEnded) res.end();
      });
      res.on('finish', () => {
        responseFinished = true;
      });
      res.on('close', () => {
        if (!responseFinished && !res.writableFinished && !ffmpegExited && ffmpeg && !ffmpeg.killed) {
          disconnectHandled = true;
          console.warn(`[${new Date().toISOString()}] SoundCloud client disconnected; stopping ffmpeg`);
          // Give ffmpeg a chance to close its input/output cleanly. This also
          // avoids reporting an expected client abort as an ffmpeg failure.
          ffmpeg.kill('SIGTERM');
          forceKillTimer = setTimeout(() => {
            if (!ffmpegExited && !ffmpeg.killed) ffmpeg.kill('SIGKILL');
          }, 2000);
          forceKillTimer.unref();
        }
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] SoundCloud stream error:`, error.message);
      if (ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGTERM');
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
