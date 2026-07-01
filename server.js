const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_TO = process.env.CONTACT_TO || 'studio@r3ydan.com';
// resend.dev is Resend's shared sandbox sender — works with no domain setup,
// but lands in spam more often. Verify your own domain in Resend and set
// RESEND_FROM (e.g. "R3ydan <studio@r3ydan.com>") once you're ready.
const FROM_ADDRESS = process.env.RESEND_FROM || 'R3ydan Website <onboarding@resend.dev>';
// Where to send visitors back to after the form posts here. Needed when this
// server only handles /api/contact and the site itself is hosted elsewhere
// (e.g. GitHub Pages) — a bare relative redirect would otherwise land on
// this server's own origin instead of the real site.
const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respondJSON(res, ok) {
  res.writeHead(ok ? 200 : 500, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify({ ok }));
}

async function handleContact(req, res) {
  try {
    const raw = await readBody(req);
    const params = new URLSearchParams(raw);
    const name = (params.get('name') || '').slice(0, 200).trim();
    const email = (params.get('email') || '').slice(0, 200).trim();
    const message = (params.get('message') || '').slice(0, 5000).trim();
    const honeypot = (params.get('_gotcha') || '').trim();

    // Bots fill every field, including ones hidden from real visitors. Pretend
    // success so they don't learn the honeypot was detected.
    if (honeypot) {
      respondJSON(res, true);
      return;
    }

    if (!name || !email || !message) {
      respondJSON(res, false);
      return;
    }

    if (!RESEND_API_KEY) {
      console.error('[contact] RESEND_API_KEY is not set in the environment — cannot send email.');
      respondJSON(res, false);
      return;
    }

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [CONTACT_TO],
        reply_to: email,
        subject: `New inquiry from ${name} — R3ydan website`,
        html:
          `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` +
          `<p><strong>Email:</strong> ${escapeHtml(email)}</p>` +
          `<p><strong>Message:</strong></p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`,
      }),
    });

    if (!resp.ok) {
      console.error('[contact] Resend API error:', resp.status, await resp.text());
      respondJSON(res, false);
      return;
    }

    respondJSON(res, true);
  } catch (err) {
    console.error('[contact] Unexpected error:', err);
    respondJSON(res, false);
  }
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (req.method === 'OPTIONS' && urlPath.startsWith('/api/')) {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  if (req.method === 'GET' && urlPath === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end('{"ok":true}');
    return;
  }
  if (req.method === 'POST' && urlPath === '/api/contact') {
    handleContact(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => console.log(`R3ydan website listening on port ${PORT}`));
