const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'novels.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL DEFAULT 'ผู้ดูแลระบบ',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS novels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category_id INTEGER,
      synopsis TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ongoing',
      is_published INTEGER NOT NULL DEFAULT 1,
      is_featured INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_published INTEGER NOT NULL DEFAULT 1,
      views INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_novels_category ON novels(category_id);
    CREATE INDEX IF NOT EXISTS idx_novels_updated ON novels(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_id, chapter_number);
  `);
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM site_settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

function upsertSetting(key, value) {
  db.prepare(
    `INSERT INTO site_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value ?? ''));
}

function seedIfEmpty() {
  // 1. Ensure default useradmin exists
  const adminCount = db.prepare('SELECT COUNT(*) AS cnt FROM admins').get().cnt;
  if (adminCount === 0) {
    db.prepare(
      'INSERT INTO admins (username, display_name, password_hash) VALUES (?, ?, ?)'
    ).run('useradmin', 'แอดมินหลัก', hashPassword('admin1234'));
  }

  // 2. Ensure default site settings exist
  const defaultSettings = {
    site_name: 'อักษราบุ๊ค',
    site_tagline: 'คลังนิยายออนไลน์ อ่านฟรีทุกเรื่อง ไม่ต้องล็อกอิน',
    hero_title: 'เปิดโลกแห่งจินตนาการ อ่านนิยายดีๆ ได้ทันที',
    hero_subtitle: 'รวมนิยายแฟนตาซี โรแมนติก กำลังภายใน และสืบสวนสอบสวน คัดสรรตอนใหม่อัปเดตทุกวัน อ่านสบายตาได้ทุกอุปกรณ์',
    announcement: 'ยินดีต้อนรับสู่ อักษราบุ๊ค! ผู้อ่านสามารถเลือกอ่านได้ทันทีโดยไม่ต้องสมัครสมาชิก',
    accent_color: '#b45309',
    footer_text: '© 2026 อักษราบุ๊ค — พื้นที่สำหรับคนรักการอ่านนิยายออนไลน์',
    contact_info: 'ติดต่อทีมงาน: admin@aksarabook.local',
    novels_per_page: '12'
  };

  for (const [k, v] of Object.entries(defaultSettings)) {
    const existing = db.prepare('SELECT 1 FROM site_settings WHERE key = ?').get(k);
    if (!existing) {
      upsertSetting(k, v);
    }
  }

  // 3. Seed categories if empty
  const catCount = db.prepare('SELECT COUNT(*) AS cnt FROM categories').get().cnt;
  if (catCount === 0) {
    const categories = [
      { name: 'แฟนตาซี', slug: 'fantasy', description: 'โลกเวทมนตร์ ดินแดนต่างมิติ และการผจญภัยเหนือจินตนาการ', sort_order: 1 },
      { name: 'โรแมนติก', slug: 'romance', description: 'เรื่องราวความรัก อบอุ่นหัวใจ และความผูกพัน', sort_order: 2 },
      { name: 'กำลังภายใน', slug: 'wuxia', description: 'ยุทธภพ วรยุทธ์ กระบี่ และศักดิ์ศรีแห่งจอมยุทธ์', sort_order: 3 },
      { name: 'สืบสวนสอบสวน', slug: 'mystery', description: 'ปริศนา คดีลึกลับ และการไขความจริงสุดระทึก', sort_order: 4 },
      { name: 'ไซไฟ', slug: 'scifi', description: 'อนาคต เทคโนโลยี อวกาศ และโลกเสมือน', sort_order: 5 },
      { name: 'เรื่องสั้น / ชีวิตประจำวัน', slug: 'slice-of-life', description: 'เรื่องราวละมุนใจ ใกล้ตัว อ่านเพลินในวันพักผ่อน', sort_order: 6 }
    ];
    const insertCat = db.prepare(
      'INSERT INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)'
    );
    for (const c of categories) {
      insertCat.run(c.name, c.slug, c.description, c.sort_order);
    }
  }

  // 4. Seed sample novels & chapters if empty
  const novelCount = db.prepare('SELECT COUNT(*) AS cnt FROM novels').get().cnt;
  if (novelCount === 0) {
    const catBySlug = (slug) => {
      const row = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
      return row ? row.id : null;
    };

    const insertNovel = db.prepare(`
      INSERT INTO novels (title, author, category_id, synopsis, cover_url, tags, status, is_published, is_featured, views)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    const insertChapter = db.prepare(`
      INSERT INTO chapters (novel_id, chapter_number, title, content, is_published, views)
      VALUES (?, ?, ?, ?, 1, ?)
    `);

    const sampleNovels = [
      {
        title: 'บันทึกร้านหนังสือต้องมนต์แห่งเมืองหมอก',
        author: 'จันทราสีคราม',
        categorySlug: 'fantasy',
        cover_url: '/covers/cover-magic.svg',
        tags: 'เวทมนตร์,ร้านหนังสือ,อบอุ่นหัวใจ,แฟนตาซี',
        status: 'ongoing',
        is_featured: 1,
        views: 1248,
        synopsis: 'ในตรอกเล็กๆ ที่แผนที่เมืองไม่เคยบันทึกไว้ มีร้านหนังสือไม้สักเก่าแก่ตั้งอยู่ใต้แสงโคมสีอำพัน หนังสือทุกเล่มบนชั้นไม่ได้มีไว้ขายด้วยเหรียญทอง แต่แลกเปลี่ยนด้วยความทรงจำที่เจ้าของอยากเก็บไว้ตลอดกาล คืนหนึ่ง "คีริน" ชายหนุ่มผู้สูญเสียความฝัน ได้ผลักประตูร้านเข้ามา และพบว่าชะตาของเมืองหมอกกำลังเปลี่ยนไปตลอดกาล',
        chapters: [
          {
            number: 1,
            title: 'เสียงกระดิ่งในคืนฝนโปรย',
            views: 640,
            content: `สายฝนเดือนพฤศจิกายนโปรยปรายลงบนทางเท้าหินกรวดของเมืองหมอก เสียงหยดน้ำกระทบหลังคาสังกะสีดังเป็นจังหวะสม่ำเสมอราวกับบทเพลงกล่อมยามค่ำคืน

คีรินกระชับเสื้อคลุมสีเทาหม่นให้แน่นขึ้น เขากำลังเดินลัดตรอกแคบหลังหอนาฬิกาเพื่อหนีลมหนาว ทว่าเมื่อเลี้ยวผ่านมุมกำแพงอิฐแดงที่คุ้นเคย แสงสีอำพันอบอุ่นกลับสาดส่องออกมาจากหน้าร้านที่ไม่เคยเห็นมาก่อน

ป้ายไม้โอ๊คแกะสลักด้วยตัวอักษรสีทองจางๆ เขียนไว้ว่า "หอสมุดอักษรต้องมนต์"

เขาชะงักฝีเท้า ก่อนจะเอื้อมมือผลักบานประตูไม้เข้าไป เสียงกระดิ่งทองเหลืองเหนือศีรษะดังกังวานใส กลิ่นกระดาษเก่า ผสมกลิ่นชาดอกคาโมมายล์และไม้สนอบอวลไปทั่วห้อง

"ยินดีต้อนรับครับ" เสียงทุ้มนุ่มดังขึ้นจากหลังเคาน์เตอร์ไม้ ชายชราสวมแว่นตากรอบกลมเงยหน้าขึ้นจากสมุดปกหนัง "ไม่ค่อยมีใครหาตรอกนี้เจอในคืนฝนตก... คุณคงกำลังตามหาบางอย่างที่ทำหล่นหายไปใช่ไหม?"

คีรินมองไปรอบชั้นหนังสือสูงจรดเพดาน หนังสือบางเล่มมีละอองแสงสีทองลอยอ้อยอิ่งอยู่รอบสันปก ราวกับกำลังหายใจอยู่เงียบๆ

"ผมแค่หลบฝนครับ" เขาตอบเสียงเบา "แต่... หนังสือพวกนั้นทำไมถึงเรืองแสงได้ล่ะครับ?"

ชายชรายิ้มอย่างใจดี แล้วหยิบหนังสือปกสีน้ำเงินเข้มเล่มหนึ่งวางลงบนเคาน์เตอร์ "เพราะหนังสือในร้านนี้ไม่ได้เขียนด้วยหมึกธรรมดา แต่เขียนด้วยความทรงจำของผู้คน... และเล่มนี้เพิ่งเรียกหาชื่อของคุณเมื่อครู่นี้เอง"`
          },
          {
            number: 2,
            title: 'หน้ากระดาษที่ว่างเปล่า',
            views: 428,
            content: `คีรินลังเลอยู่ครู่หนึ่งก่อนจะเปิดปกหนังสือสีน้ำเงินเข้มเล่มนั้นออก ทว่าสิ่งที่ปรากฏต่อสายตากลับมีเพียงหน้ากระดาษสีครีมว่างเปล่า ไม่มีตัวอักษรแม้แต่ตัวเดียว

"มันไม่มีอะไรเขียนอยู่เลยนะครับ" เขาเงยหน้ามองเจ้าของร้านด้วยความสงสัย

"ลองวางฝ่ามือลงบนหน้าแรกสิ" ชายชรากล่าวพลางรินชาร้อนใส่ถ้วยกระเบื้องเคลือบ "บางเรื่องราวจะไม่ปรากฏจนกว่าเจ้าของเรื่องจะยอมรับฟังเสียงในใจของตัวเอง"

คีรินทำตามอย่างว่าง่าย ทันทีที่ปลายนิ้วสัมผัสกระดาษ ความอบอุ่นสายหนึ่งแล่นผ่านฝ่ามือ เส้นหมึกสีทองค่อยๆ ผุดขึ้นทีละบรรทัด วาดเป็นภาพทุ่งหญ้ากว้างใหญ่ในวัยเด็กและเสียงหัวเราะที่เขาเกือบลืมไปแล้ว

"นี่มัน... ความฝันที่ผมเคยเขียนไว้ตอนอายุสิบสอง" ดวงตาของเขาเบิกกว้าง

"ทุกครั้งที่เมืองหมอกถูกปกคลุมด้วยความเร่งรีบ ความทรงจำสำคัญของผู้คนมักจะลอยมาพักพิงอยู่ที่นี่" เจ้าของร้านเลื่อนถ้วยชาให้เขา "และคืนนี้ ฉันต้องการผู้ช่วยหนึ่งคน เพื่อนำหนังสือที่หลงทางเหล่านี้กลับไปคืนเจ้าของ ก่อนที่หมอกสีเทาจะกลืนกินมันไปตลอดกาล"`
          }
        ]
      },
      {
        title: 'ใต้เงาจันทร์กลางร้านกาแฟ',
        author: 'พราวฟ้า',
        categorySlug: 'romance',
        cover_url: '/covers/cover-romance.svg',
        tags: 'โรแมนติก,ร้านกาแฟ,ฟีลกู๊ด,ความรัก',
        status: 'ongoing',
        is_featured: 1,
        views: 985,
        synopsis: '"ณิชา" นักวาดภาพประกอบฟรีแลนซ์ผู้หลงรักบรรยากาศยามค่ำคืน มักมานั่งวาดรูปที่มุมเดิมของร้านกาแฟเปิดดึกทุกวันศุกร์ จนวันหนึ่งบาริสต้าหนุ่มเงียบขรึมเจ้าของร้านอย่าง "ภีม" เริ่มวางโน้ตเล็กๆ พร้อมแก้วลาเต้ลายพิเศษไว้ข้างสมุดสเก็ตช์ของเธอ กลายเป็นบทสนทนาละมุนใจที่ค่อยๆ เชื่อมสองหัวใจเข้าหากัน',
        chapters: [
          {
            number: 1,
            title: 'ลาเต้แก้วที่เจ็ดในคืนวันศุกร์',
            views: 520,
            content: `เข็มนาฬิกาบนผนังอิฐของร้าน "จันทร์เสี้ยวคอฟฟี่" ชี้เวลาสามทุ่มตรง กลิ่นเมล็ดกาแฟคั่วกลางหอมกรุ่นคลอไปกับเสียงเปียโนแจ๊สแผ่วเบา

ณิชานั่งอยู่ที่โต๊ะริมกระจกตัวเดิม ตรงหน้ามีสมุดสเก็ตช์สีน้ำตาลและดินสอไม้ที่เหลาจนแหลม เธอขมวดคิ้วเล็กน้อยขณะพยายามร่างภาพฉากเมืองยามค่ำคืนสำหรับปกหนังสือลูกค้า

"อเมริกาโน่เย็นหวานน้อย... เปลี่ยนเป็นลาเต้ร้อนแทนนะครับ คืนนี้อากาศเย็น"

เสียงนุ่มทุ้มดังขึ้นข้างโต๊ะ แก้วเซรามิกสีขาวถูกวางลงอย่างเบามือ ด้านบนเป็นฟองนมรูปพระจันทร์เสี้ยวที่วาดได้อย่างประณีต พร้อมกระดาษโน้ตสีเหลืองแผ่นเล็กแปะอยู่ใต้จานรอง

ณิชาเงยหน้ามองภีม บาริสต้าหนุ่มในผ้ากันเปื้อนสีกรมท่าที่กำลังยิ้มมุมปากเล็กน้อย "ขอบคุณค่ะ แต่ฉันสั่งอเมริกาโน่ไปนี่คะ?"

"แก้วนี้ร้านเลี้ยงครับ เห็นคุณนั่งขมวดคิ้วมาตั้งแต่สองทุ่มแล้ว" พูดจบเขาก็หมุนตัวกลับไปหลังบาร์กาแฟ ทิ้งให้เธอหยิบกระดาษโน้ตแผ่นนั้นขึ้นมาอ่าน

บนกระดาษเขียนด้วยลายมือเรียบร้อยว่า "เส้นขอบฟ้าไม่จำเป็นต้องสมบูรณ์แบบในครั้งแรก พักจิบกาแฟก่อนนะ"`
          },
          {
            number: 2,
            title: 'สมุดสเก็ตช์ที่ลืมไว้',
            views: 365,
            content: `ฝนหลงฤดูตกลงมาตอนเกือบเที่ยงคืน ณิชารีบเก็บของใส่กระเป๋าผ้าเพราะกลัวจะเรียกรถกลับห้องไม่ทัน เธอโบกมือลาภีมจากหน้าประตูแล้ววิ่งฝ่าฝนไปยังป้ายรถเมล์

หลังจากร้านปิด ภีมเดินกลับมาเก็บแก้วที่โต๊ะริมกระจก ก่อนจะสะดุดตากับสมุดปกสีน้ำตาลเล่มบางที่ตกอยู่ใต้เก้าอี้

เขาหยิบมันขึ้นมาอย่างระมัดระวัง หน้ากระดาษที่คั่นไว้ด้วยใบไม้แห้งเปิดแง้มออกเล็กน้อย เผยให้เห็นภาพลายเส้นดินสอของชายหนุ่มคนหนึ่งกำลังชงกาแฟอยู่หลังเคาน์เตอร์ ใต้ภาพเขียนข้อความตัวเล็กๆ เอาไว้ว่า

"มุมที่สงบที่สุดในเมืองนี้"

ภีมยืนนิ่งอยู่ครู่หนึ่ง ก่อนจะยิ้มกว้างอย่างที่ไม่ค่อยได้ทำนัก เขาเก็บรักษาสมุดเล่มนั้นไว้อย่างดีในลิ้นชักหลังบาร์ รอคอยให้ถึงวันศุกร์หน้าเร็วกว่าทุกสัปดาห์ที่ผ่านมา`
          }
        ]
      },
      {
        title: 'กระบี่เมฆาไร้เงา',
        author: 'พยัคฆ์บูรพา',
        categorySlug: 'wuxia',
        cover_url: '/covers/cover-wuxia.svg',
        tags: 'กำลังภายใน,ยุทธภพ,กระบี่,ผจญภัย',
        status: 'ongoing',
        is_featured: 1,
        views: 1530,
        synopsis: 'สิบปีหลังจากสำนักเมฆาครามล่มสลายในคืนพายุหิมะ "หลินเฟิง" ศิษย์คนสุดท้ายผู้รอดชีวิตพร้อมคัมภีร์กระบี่ครึ่งเล่ม ก้าวออกจากหุบเขาลึกสู่ยุทธภพอันปั่นป่วน เพื่อตามหาความจริงเบื้องหลังการทรยศและพิสูจน์ว่าวิถีแห่งกระบี่ที่แท้จริงไม่ได้อยู่ที่ความโหดเหี้ยม แต่อยู่ที่หัวใจอันมั่นคง',
        chapters: [
          {
            number: 1,
            title: 'สุราจอกเดียวที่โรงเตี๊ยมชายแดน',
            views: 810,
            content: `ลมเหนือพัดหอบฝุ่นทรายซัดกระทบป้ายผ้าของโรงเตี๊ยมไผ่เขียว ภายในโรงเตี๊ยมคราคร่ำไปด้วยจอมยุทธ์จากหลายสำนักที่มุ่งหน้าสู่งานชุมนุมชาวยุทธ์ ณ หุบเขาหยกขาว

ที่มุมในสุดใกล้หน้าต่าง ชายหนุ่มในชุดผ้าป่านสีหม่นนั่งจิบชาเงียบๆ ข้างกายวางกระบี่ไม้ไผ่เก่าคร่ำคร่าไว้หนึ่งเล่ม ไม่มีใครคาดคิดว่าภายใต้ท่าทีสงบนิ่งนั้น คือผู้สืบทอดสายตรงเพียงคนเดียวของเพลงกระบี่เมฆาไร้เงา

"ได้ยินข่าวหรือยัง? ตราหยกของเจ้าสำนักเมฆาครามปรากฏขึ้นที่เมืองหลวงแล้ว!" เสียงชายร่างกำยำโต๊ะกลางดังขึ้น ทำเอาทั้งโรงเตี๊ยมเงียบกริบลงชั่วขณะ

ปลายนิ้วของหลินเฟิงที่จับถ้วยชาหยุดชะงัก แววตาสงบนิ่งพลันทอประกายคมกล้าราวคมกระบี่ที่เพิ่งชักออกจากฝัก

สิบปีแห่งการรอคอย... ในที่สุดเงื่อนงำแรกก็ปรากฏขึ้นแล้ว`
          },
          {
            number: 2,
            title: 'สามกระบวนท่าใต้แสงตะเกียง',
            views: 590,
            content: `ยามดึกสงัด เสียงฝีเท้าแผ่วเบาสี่สายเคลื่อนไหวบนหลังคาโรงเตี๊ยมราวกับนกนางแอ่น หลินเฟิงที่ยังไม่ได้หลับตาลืมตาขึ้นในความมืด มือคว้ากระบี่ไม้ไผ่ข้างหมอนไว้แน่น

บานหน้าต่างถูกผลักเปิดออกพร้อมประกายดาบเย็นเยียบที่พุ่งเข้าใส่ในชั่วพริบตา!

หลินเฟิงดีดตัวถอยหลังครึ่งก้าว กระบี่ไม้ไผ่ตวัดขึ้นเป็นวงโค้งอ่อนช้อยราวสายเมฆ พลังลมปราณบริสุทธิ์กระจายออกเป็นระลอก เบี่ยงคมดาบของมือสังหารให้พลาดเป้าไปกระแทกเสาไม้จนเกิดเสียงดังสนั่น

"เพลงกระบี่เมฆาไร้เงา! เจ้ายังมีชีวิตอยู่จริงๆ!" หัวหน้ากลุ่มชุดดำอุทานด้วยความตกใจ

หลินเฟิงชี้ปลายกระบี่ไม้ไผ่ไปข้างหน้า น้ำเสียงเยือกเย็น "บอกมาว่าใครส่งพวกเจ้ามา แล้วข้าจะไว้ชีวิต"`
          }
        ]
      },
      {
        title: 'คดีปริศนาหอนาฬิกาตาย',
        author: 'นักสืบเงา',
        categorySlug: 'mystery',
        cover_url: '/covers/cover-mystery.svg',
        tags: 'สืบสวน,ปริศนา,ระทึกขวัญ,หักมุม',
        status: 'completed',
        is_featured: 0,
        views: 742,
        synopsis: 'เมื่อนาฬิกาโบราณกลางคฤหาสน์ตระกูลอัครเดชหยุดเดินตรงเวลา 00:13 น. พร้อมกับการหายตัวไปของพินัยกรรมฉบับจริง นักสืบอิสระ "สารวัตรธนิน" มีเวลาเพียงหนึ่งคืนก่อนพายุจะสงบ เพื่อเปิดโปงความลับที่แขกทั้งเจ็ดคนในคฤหาสน์ต่างพยายามซ่อนเอาไว้',
        chapters: [
          {
            number: 1,
            title: 'เข็มนาฬิกาที่หยุดนิ่ง',
            views: 410,
            content: `เสียงฟ้าร้องคำรามก้องไปทั่วหุบเขา สะพานไม้ทางเข้าคฤหาสน์อัครเดชถูกน้ำป่าซัดขาดตั้งแต่หัวค่ำ ทำให้ทุกคนในบ้านหลังนี้ถูกตัดขาดจากโลกภายนอกโดยสมบูรณ์

ธนินยืนมองหน้าปัดนาฬิกาตั้งพื้นเรือนใหญ่กลางโถงบันได เข็มสั้นและเข็มยาวหยุดนิ่งอยู่ที่เวลาเที่ยงคืนสิบสามนาทีพอดี ราวกับถูกใครบางคนจงใจหยุดเวลาเอาไว้

"ห้องทำงานของคุณปู่ถูกล็อกจากด้านในครับ แต่ซองพินัยกรรมในตู้เซฟหายไปแล้ว!" ทนายความประจำตระกูลเอ่ยด้วยน้ำเสียงสั่นเครือ

ธนินก้มลงสังเกตรอยผงขี้เถ้าสีขาวจางๆ ที่ขอบพรมใกล้ตู้เซฟ ก่อนจะหันไปมองใบหน้าของแขกทั้งเจ็ดคนที่ยืนรวมกันอยู่ในห้องโถง

"ไม่มีห้องไหนที่ปิดตายได้จริงหรอกครับ... โดยเฉพาะเมื่อคนร้ายยังคงยืนอยู่กับเราในห้องนี้"`
          },
          {
            number: 2,
            title: 'เบาะแสหลังกระจกเงา (ตอนจบ)',
            views: 332,
            content: `หลังการสอบปากคำอย่างละเอียดนานกว่าสามชั่วโมง ธนินขอให้ทุกคนกลับมารวมตัวกันที่ห้องทำงานอีกครั้ง

"ทุกคนเชื่อว่านาฬิกาหยุดเดินตอนเที่ยงคืนสิบสามนาทีเพราะไฟดับใช่ไหมครับ?" ธนินเดินไปเปิดฝาหลังของนาฬิกาโบราณ "แต่นาฬิกาเรือนนี้เป็นระบบไขลาน มันไม่ได้ใช้ไฟฟ้า... คนร้ายจงใจเอาลิ่มไม้เล็กๆ ขัดเฟืองไว้เพื่อสร้างเวลาปลอมต่างหาก"

ห้องทั้งห้องเงียบสนิท ทันใดนั้นธนินก็ชี้ไปยังกรอบกระจกเงาบานใหญ่เหนือเตาผิง "และซองพินัยกรรมไม่ได้ถูกนำออกจากห้องนี้เลย มันถูกซ่อนไว้หลังกระจกตั้งแต่ตอนที่คนร้ายเข้ามาในห้องตอนสี่ทุ่ม ก่อนที่ทุกคนจะได้ยินเสียงล็อกประตูเสียอีก"

ความจริงถูกเปิดเผยพร้อมแสงอรุณแรกที่สาดส่องผ่านม่านฝน คดีปริศนาแห่งหอนาฬิกาตายจึงปิดฉากลงอย่างสมบูรณ์`
          }
        ]
      }
    ];

    for (const n of sampleNovels) {
      const result = insertNovel.run(
        n.title,
        n.author,
        catBySlug(n.categorySlug),
        n.synopsis,
        n.cover_url,
        n.tags,
        n.status,
        n.is_featured,
        n.views
      );
      const novelId = Number(result.lastInsertRowid);
      for (const ch of n.chapters) {
        insertChapter.run(novelId, ch.number, ch.title, ch.content, ch.views);
      }
    }
  }
}

createSchema();
seedIfEmpty();

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  getAllSettings,
  upsertSetting
};
