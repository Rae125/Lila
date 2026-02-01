const express = require('express');
const { execFile, spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const os = require('os');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static('public'));

function getCookiesArgs() {
  const cookiesFile = process.env.COOKIES_FILE;
  if (!cookiesFile) return { args: [], requiredMissing: false };
  if (!fs.existsSync(cookiesFile)) {
    return { args: [], requiredMissing: false };
  }
  return { args: ['--cookies', cookiesFile], requiredMissing: false };
}

function runYtDlp(args) {
  const cookies = getCookiesArgs();
  const baseArgs = [
    '--force-ipv4',
    '--extractor-args',
    'youtube:player_client=android,web'
  ];
  const finalArgs = cookies.args.length ? [...baseArgs, ...cookies.args, ...args] : [...baseArgs, ...args];
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', finalArgs, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const details = (stderr || stdout || err.message || '').toString();
        return reject(Object.assign(err, { details }));
      }
      resolve(stdout.toString());
    });
  });
}

function normalizeUrl(value) {
  if (!value) return '';
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
}

function sanitizeFilename(value) {
  return value
    .replace(/[^\x20-\x7E]+/g, '')
    .replace(/[<>:"/\\|?*]+/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function getHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch (_err) {
    return '';
  }
}

function isYouTubeUrl(value) {
  const host = getHostname(value);
  return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
}

function pickThumbnail(data) {
  if (!data || typeof data !== 'object') return '';
  if (data.thumbnail) return data.thumbnail;
  if (data.thumbnail_url) return data.thumbnail_url;
  if (data.og_image) return data.og_image;
  if (data.og_image_url) return data.og_image_url;
  if (data.image) return data.image;
  if (Array.isArray(data.thumbnails) && data.thumbnails.length) {
    const last = data.thumbnails[data.thumbnails.length - 1];
    return last && (last.url || last.src || '');
  }
  return '';
}

function assertYouTubeUrl(url, res) {
  const ok = isYouTubeUrl(url);
  if (!ok) {
    res.status(400).json({ ok: false, error: 'This endpoint is only for YouTube URLs.' });
  }
  return ok;
}

function streamRemoteImage(remoteUrl, res) {
  let parsed;
  try {
    parsed = new URL(remoteUrl);
  } catch (_err) {
    res.status(400).json({ ok: false, error: 'Invalid thumbnail URL.' });
    return;
  }

  const client = parsed.protocol === 'https:' ? https : http;
  const request = client.get(parsed, (upstream) => {
    if (upstream.statusCode && upstream.statusCode >= 400) {
      res.status(upstream.statusCode).end();
      upstream.resume();
      return;
    }
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    upstream.pipe(res);
  });

  request.on('error', () => {
    res.status(502).end();
  });
}

function streamYtDlpDownload(url, format, title, res, quality) {
  const safeTitle = sanitizeFilename(title || 'download') || 'download';
  const extension = format === 'mp3' ? 'mp3' : 'mp4';
  const filename = `${safeTitle}.${extension}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lilaloader-'));

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');

  const args = [
    '--force-ipv4',
    '--extractor-args',
    'youtube:player_client=android,web',
    '--no-playlist',
    '--no-cache-dir',
    '--no-part',
    '--paths',
    `temp:${tempDir}`,
    '--paths',
    `home:${tempDir}`,
    '-o',
    '-'
  ];
  const cookies = getCookiesArgs();
  if (cookies.args.length) {
    args.push(...cookies.args);
  }
  if (format === 'mp3') {
    args.push('-f', 'bestaudio', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    if (quality === '1080') {
      args.push('-f', 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best', '--merge-output-format', 'mp4');
    } else if (quality === '720') {
      args.push('-f', 'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best', '--merge-output-format', 'mp4');
    } else {
      args.push('-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4');
    }
  }
  args.push(url);

  const child = spawn('yt-dlp', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TMP: tempDir,
      TEMP: tempDir
    }
  });

  const cleanup = () => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_err) {
      // Best effort cleanup only.
    }
  };

  res.on('close', () => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
    cleanup();
  });

  child.stdout.pipe(res);

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'Failed to start yt-dlp.' });
    } else {
      res.end();
    }
    cleanup();
  });

  child.on('close', (code) => {
    if (code !== 0) {
      if (!res.headersSent) {
      console.error('yt-dlp download failed:', stderr.trim());
        res.status(500).json({ ok: false, error: 'yt-dlp failed.', details: stderr.trim() });
      } else {
        res.end();
      }
    }
    cleanup();
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

async function handlePreview(req, res) {
  const url = normalizeUrl(req.body && req.body.url);
  if (!url) {
    return res.status(400).json({ ok: false, error: 'Provide a valid http(s) URL.' });
  }
  if (!assertYouTubeUrl(url, res)) {
    return;
  }

  try {
    const stdout = await runYtDlp(['-J', '--no-playlist', url]);
    const data = JSON.parse(stdout);
    const thumbnail = pickThumbnail(data);
    const avatar = data.uploader_avatar || data.uploader_thumbnail || data.channel_avatar || '';

    res.json({
      ok: true,
      info: {
        title: data.title || 'Untitled',
        uploader: data.uploader || data.channel || data.uploader_id || '',
        thumbnail,
        avatar,
        extractor: data.extractor_key || data.extractor || '',
        webpage_url: data.webpage_url || url
      }
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
    console.error('yt-dlp preview failed:', err.details || err.message || err);
      error: 'yt-dlp failed to read this URL.',
      details: (err.details || err.message || '').toString().trim()
    });
  }
}

app.post('/api/preview', (req, res) => handlePreview(req, res));
app.post('/api/youtube/preview', (req, res) => handlePreview(req, res));

async function handleProfile(req, res) {
  const url = normalizeUrl(req.query && req.query.url);
  if (!url) {
    return res.status(400).json({ ok: false, error: 'Provide a valid http(s) URL.' });
  }
  if (!assertYouTubeUrl(url, res)) {
    return;
  }

  try {
    const stdout = await runYtDlp(['-J', '--no-playlist', url]);
    const data = JSON.parse(stdout);
    const avatar = data.uploader_avatar || data.uploader_thumbnail || data.channel_avatar || '';
    res.json({
      ok: true,
      profile: {
        uploader: data.uploader || data.channel || data.uploader_id || '',
        avatar
      }
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'yt-dlp failed to read profile data.',
      details: (err.details || err.message || '').toString().trim()
    });
  }
}

app.get('/api/profile', (req, res) => handleProfile(req, res));
app.get('/api/youtube/profile', (req, res) => handleProfile(req, res));

app.post('/api/direct', async (req, res) => {
  const url = normalizeUrl(req.body && req.body.url);
  const format = (req.body && req.body.format) === 'mp3' ? 'mp3' : 'mp4';
  if (!url) {
    return res.status(400).json({ ok: false, error: 'Provide a valid http(s) URL.' });
  }

  const formatArg = format === 'mp3'
    ? 'bestaudio[ext=mp3]/bestaudio'
    : 'best[ext=mp4]/best';

  try {
    const stdout = await runYtDlp(['-g', '-f', formatArg, '--no-playlist', url]);
    const directUrl = stdout.split(/\r?\n/).filter(Boolean)[0];
    if (!directUrl) {
      return res.status(500).json({ ok: false, error: 'No direct URL returned by yt-dlp.' });
    }

    res.json({
      ok: true,
      directUrl,
      formatUsed: format,
      note: format === 'mp3'
        ? 'MP3 is only available when the source provides it. Otherwise you may get the original audio format.'
        : ''
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'yt-dlp failed to resolve a direct media URL.',
      details: (err.details || err.message || '').toString().trim()
    });
  }
});

app.get('/api/thumbnail', (req, res) => {
  const url = normalizeUrl(req.query && req.query.url);
  if (!url) {
    return res.status(400).json({ ok: false, error: 'Provide a valid http(s) URL.' });
  }
  streamRemoteImage(url, res);
});

function handleDownload(req, res) {
  const url = normalizeUrl(req.query && req.query.url);
  const format = req.query && req.query.format === 'mp3' ? 'mp3' : 'mp4';
  const quality = req.query && typeof req.query.quality === 'string' ? req.query.quality : 'best';
  const title = req.query && req.query.title ? String(req.query.title) : 'download';

  if (!url) {
    return res.status(400).json({ ok: false, error: 'Provide a valid http(s) URL.' });
  }
  if (!assertYouTubeUrl(url, res)) {
    return;
  }

  streamYtDlpDownload(url, format, title, res, quality);
}

app.get('/api/download', (req, res) => handleDownload(req, res));
app.get('/api/youtube/download', (req, res) => handleDownload(req, res));

app.listen(port, () => {
  console.log(`Lilaloader running on http://localhost:${port}`);
});
