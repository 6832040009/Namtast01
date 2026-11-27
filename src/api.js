const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { db, hashPassword, verifyPassword, getAllSettings, upsertSetting } = require('./db');

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    cookies[key] = val;
  }
  return cookies;
}

function getAuthenticatedAdmin(req) {
  const cookies = parseCookies(req);
  const token = cookies.admin_session;
  if (!token) return null;

  const session = db.prepare(`
    SELECT s.token, s.expires_at, a.id, a.username, a.display_name
    FROM sessions s
    JOIN admins a ON a.id = s.admin_id
    WHERE s.token = ?
  `).get(token);

  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return session;
}

function createSession(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, admin_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    adminId,
    expiresAt
  );
  return { token, expiresAt };
}

function slugify(text) {
  const base = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u0E00-\u0E7F-]/g, '');
  return base || `cat-${Date.now()}`;
}

function readJsonBody(req, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

async function handleApi(req, res, pathname, query) {
  const method = req.method;

  // ===================== PUBLIC ENDPOINTS (NO LOGIN REQUIRED) =====================

  if (method === 'GET' && pathname === '/api/site') {
    const settings = getAllSettings();
    const categories = db.prepare(`
      SELECT c.*, COUNT(CASE WHEN n.is_published = 1 THEN 1 END) AS novel_count
      FROM categories c
      LEFT JOIN novels n ON n.category_id = c.id
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.id ASC
    `).all();
    return sendJson(res, 200, { settings, categories });
  }

  if (method === 'GET' && pathname === '/api/novels') {
    const search = (query.get('search') || '').trim();
    const category = (query.get('category') || '').trim();
    const status = (query.get('status') || '').trim();
    const sort = (query.get('sort') || 'latest').trim();
    const featured = query.get('featured');

    const conditions = ['n.is_published = 1'];
    const params = [];

    if (search) {
      conditions.push('(n.title LIKE ? OR n.author LIKE ? OR n.synopsis LIKE ? OR n.tags LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (category) {
      if (/^\d+$/.test(category)) {
        conditions.push('n.category_id = ?');
        params.push(Number(category));
      } else {
        conditions.push('c.slug = ?');
        params.push(category);
      }
    }
    if (status && ['ongoing', 'completed', 'hiatus'].includes(status)) {
      conditions.push('n.status = ?');
      params.push(status);
    }
    if (featured === '1') {
      conditions.push('n.is_featured = 1');
    }

    let orderBy = 'n.updated_at DESC, n.id DESC';
    if (sort === 'popular') orderBy = 'n.views DESC, n.updated_at DESC';
    else if (sort === 'chapters') orderBy = 'chapter_count DESC, n.updated_at DESC';
    else if (sort === 'oldest') orderBy = 'n.created_at ASC';

    const sql = `
      SELECT n.*,
             c.name AS category_name,
             c.slug AS category_slug,
             COUNT(CASE WHEN ch.is_published = 1 THEN 1 END) AS chapter_count,
             MAX(CASE WHEN ch.is_published = 1 THEN ch.chapter_number END) AS latest_chapter_number
      FROM novels n
      LEFT JOIN categories c ON c.id = n.category_id
      LEFT JOIN chapters ch ON ch.novel_id = n.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY n.id
      ORDER BY ${orderBy}
    `;
    const novels = db.prepare(sql).all(...params);
    return sendJson(res, 200, { novels });
  }

  const novelMatch = pathname.match(/^\/api\/novels\/(\d+)$/);
  if (method === 'GET' && novelMatch) {
    const id = Number(novelMatch[1]);
    const novel = db.prepare(`
      SELECT n.*, c.name AS category_name, c.slug AS category_slug
      FROM novels n
      LEFT JOIN categories c ON c.id = n.category_id
      WHERE n.id = ? AND n.is_published = 1
    `).get(id);

    if (!novel) return sendJson(res, 404, { error: 'ไม่พบนิยายที่ต้องการ' });

    const chapters = db.prepare(`
      SELECT id, novel_id, chapter_number, title, views, created_at, updated_at
      FROM chapters
      WHERE novel_id = ? AND is_published = 1
      ORDER BY chapter_number ASC, id ASC
    `).all(id);

    return sendJson(res, 200, { novel, chapters });
  }

  const chapterMatch = pathname.match(/^\/api\/chapters\/(\d+)$/);
  if (method === 'GET' && chapterMatch) {
    const id = Number(chapterMatch[1]);
    const chapter = db.prepare(`
      SELECT ch.*, n.title AS novel_title, n.author AS novel_author, n.cover_url AS novel_cover_url
      FROM chapters ch
      JOIN novels n ON n.id = ch.novel_id
      WHERE ch.id = ? AND ch.is_published = 1 AND n.is_published = 1
    `).get(id);

    if (!chapter) return sendJson(res, 404, { error: 'ไม่พบตอนนิยายที่ต้องการ' });

    // Increment view counters
    db.prepare('UPDATE chapters SET views = views + 1 WHERE id = ?').run(id);
    db.prepare('UPDATE novels SET views = views + 1 WHERE id = ?').run(chapter.novel_id);
    chapter.views += 1;

    const allChapters = db.prepare(`
      SELECT id, chapter_number, title
      FROM chapters
      WHERE novel_id = ? AND is_published = 1
      ORDER BY chapter_number ASC, id ASC
    `).all(chapter.novel_id);

    const idx = allChapters.findIndex((c) => c.id === chapter.id);
    const prevChapter = idx > 0 ? allChapters[idx - 1] : null;
    const nextChapter = idx >= 0 && idx < allChapters.length - 1 ? allChapters[idx + 1] : null;

    return sendJson(res, 200, { chapter, prevChapter, nextChapter, chapters: allChapters });
  }

  // ===================== ADMIN AUTH ENDPOINTS =====================

  if (method === 'POST' && pathname === '/api/admin/login') {
    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (!username || !password) {
      return sendJson(res, 400, { error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return sendJson(res, 401, { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const { token } = createSession(admin.id);
    const cookie = `admin_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 3600}`;
    return sendJson(
      res,
      200,
      {
        admin: {
          id: admin.id,
          username: admin.username,
          display_name: admin.display_name
        }
      },
      { 'Set-Cookie': cookie }
    );
  }

  if (method === 'POST' && pathname === '/api/admin/logout') {
    const cookies = parseCookies(req);
    if (cookies.admin_session) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(cookies.admin_session);
    }
    return sendJson(
      res,
      200,
      { ok: true },
      { 'Set-Cookie': 'admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' }
    );
  }

  if (method === 'GET' && pathname === '/api/admin/me') {
    const admin = getAuthenticatedAdmin(req);
    if (!admin) return sendJson(res, 401, { authenticated: false });
    return sendJson(res, 200, {
      authenticated: true,
      admin: { id: admin.id, username: admin.username, display_name: admin.display_name }
    });
  }

  // ===================== PROTECTED ADMIN ENDPOINTS =====================

  if (pathname.startsWith('/api/admin/')) {
    const admin = getAuthenticatedAdmin(req);
    if (!admin) {
      return sendJson(res, 401, { error: 'กรุณาเข้าสู่ระบบผู้ดูแล (useradmin) ก่อนดำเนินการ' });
    }

    // Dashboard stats
    if (method === 'GET' && pathname === '/api/admin/dashboard') {
      const stats = {
        total_novels: db.prepare('SELECT COUNT(*) AS cnt FROM novels').get().cnt,
        published_novels: db.prepare('SELECT COUNT(*) AS cnt FROM novels WHERE is_published = 1').get().cnt,
        total_chapters: db.prepare('SELECT COUNT(*) AS cnt FROM chapters').get().cnt,
        total_categories: db.prepare('SELECT COUNT(*) AS cnt FROM categories').get().cnt,
        total_views: db.prepare('SELECT COALESCE(SUM(views), 0) AS total FROM novels').get().total
      };
      const recentNovels = db.prepare(`
        SELECT n.*, c.name AS category_name,
               COUNT(ch.id) AS chapter_count
        FROM novels n
        LEFT JOIN categories c ON c.id = n.category_id
        LEFT JOIN chapters ch ON ch.novel_id = n.id
        GROUP BY n.id
        ORDER BY n.updated_at DESC
        LIMIT 6
      `).all();
      return sendJson(res, 200, { stats, recentNovels });
    }

    // Admin list all novels (including drafts)
    if (method === 'GET' && pathname === '/api/admin/novels') {
      const novels = db.prepare(`
        SELECT n.*, c.name AS category_name,
               COUNT(ch.id) AS chapter_count
        FROM novels n
        LEFT JOIN categories c ON c.id = n.category_id
        LEFT JOIN chapters ch ON ch.novel_id = n.id
        GROUP BY n.id
        ORDER BY n.updated_at DESC, n.id DESC
      `).all();
      return sendJson(res, 200, { novels });
    }

    // Create novel
    if (method === 'POST' && pathname === '/api/admin/novels') {
      const body = await readJsonBody(req);
      const title = String(body.title || '').trim();
      const author = String(body.author || '').trim();
      if (!title || !author) {
        return sendJson(res, 400, { error: 'กรุณาระบุชื่อนิยายและนามปากกาผู้แต่ง' });
      }
      const categoryId = body.category_id ? Number(body.category_id) : null;
      const synopsis = String(body.synopsis || '').trim();
      const coverUrl = String(body.cover_url || '').trim() || '/covers/cover-magic.svg';
      const tags = String(body.tags || '').trim();
      const status = ['ongoing', 'completed', 'hiatus'].includes(body.status) ? body.status : 'ongoing';
      const isPublished = body.is_published === false || body.is_published === 0 ? 0 : 1;
      const isFeatured = body.is_featured ? 1 : 0;

      const result = db.prepare(`
        INSERT INTO novels (title, author, category_id, synopsis, cover_url, tags, status, is_published, is_featured)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(title, author, categoryId, synopsis, coverUrl, tags, status, isPublished, isFeatured);

      const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(Number(result.lastInsertRowid));
      return sendJson(res, 201, { novel });
    }

    // Update / Delete novel
    const adminNovelMatch = pathname.match(/^\/api\/admin\/novels\/(\d+)$/);
    if (adminNovelMatch) {
      const id = Number(adminNovelMatch[1]);
      if (method === 'PUT') {
        const existing = db.prepare('SELECT * FROM novels WHERE id = ?').get(id);
        if (!existing) return sendJson(res, 404, { error: 'ไม่พบนิยาย' });
        const body = await readJsonBody(req);
        const title = String(body.title ?? existing.title).trim();
        const author = String(body.author ?? existing.author).trim();
        if (!title || !author) {
          return sendJson(res, 400, { error: 'ชื่อนิยายและผู้แต่งห้ามว่าง' });
        }
        const categoryId = body.category_id === '' || body.category_id === null
          ? null
          : Number(body.category_id ?? existing.category_id);
        const synopsis = String(body.synopsis ?? existing.synopsis).trim();
        const coverUrl = String(body.cover_url ?? existing.cover_url).trim() || '/covers/cover-magic.svg';
        const tags = String(body.tags ?? existing.tags).trim();
        const status = ['ongoing', 'completed', 'hiatus'].includes(body.status) ? body.status : existing.status;
        const isPublished = body.is_published !== undefined ? (body.is_published ? 1 : 0) : existing.is_published;
        const isFeatured = body.is_featured !== undefined ? (body.is_featured ? 1 : 0) : existing.is_featured;

        db.prepare(`
          UPDATE novels
          SET title = ?, author = ?, category_id = ?, synopsis = ?, cover_url = ?, tags = ?,
              status = ?, is_published = ?, is_featured = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(title, author, categoryId, synopsis, coverUrl, tags, status, isPublished, isFeatured, id);

        const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(id);
        return sendJson(res, 200, { novel });
      }

      if (method === 'DELETE') {
        db.prepare('DELETE FROM novels WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    // List chapters of a novel (admin) & create chapter
    const adminNovelChaptersMatch = pathname.match(/^\/api\/admin\/novels\/(\d+)\/chapters$/);
    if (adminNovelChaptersMatch) {
      const novelId = Number(adminNovelChaptersMatch[1]);
      const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId);
      if (!novel) return sendJson(res, 404, { error: 'ไม่พบนิยาย' });

      if (method === 'GET') {
        const chapters = db.prepare(`
          SELECT * FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC, id ASC
        `).all(novelId);
        return sendJson(res, 200, { novel, chapters });
      }

      if (method === 'POST') {
        const body = await readJsonBody(req);
        const title = String(body.title || '').trim();
        const content = String(body.content || '').trim();
        if (!title || !content) {
          return sendJson(res, 400, { error: 'กรุณากรอกชื่อตอนและเนื้อหานิยาย' });
        }
        const maxRow = db.prepare('SELECT COALESCE(MAX(chapter_number), 0) AS m FROM chapters WHERE novel_id = ?').get(novelId);
        const chapterNumber = body.chapter_number ? Number(body.chapter_number) : maxRow.m + 1;
        const isPublished = body.is_published === false || body.is_published === 0 ? 0 : 1;

        const result = db.prepare(`
          INSERT INTO chapters (novel_id, chapter_number, title, content, is_published)
          VALUES (?, ?, ?, ?, ?)
        `).run(novelId, chapterNumber, title, content, isPublished);

        db.prepare(`UPDATE novels SET updated_at = datetime('now', 'localtime') WHERE id = ?`).run(novelId);

        const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(Number(result.lastInsertRowid));
        return sendJson(res, 201, { chapter });
      }
    }

    // Update / Delete specific chapter
    const adminChapterMatch = pathname.match(/^\/api\/admin\/chapters\/(\d+)$/);
    if (adminChapterMatch) {
      const id = Number(adminChapterMatch[1]);
      const existing = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id);
      if (!existing) return sendJson(res, 404, { error: 'ไม่พบตอนนิยาย' });

      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const title = String(body.title ?? existing.title).trim();
        const content = String(body.content ?? existing.content).trim();
        if (!title || !content) {
          return sendJson(res, 400, { error: 'ชื่อตอนและเนื้อหาห้ามว่าง' });
        }
        const chapterNumber = body.chapter_number !== undefined ? Number(body.chapter_number) : existing.chapter_number;
        const isPublished = body.is_published !== undefined ? (body.is_published ? 1 : 0) : existing.is_published;

        db.prepare(`
          UPDATE chapters
          SET chapter_number = ?, title = ?, content = ?, is_published = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `).run(chapterNumber, title, content, isPublished, id);

        db.prepare(`UPDATE novels SET updated_at = datetime('now', 'localtime') WHERE id = ?`).run(existing.novel_id);

        const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id);
        return sendJson(res, 200, { chapter });
      }

      if (method === 'DELETE') {
        db.prepare('DELETE FROM chapters WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    // Categories CRUD
    if (method === 'GET' && pathname === '/api/admin/categories') {
      const categories = db.prepare(`
        SELECT c.*, COUNT(n.id) AS novel_count
        FROM categories c
        LEFT JOIN novels n ON n.category_id = c.id
        GROUP BY c.id
        ORDER BY c.sort_order ASC, c.id ASC
      `).all();
      return sendJson(res, 200, { categories });
    }

    if (method === 'POST' && pathname === '/api/admin/categories') {
      const body = await readJsonBody(req);
      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'กรุณาระบุชื่อหมวดหมู่' });
      const slug = slugify(body.slug || name);
      const description = String(body.description || '').trim();
      const sortOrder = Number(body.sort_order || 0);

      try {
        const result = db.prepare(
          'INSERT INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)'
        ).run(name, slug, description, sortOrder);
        const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(result.lastInsertRowid));
        return sendJson(res, 201, { category });
      } catch {
        return sendJson(res, 409, { error: 'ชื่อหมวดหมู่หรือ slug นี้มีอยู่แล้ว' });
      }
    }

    const adminCatMatch = pathname.match(/^\/api\/admin\/categories\/(\d+)$/);
    if (adminCatMatch) {
      const id = Number(adminCatMatch[1]);
      if (method === 'PUT') {
        const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
        if (!existing) return sendJson(res, 404, { error: 'ไม่พบหมวดหมู่' });
        const body = await readJsonBody(req);
        const name = String(body.name ?? existing.name).trim();
        if (!name) return sendJson(res, 400, { error: 'ชื่อหมวดหมู่ห้ามว่าง' });
        const slug = slugify(body.slug || name);
        const description = String(body.description ?? existing.description).trim();
        const sortOrder = body.sort_order !== undefined ? Number(body.sort_order) : existing.sort_order;
        try {
          db.prepare(
            'UPDATE categories SET name = ?, slug = ?, description = ?, sort_order = ? WHERE id = ?'
          ).run(name, slug, description, sortOrder, id);
          const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
          return sendJson(res, 200, { category });
        } catch {
          return sendJson(res, 409, { error: 'ชื่อหมวดหมู่หรือ slug ซ้ำกับรายการอื่น' });
        }
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM categories WHERE id = ?').run(id);
        return sendJson(res, 200, { ok: true });
      }
    }

    // Site settings (Edit anything on the site)
    if (method === 'GET' && pathname === '/api/admin/settings') {
      return sendJson(res, 200, { settings: getAllSettings() });
    }

    if (method === 'PUT' && pathname === '/api/admin/settings') {
      const body = await readJsonBody(req);
      const allowedKeys = [
        'site_name',
        'site_tagline',
        'hero_title',
        'hero_subtitle',
        'announcement',
        'accent_color',
        'footer_text',
        'contact_info',
        'novels_per_page'
      ];
      for (const key of allowedKeys) {
        if (body[key] !== undefined) {
          upsertSetting(key, body[key]);
        }
      }
      return sendJson(res, 200, { settings: getAllSettings() });
    }

    // Upload cover image (base64 data URL)
    if (method === 'POST' && pathname === '/api/admin/upload') {
      const body = await readJsonBody(req, 6 * 1024 * 1024);
      const dataUrl = String(body.dataUrl || '');
      const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        return sendJson(res, 400, { error: 'รองรับเฉพาะไฟล์รูปภาพ PNG, JPG, WEBP หรือ GIF เท่านั้น' });
      }
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 4 * 1024 * 1024) {
        return sendJson(res, 400, { error: 'ไฟล์รูปภาพต้องมีขนาดไม่เกิน 4 MB' });
      }
      const filename = `cover-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
      return sendJson(res, 201, { url: `/uploads/${filename}` });
    }

    // Update admin profile / password
    if (method === 'PUT' && pathname === '/api/admin/account') {
      const body = await readJsonBody(req);
      const displayName = String(body.display_name || '').trim();
      const currentPassword = String(body.current_password || '');
      const newPassword = String(body.new_password || '');

      const adminRow = db.prepare('SELECT * FROM admins WHERE id = ?').get(admin.id);
      if (!adminRow) return sendJson(res, 404, { error: 'ไม่พบบัญชีผู้ใช้' });

      if (displayName) {
        db.prepare('UPDATE admins SET display_name = ? WHERE id = ?').run(displayName, admin.id);
      }

      if (newPassword) {
        if (!verifyPassword(currentPassword, adminRow.password_hash)) {
          return sendJson(res, 400, { error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
        }
        if (newPassword.length < 6) {
          return sendJson(res, 400, { error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' });
        }
        db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(
          hashPassword(newPassword),
          admin.id
        );
      }

      const updated = db.prepare('SELECT id, username, display_name FROM admins WHERE id = ?').get(admin.id);
      return sendJson(res, 200, { admin: updated });
    }
  }

  return sendJson(res, 404, { error: 'API endpoint not found' });
}

module.exports = { handleApi };
