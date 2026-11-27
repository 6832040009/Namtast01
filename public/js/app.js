(() => {
  const state = {
    settings: {},
    categories: [],
    novels: [],
    selectedCategory: '',
    search: '',
    sort: 'latest',
    statusFilter: '',
    view: 'home', // 'home' | 'bookmarks' | 'novel' | 'reader'
    currentNovel: null,
    currentChapters: [],
    currentChapterData: null,
    chapterOrderAsc: true,
    readerPrefs: loadReaderPrefs()
  };

  const appRoot = document.getElementById('appRoot');
  const progressTrack = document.getElementById('readingProgressTrack');
  const progressBar = document.getElementById('readingProgressBar');

  function loadReaderPrefs() {
    try {
      return {
        theme: 'light',
        fontSize: 19,
        fontFamily: 'sans',
        ...JSON.parse(localStorage.getItem('novel_reader_prefs') || '{}')
      };
    } catch {
      return { theme: 'light', fontSize: 19, fontFamily: 'sans' };
    }
  }

  function saveReaderPrefs() {
    localStorage.setItem('novel_reader_prefs', JSON.stringify(state.readerPrefs));
  }

  function getBookmarks() {
    try {
      return JSON.parse(localStorage.getItem('novel_bookmarks') || '[]');
    } catch {
      return [];
    }
  }

  function toggleBookmark(novelId) {
    const id = Number(novelId);
    const list = getBookmarks();
    const idx = list.indexOf(id);
    if (idx >= 0) list.splice(idx, 1);
    else list.unshift(id);
    localStorage.setItem('novel_bookmarks', JSON.stringify(list));
    updateBookmarkCount();
    return idx === -1;
  }

  function isBookmarked(novelId) {
    return getBookmarks().includes(Number(novelId));
  }

  function updateBookmarkCount() {
    const el = document.getElementById('bookmarkCount');
    if (el) el.textContent = String(getBookmarks().length);
  }

  function getReadingHistory() {
    try {
      return JSON.parse(localStorage.getItem('novel_history') || '{}');
    } catch {
      return {};
    }
  }

  function saveReadingHistory(novelId, novelTitle, chapterId, chapterNumber, chapterTitle) {
    const history = getReadingHistory();
    history[String(novelId)] = {
      novelId: Number(novelId),
      novelTitle,
      chapterId: Number(chapterId),
      chapterNumber,
      chapterTitle,
      updatedAt: Date.now()
    };
    localStorage.setItem('novel_history', JSON.stringify(history));
  }

  function getLatestReadEntry() {
    const entries = Object.values(getReadingHistory());
    if (!entries.length) return null;
    entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return entries[0];
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusLabel(status) {
    if (status === 'completed') return 'จบแล้ว';
    if (status === 'hiatus') return 'พักอัปเดต';
    return 'ยังไม่จบ';
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString('th-TH');
  }

  function applySiteSettings() {
    const s = state.settings;
    if (s.accent_color) {
      document.documentElement.style.setProperty('--accent', s.accent_color);
    }
    const siteName = s.site_name || 'อักษราบุ๊ค';
    document.title = `${siteName} — ${s.site_tagline || 'อ่านนิยายออนไลน์'}`;
    document.getElementById('siteName').textContent = siteName;
    document.getElementById('siteTagline').textContent = s.site_tagline || '';
    document.getElementById('brandMark').textContent = siteName.trim().charAt(0) || 'อ';
    document.getElementById('footerText').textContent = s.footer_text || `© 2026 ${siteName}`;
    document.getElementById('contactInfo').textContent = s.contact_info || '';

    const bar = document.getElementById('announcementBar');
    if (s.announcement && s.announcement.trim()) {
      bar.textContent = s.announcement.trim();
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  }

  async function apiGet(url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'โหลดข้อมูลไม่สำเร็จ');
    return data;
  }

  async function loadSiteMeta() {
    const data = await apiGet('/api/site');
    state.settings = data.settings || {};
    state.categories = data.categories || [];
    applySiteSettings();
  }

  async function loadNovels() {
    const params = new URLSearchParams();
    if (state.search) params.set('search', state.search);
    if (state.selectedCategory) params.set('category', state.selectedCategory);
    if (state.statusFilter) params.set('status', state.statusFilter);
    if (state.sort) params.set('sort', state.sort);
    const data = await apiGet(`/api/novels?${params.toString()}`);
    state.novels = data.novels || [];
  }

  function setNavActive(name) {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === name);
    });
  }

  function renderNovelCard(n) {
    const cover = n.cover_url || '/covers/cover-magic.svg';
    return `
      <article class="novel-card" data-open-novel="${n.id}">
        <div class="novel-cover-wrap">
          <img src="${escapeHtml(cover)}" alt="${escapeHtml(n.title)}" loading="lazy" />
          <div class="cover-badges">
            ${n.category_name ? `<span class="badge badge-cat">${escapeHtml(n.category_name)}</span>` : '<span></span>'}
            <span class="badge badge-status ${escapeHtml(n.status)}">${statusLabel(n.status)}</span>
          </div>
        </div>
        <div class="novel-body">
          <h3 class="novel-title">${escapeHtml(n.title)}</h3>
          <div class="novel-author">โดย ${escapeHtml(n.author)}</div>
          <p class="novel-synopsis-mini">${escapeHtml(n.synopsis || 'คลิกเพื่อดูรายละเอียดและเริ่มอ่าน...')}</p>
          <div class="novel-meta">
            <span>📖 ${formatNumber(n.chapter_count)} ตอน</span>
            <span>👁 ${formatNumber(n.views)}</span>
          </div>
        </div>
      </article>
    `;
  }

  function renderHome() {
    state.view = 'home';
    setNavActive('home');
    progressTrack.style.display = 'none';
    const s = state.settings;
    const latestRead = getLatestReadEntry();
    const totalChapters = state.novels.reduce((sum, n) => sum + Number(n.chapter_count || 0), 0);
    const totalViews = state.novels.reduce((sum, n) => sum + Number(n.views || 0), 0);

    const featuredNovels = !state.search && !state.selectedCategory && !state.statusFilter
      ? state.novels.filter((n) => n.is_featured === 1)
      : [];

    appRoot.innerHTML = `
      <div class="container">
        <section class="hero">
          <div>
            <div class="hero-badge">✨ อ่านฟรีทุกเรื่อง ไม่ต้องสมัครสมาชิก</div>
            <h1>${escapeHtml(s.hero_title || 'เปิดโลกแห่งจินตนาการ อ่านนิยายดีๆ ได้ทันที')}</h1>
            <p>${escapeHtml(s.hero_subtitle || 'เลือกเรื่องที่ชอบแล้วเริ่มอ่านได้ทันที')}</p>
            <form class="hero-search" id="searchForm">
              <input type="search" id="searchInput" placeholder="ค้นหาชื่อนิยาย, นามปากกาผู้แต่ง หรือแท็ก..." value="${escapeHtml(state.search)}" />
              <button type="submit" class="btn btn-primary">ค้นหา</button>
            </form>
          </div>
          <div class="hero-stats">
            <div class="hero-stat-card">
              <div class="hero-stat-num">${formatNumber(state.novels.length)}</div>
              <div class="hero-stat-label">เรื่องที่พร้อมอ่าน</div>
            </div>
            <div class="hero-stat-card">
              <div class="hero-stat-num">${formatNumber(totalChapters)}</div>
              <div class="hero-stat-label">ตอนทั้งหมด</div>
            </div>
            <div class="hero-stat-card">
              <div class="hero-stat-num">${formatNumber(state.categories.length)}</div>
              <div class="hero-stat-label">หมวดหมู่นิยาย</div>
            </div>
            <div class="hero-stat-card">
              <div class="hero-stat-num">${formatNumber(totalViews)}</div>
              <div class="hero-stat-label">ยอดอ่านสะสม</div>
            </div>
          </div>
        </section>

        ${latestRead ? `
          <div class="continue-card">
            <div>
              <div style="font-size:0.82rem; color:var(--text-muted); font-weight:600;">อ่านค้างไว้ล่าสุด</div>
              <div style="font-weight:700; font-size:1.05rem;">${escapeHtml(latestRead.novelTitle)} — ตอนที่ ${escapeHtml(latestRead.chapterNumber)}: ${escapeHtml(latestRead.chapterTitle)}</div>
            </div>
            <button class="btn btn-primary" data-open-chapter="${latestRead.chapterId}">อ่านต่อเลย →</button>
          </div>
        ` : ''}

        ${featuredNovels.length > 0 ? `
          <div class="section-head">
            <h2 class="section-title">🌟 นิยายแนะนำ</h2>
          </div>
          <div class="novel-grid">
            ${featuredNovels.map(renderNovelCard).join('')}
          </div>
        ` : ''}

        <div class="section-head">
          <h2 class="section-title">📚 คลังนิยายทั้งหมด</h2>
          <div class="controls-row">
            <select class="select-input" id="statusFilter">
              <option value="" ${state.statusFilter === '' ? 'selected' : ''}>ทุกสถานะ</option>
              <option value="ongoing" ${state.statusFilter === 'ongoing' ? 'selected' : ''}>ยังไม่จบ</option>
              <option value="completed" ${state.statusFilter === 'completed' ? 'selected' : ''}>จบแล้ว</option>
              <option value="hiatus" ${state.statusFilter === 'hiatus' ? 'selected' : ''}>พักอัปเดต</option>
            </select>
            <select class="select-input" id="sortSelect">
              <option value="latest" ${state.sort === 'latest' ? 'selected' : ''}>อัปเดตล่าสุด</option>
              <option value="popular" ${state.sort === 'popular' ? 'selected' : ''}>ยอดอ่านสูงสุด</option>
              <option value="chapters" ${state.sort === 'chapters' ? 'selected' : ''}>จำนวนตอนมากสุด</option>
            </select>
          </div>
        </div>

        <div class="category-pills">
          <button class="pill ${state.selectedCategory === '' ? 'active' : ''}" data-cat="">ทั้งหมด</button>
          ${state.categories.map((c) => `
            <button class="pill ${state.selectedCategory === String(c.id) ? 'active' : ''}" data-cat="${c.id}">
              ${escapeHtml(c.name)} (${c.novel_count})
            </button>
          `).join('')}
        </div>

        ${state.novels.length > 0
          ? `<div class="novel-grid">${state.novels.map(renderNovelCard).join('')}</div>`
          : `<div class="empty-state">
               <div style="font-size:2rem; margin-bottom:8px;">🔍</div>
               <div style="font-weight:700; color:var(--text);">ไม่พบนิยายที่ตรงกับเงื่อนไข</div>
               <p>ลองเปลี่ยนคำค้นหาหรือเลือกหมวดหมู่อื่นดูนะครับ</p>
               <button class="btn btn-outline" id="resetFiltersBtn">แสดงนิยายทั้งหมด</button>
             </div>`
        }
      </div>
    `;

    document.getElementById('searchForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      state.search = document.getElementById('searchInput').value.trim();
      await loadNovels();
      renderHome();
    });

    document.getElementById('statusFilter').addEventListener('change', async (e) => {
      state.statusFilter = e.target.value;
      await loadNovels();
      renderHome();
    });

    document.getElementById('sortSelect').addEventListener('change', async (e) => {
      state.sort = e.target.value;
      await loadNovels();
      renderHome();
    });

    document.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.selectedCategory = btn.dataset.cat;
        await loadNovels();
        renderHome();
      });
    });

    const resetBtn = document.getElementById('resetFiltersBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        state.search = '';
        state.selectedCategory = '';
        state.statusFilter = '';
        await loadNovels();
        renderHome();
      });
    }

    bindCardLinks();
  }

  async function renderBookmarks() {
    state.view = 'bookmarks';
    setNavActive('bookmarks');
    progressTrack.style.display = 'none';
    const ids = getBookmarks();
    const data = await apiGet('/api/novels');
    const saved = (data.novels || []).filter((n) => ids.includes(n.id));

    appRoot.innerHTML = `
      <div class="container">
        <div class="section-head">
          <h2 class="section-title">🔖 ชั้นหนังสือของฉัน (บันทึกไว้บนเบราว์เซอร์นี้)</h2>
          <button class="btn btn-outline" id="backHomeFromBm">← กลับหน้าแรก</button>
        </div>
        ${saved.length > 0
          ? `<div class="novel-grid">${saved.map(renderNovelCard).join('')}</div>`
          : `<div class="empty-state">
               <div style="font-size:2rem; margin-bottom:8px;">📚</div>
               <div style="font-weight:700; color:var(--text);">ยังไม่มีนิยายในชั้นหนังสือ</div>
               <p>กดปุ่ม "เก็บเข้าชั้นหนังสือ" ในหน้ารายละเอียดนิยาย เพื่อเก็บไว้อ่านทีหลังได้โดยไม่ต้องล็อกอิน</p>
               <button class="btn btn-primary" id="browseNowBtn">ไปเลือกนิยายอ่าน</button>
             </div>`
        }
      </div>
    `;

    document.getElementById('backHomeFromBm').addEventListener('click', () => navigate('#/'));
    const browseBtn = document.getElementById('browseNowBtn');
    if (browseBtn) browseBtn.addEventListener('click', () => navigate('#/'));
    bindCardLinks();
  }

  async function renderNovelDetail(novelId) {
    state.view = 'novel';
    setNavActive('');
    progressTrack.style.display = 'none';
    const data = await apiGet(`/api/novels/${novelId}`);
    state.currentNovel = data.novel;
    state.currentChapters = data.chapters || [];

    const n = state.currentNovel;
    const chapters = state.chapterOrderAsc ? [...state.currentChapters] : [...state.currentChapters].reverse();
    const firstChapter = state.currentChapters[0] || null;
    const historyEntry = getReadingHistory()[String(n.id)];
    const bookmarked = isBookmarked(n.id);
    const tags = (n.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

    appRoot.innerHTML = `
      <div class="container">
        <div class="back-row">
          <button class="btn btn-outline" id="backToHome">← กลับไปคลังนิยาย</button>
        </div>

        <section class="detail-card">
          <div>
            <img class="detail-cover" src="${escapeHtml(n.cover_url || '/covers/cover-magic.svg')}" alt="${escapeHtml(n.title)}" />
          </div>
          <div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${n.category_name ? `<span class="badge badge-cat">${escapeHtml(n.category_name)}</span>` : ''}
              <span class="badge badge-status ${escapeHtml(n.status)}">${statusLabel(n.status)}</span>
            </div>
            <h1 class="detail-title">${escapeHtml(n.title)}</h1>
            <div class="detail-meta-row">
              <span>✍ ผู้แต่ง: <strong>${escapeHtml(n.author)}</strong></span>
              <span>📖 ${formatNumber(state.currentChapters.length)} ตอน</span>
              <span>👁 ยอดอ่าน ${formatNumber(n.views)}</span>
            </div>

            ${tags.length ? `<div class="tag-list">${tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}

            <div class="detail-synopsis">${escapeHtml(n.synopsis || 'ยังไม่มีเรื่องย่อ')}</div>

            <div class="detail-actions">
              ${historyEntry
                ? `<button class="btn btn-primary" data-open-chapter="${historyEntry.chapterId}">▶ อ่านต่อ (ตอนที่ ${historyEntry.chapterNumber})</button>`
                : (firstChapter ? `<button class="btn btn-primary" data-open-chapter="${firstChapter.id}">▶ เริ่มอ่านตอนแรก</button>` : '')
              }
              ${firstChapter && historyEntry && historyEntry.chapterId !== firstChapter.id
                ? `<button class="btn btn-soft" data-open-chapter="${firstChapter.id}">เริ่มอ่านตอนที่ 1</button>`
                : ''
              }
              <button class="btn btn-outline" id="bookmarkBtn">
                ${bookmarked ? '★ อยู่ในชั้นหนังสือแล้ว' : '☆ เก็บเข้าชั้นหนังสือ'}
              </button>
            </div>
          </div>
        </section>

        <section class="chapter-list-card">
          <div class="section-head" style="margin-top:0;">
            <h2 class="section-title">สารบัญตอน (${formatNumber(state.currentChapters.length)} ตอน)</h2>
            <button class="btn btn-outline" id="toggleOrderBtn">
              ${state.chapterOrderAsc ? 'เรียง: ตอนแรก → ล่าสุด' : 'เรียง: ล่าสุด → ตอนแรก'}
            </button>
          </div>

          ${chapters.length > 0
            ? chapters.map((ch) => `
                <div class="chapter-item" data-open-chapter="${ch.id}">
                  <span class="chapter-num">ตอนที่ ${ch.chapter_number}</span>
                  <span class="chapter-item-title">${escapeHtml(ch.title)}</span>
                  <span class="chapter-item-meta">👁 ${formatNumber(ch.views)}</span>
                </div>
              `).join('')
            : `<div class="empty-state">นิยายเรื่องนี้ยังไม่มีตอนที่เผยแพร่</div>`
          }
        </section>
      </div>
    `;

    document.getElementById('backToHome').addEventListener('click', () => navigate('#/'));
    document.getElementById('bookmarkBtn').addEventListener('click', () => {
      toggleBookmark(n.id);
      renderNovelDetail(n.id);
    });
    document.getElementById('toggleOrderBtn').addEventListener('click', () => {
      state.chapterOrderAsc = !state.chapterOrderAsc;
      renderNovelDetail(n.id);
    });
    bindCardLinks();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function renderReader(chapterId) {
    state.view = 'reader';
    setNavActive('');
    const data = await apiGet(`/api/chapters/${chapterId}`);
    state.currentChapterData = data;
    const { chapter, prevChapter, nextChapter, chapters } = data;

    saveReadingHistory(
      chapter.novel_id,
      chapter.novel_title,
      chapter.id,
      chapter.chapter_number,
      chapter.title
    );

    progressTrack.style.display = 'block';
    progressBar.style.width = '0%';

    const paragraphs = String(chapter.content || '')
      .split(/\r?\n\s*\r?\n|\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join('');

    const prefs = state.readerPrefs;
    const fontCss = prefs.fontFamily === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)';

    appRoot.innerHTML = `
      <div class="reader-shell theme-${escapeHtml(prefs.theme)}" id="readerShell">
        <div class="container">
          <div class="reader-toolbar">
            <div class="reader-controls">
              <button class="r-btn" data-open-novel="${chapter.novel_id}">← สารบัญ</button>
              <select class="select-input" id="chapterJumpSelect" style="max-width:240px;">
                ${chapters.map((c) => `
                  <option value="${c.id}" ${c.id === chapter.id ? 'selected' : ''}>
                    ตอนที่ ${c.chapter_number}: ${escapeHtml(c.title)}
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="reader-controls">
              <button class="r-btn" id="fontDecBtn" title="ลดขนาดตัวอักษร">A-</button>
              <span style="font-size:0.84rem; min-width:38px; text-align:center;" id="fontSizeLabel">${prefs.fontSize}px</span>
              <button class="r-btn" id="fontIncBtn" title="เพิ่มขนาดตัวอักษร">A+</button>
              <button class="r-btn ${prefs.fontFamily === 'sans' ? 'active' : ''}" data-font="sans">ไม่มีหัว</button>
              <button class="r-btn ${prefs.fontFamily === 'serif' ? 'active' : ''}" data-font="serif">มีหัว</button>
              <button class="r-btn ${prefs.theme === 'light' ? 'active' : ''}" data-theme="light">สว่าง</button>
              <button class="r-btn ${prefs.theme === 'sepia' ? 'active' : ''}" data-theme="sepia">ถนอมสายตา</button>
              <button class="r-btn ${prefs.theme === 'dark' ? 'active' : ''}" data-theme="dark">มืด</button>
            </div>
          </div>

          <article class="reader-paper">
            <header class="reader-header">
              <div class="reader-novel-link" data-open-novel="${chapter.novel_id}">${escapeHtml(chapter.novel_title)}</div>
              <h1 class="reader-chapter-title">ตอนที่ ${chapter.chapter_number}: ${escapeHtml(chapter.title)}</h1>
              <div class="reader-meta">โดย ${escapeHtml(chapter.novel_author)} · 👁 ${formatNumber(chapter.views)} ครั้ง</div>
            </header>

            <div class="reader-content" id="readerContent" style="font-size:${prefs.fontSize}px; font-family:${fontCss};">
              ${paragraphs || '<p>(ยังไม่มีเนื้อหาในตอนนี้)</p>'}
            </div>
          </article>

          <nav class="reader-nav">
            <div>
              ${prevChapter
                ? `<button class="btn btn-outline" data-open-chapter="${prevChapter.id}">← ตอนก่อนหน้า (ตอนที่ ${prevChapter.chapter_number})</button>`
                : `<button class="btn btn-outline" disabled style="opacity:0.45; cursor:default;">← ตอนแรกแล้ว</button>`
              }
            </div>
            <button class="btn btn-soft" data-open-novel="${chapter.novel_id}">กลับหน้าสารบัญ</button>
            <div>
              ${nextChapter
                ? `<button class="btn btn-primary" data-open-chapter="${nextChapter.id}">ตอนถัดไป (ตอนที่ ${nextChapter.chapter_number}) →</button>`
                : `<button class="btn btn-outline" disabled style="opacity:0.45; cursor:default;">ถึงตอนล่าสุดแล้ว ✓</button>`
              }
            </div>
          </nav>
        </div>
      </div>
    `;

    document.getElementById('chapterJumpSelect').addEventListener('change', (e) => {
      navigate(`#/chapter/${e.target.value}`);
    });

    document.getElementById('fontDecBtn').addEventListener('click', () => {
      state.readerPrefs.fontSize = Math.max(14, state.readerPrefs.fontSize - 1);
      saveReaderPrefs();
      applyReaderLiveStyle();
    });

    document.getElementById('fontIncBtn').addEventListener('click', () => {
      state.readerPrefs.fontSize = Math.min(30, state.readerPrefs.fontSize + 1);
      saveReaderPrefs();
      applyReaderLiveStyle();
    });

    document.querySelectorAll('[data-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.readerPrefs.theme = btn.dataset.theme;
        saveReaderPrefs();
        document.getElementById('readerShell').className = `reader-shell theme-${state.readerPrefs.theme}`;
        document.querySelectorAll('[data-theme]').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    document.querySelectorAll('[data-font]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.readerPrefs.fontFamily = btn.dataset.font;
        saveReaderPrefs();
        applyReaderLiveStyle();
        document.querySelectorAll('[data-font]').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    bindCardLinks();
    window.scrollTo({ top: 0 });
  }

  function applyReaderLiveStyle() {
    const el = document.getElementById('readerContent');
    const lbl = document.getElementById('fontSizeLabel');
    if (el) {
      el.style.fontSize = `${state.readerPrefs.fontSize}px`;
      el.style.fontFamily = state.readerPrefs.fontFamily === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)';
    }
    if (lbl) lbl.textContent = `${state.readerPrefs.fontSize}px`;
  }

  function bindCardLinks() {
    document.querySelectorAll('[data-open-novel]').forEach((el) => {
      el.addEventListener('click', () => navigate(`#/novel/${el.dataset.openNovel}`));
    });
    document.querySelectorAll('[data-open-chapter]').forEach((el) => {
      el.addEventListener('click', () => navigate(`#/chapter/${el.dataset.openChapter}`));
    });
  }

  function navigate(hash) {
    if (window.location.hash === hash) {
      handleRoute();
    } else {
      window.location.hash = hash;
    }
  }

  async function handleRoute() {
    const hash = window.location.hash || '#/';
    try {
      const novelMatch = hash.match(/^#\/novel\/(\d+)$/);
      if (novelMatch) {
        return await renderNovelDetail(novelMatch[1]);
      }
      const chapterMatch = hash.match(/^#\/chapter\/(\d+)$/);
      if (chapterMatch) {
        return await renderReader(chapterMatch[1]);
      }
      if (hash === '#/bookmarks') {
        return await renderBookmarks();
      }
      await loadNovels();
      renderHome();
    } catch (err) {
      appRoot.innerHTML = `
        <div class="container" style="padding:48px 20px;">
          <div class="empty-state">
            <h2 style="margin-top:0; color:var(--text);">ไม่สามารถโหลดข้อมูลได้</h2>
            <p>${escapeHtml(err.message)}</p>
            <button class="btn btn-primary" onclick="location.hash='#/'">กลับหน้าแรก</button>
          </div>
        </div>
      `;
    }
  }

  window.addEventListener('scroll', () => {
    if (state.view !== 'reader') return;
    const doc = document.documentElement;
    const total = doc.scrollHeight - doc.clientHeight;
    const pct = total > 0 ? Math.min(100, Math.max(0, (window.scrollY / total) * 100)) : 0;
    progressBar.style.width = `${pct}%`;
  });

  window.addEventListener('keydown', (e) => {
    if (state.view !== 'reader' || !state.currentChapterData) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'ArrowLeft' && state.currentChapterData.prevChapter) {
      navigate(`#/chapter/${state.currentChapterData.prevChapter.id}`);
    } else if (e.key === 'ArrowRight' && state.currentChapterData.nextChapter) {
      navigate(`#/chapter/${state.currentChapterData.nextChapter.id}`);
    }
  });

  document.getElementById('brandHomeBtn').addEventListener('click', () => navigate('#/'));
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.nav === 'home') navigate('#/');
      else if (btn.dataset.nav === 'bookmarks') navigate('#/bookmarks');
    });
  });

  window.addEventListener('hashchange', handleRoute);

  (async function init() {
    updateBookmarkCount();
    await loadSiteMeta();
    await handleRoute();
  })();
})();
