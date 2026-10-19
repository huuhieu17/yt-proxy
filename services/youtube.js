const { Router } = require('express');

function parseYtDlpJson(output) {
  return typeof output === 'string' ? JSON.parse(output) : output;
}

function createYoutubeRouter({ runYtDlp, spawn, getFfmpegCommand, extractVideoId, parseLimit, parseBitrate }) {
  const router = Router();

  router.get('/info', async (req, res) => {
    const { videoId, url } = req.query;
    const resolvedVideoId = extractVideoId(videoId || url);

    if (!resolvedVideoId) {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid videoId/url. Example: /youtube/info?videoId=dQw4w9WgXcQ'
      });
    }

    try {
      const stdout = await runYtDlp(`https://www.youtube.com/watch?v=${resolvedVideoId}`, {
        noPlaylist: true,
        dumpSingleJson: true,
        skipDownload: true,
        extractorArgs: 'youtube:player_client=android'
      });

      res.json({ success: true, info: parseYtDlpJson(stdout) });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] YouTube info error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to fetch YouTube video info' });
    }
  });

  router.get('/search', async (req, res) => {
    const { q } = req.query;
    const limit = parseLimit(req.query.limit, 10, 50);

    if (!q) {
      return res.status(400).json({ success: false, error: 'Missing query parameter: q' });
    }

    try {
      const stdout = await runYtDlp(`ytsearch${limit}:${q}`, {
        flatPlaylist: true,
        dumpSingleJson: true,
        extractorArgs: 'youtube:player_client=android'
      });
      const payload = parseYtDlpJson(stdout);
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      const songs = entries.map((item) => {
        const id = item.id || item.url;
        return id ? {
          id,
          title: item.title || 'Unknown title',
          channel: item.uploader || item.channel || null,
          url: `https://www.youtube.com/watch?v=${id}`
        } : null;
      }).filter(Boolean);

      res.json({ success: true, query: q, count: songs.length, songs });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] YouTube search error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to search songs from YouTube' });
    }
  });

  router.get('/stream/mp3', async (req, res) => {
    const { videoId, url } = req.query;
    const bitrate = parseBitrate(req.query.bitrate);
    const resolvedVideoId = extractVideoId(videoId || url);

    if (!resolvedVideoId) {
      return res.status(400).json({ success: false, error: 'Missing or invalid videoId/url' });
    }

    let ffmpeg;
    try {
      const stdout = await runYtDlp(`https://www.youtube.com/watch?v=${resolvedVideoId}`, {
        f: 'bestaudio/best',
        noPlaylist: true,
        getUrl: true,
        extractorArgs: 'youtube:player_client=android'
      });
      const sourceUrl = stdout.trim().split('\n').pop();
      if (!sourceUrl || !sourceUrl.startsWith('http')) throw new Error('Failed to resolve source audio URL');

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      ffmpeg = spawn(getFfmpegCommand(), ['-i', sourceUrl, '-vn', '-acodec', 'libmp3lame', '-ab', bitrate, '-f', 'mp3', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on('data', (data) => console.error(`[${new Date().toISOString()}] ffmpeg: ${data}`));
      ffmpeg.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] ffmpeg error:`, error.message);
        if (!res.headersSent) res.status(500).json({ success: false, error: 'Failed to start MP3 transcoder' });
        else res.end();
      });
      ffmpeg.on('close', () => { if (!res.writableEnded) res.end(); });
      req.on('close', () => { if (ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGKILL'); });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] YouTube stream error:`, error.message);
      if (ffmpeg && !ffmpeg.killed) ffmpeg.kill('SIGKILL');
      if (!res.headersSent) res.status(500).json({ success: false, error: 'Failed to stream MP3 from YouTube' });
    }
  });

  router.get('/play', async (req, res) => {
    const { videoId, url } = req.query;
    const bitrate = parseBitrate(req.query.bitrate);
    const resolvedVideoId = extractVideoId(videoId || url);
    if (!resolvedVideoId) return res.status(400).json({ success: false, error: 'Missing or invalid videoId/url' });

    try {
      const stdout = await runYtDlp(`https://www.youtube.com/watch?v=${resolvedVideoId}`, {
        noPlaylist: true, getTitle: true, extractorArgs: 'youtube:player_client=android'
      });
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      res.json({ success: true, id: resolvedVideoId, title: stdout.trim().split('\n')[0] || 'Unknown title', url: `${baseUrl}/youtube/stream/mp3?videoId=${resolvedVideoId}&bitrate=${encodeURIComponent(bitrate)}`, format: 'audio/mpeg', source: 'youtube', quality: `mp3-${bitrate}` });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] YouTube play error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to prepare MP3 play URL' });
    }
  });

  router.get('/recommends', async (req, res) => {
    const { videoId, url } = req.query;
    const resolvedVideoId = extractVideoId(videoId || url);
    const limit = parseLimit(req.query.limit, 10, 50);
    if (!resolvedVideoId) return res.status(400).json({ success: false, error: 'Missing or invalid videoId/url' });

    try {
      const stdout = await runYtDlp(`https://www.youtube.com/watch?v=${resolvedVideoId}&list=RD${resolvedVideoId}`, {
        flatPlaylist: true, playlistEnd: limit + 1, dumpSingleJson: true, extractorArgs: 'youtube:player_client=android'
      });
      const payload = parseYtDlpJson(stdout);
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      const songs = entries.map((item) => {
        const id = item.id || item.url;
        return !id || id === resolvedVideoId ? null : { id, title: item.title || 'Unknown title', channel: item.uploader || item.channel || null, url: `https://www.youtube.com/watch?v=${id}` };
      }).filter(Boolean).slice(0, limit);
      res.json({ success: true, sourceVideoId: resolvedVideoId, count: songs.length, songs });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] YouTube recommends error:`, error.message);
      res.status(500).json({ success: false, error: 'Failed to fetch recommends from YouTube' });
    }
  });

  return router;
}

module.exports = { createYoutubeRouter };
