const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { handleApi } = require('./src/api');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname, parsedUrl.searchParams);
    }

    if (pathname === '/admin' || pathname === '/admin/') {
      return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'));
    }

    // Resolve static files safely inside PUBLIC_DIR
    const safeRelative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const fullPath = path.resolve(PUBLIC_DIR, safeRelative);

    if (!fullPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return serveFile(res, fullPath);
    }

    // SPA fallback for public routes
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  } catch (err) {
    if (err.message === 'PAYLOAD_TOO_LARGE') {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'ขนาดข้อมูลใหญ่เกินกำหนด' }));
      return;
    }
    if (err.message === 'INVALID_JSON') {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'รูปแบบข้อมูล JSON ไม่ถูกต้อง' }));
      return;
    }
    console.error('[Server Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Novel Reading Website running at http://${HOST}:${PORT}`);
  console.log(`Admin Panel (useradmin): http://${HOST}:${PORT}/admin`);
});
