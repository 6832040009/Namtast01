(() => {
  const PRESET_COVERS = [
    '/covers/cover-magic.svg',
    '/covers/cover-romance.svg',
    '/covers/cover-wuxia.svg',
    '/covers/cover-mystery.svg'
  ];

  const COLOR_PRESETS = ['#b45309', '#be123c', '#0f766e', '#1d4ed8', '#6d28d9', '#374151'];

  const state = {
    admin: null,
    tab: 'dashboard', // 'dashboard' | 'novels' | 'chapters' | 'categories' | 'settings' | 'account'
    dashboard: null,
    novels: [],
    categories: [],
    settings: {},
    selectedNovelId: null,
    chapters: [],
    editingChapter: null
  };

  const adminRoot = document.getElementById('adminRoot');
  const modalRoot = document.getElementById('modalRoot');
  const toastEl = document.getElementById('toast');
  let toastTimer = null;

  function showToast(msg, type = 'success') {
    toastEl.textContent = msg;
    toastEl.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.className = 'toast';
    }, 2800);
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

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && url !== '/api/admin/login' && url !== '/api/admin/me') {
        state.admin = null;
        renderLogin();
      }
      throw new Error(data.error || 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
    }
    return data;
  }

  function closeModal() {
    modalRoot.innerHTML = '';
  }

  // ===================== LOGIN VIEW =====================
  function renderLogin(errorMsg = '') {
    adminRoot.innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="login-logo">อ</div>
          <h1>เข้าสู่ระบบหลังบ้าน</h1>
          <p>สำหรับผู้ดูแลระบบ (<strong>useradmin</strong>) เพื่อลงนิยาย แก้ไขตอน และตั้งค่าเว็บไซต์</p>
          ${errorMsg ? `<div class="alert-error">${escapeHtml(errorMsg)}</div>` : ''}
          <form id="loginForm">
            <div class="form-group">
              <label for="username">ชื่อผู้ใช้ (Username)</label>
              <input id="username" class="input" type="text" value="useradmin" autocomplete="username" required />
            </div>
            <div class="form-group">
              <label for="password">รหัสผ่าน (Password)</label>
              <input id="password" class="input" type="password" placeholder="กรอกรหัสผ่าน" autocomplete="current-password" required />
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%; padding:11px;">เข้าสู่ระบบจัดการเว็บ</button>
          </form>
          <div class="login-hint">
            บัญชีเริ่มต้น: <code>useradmin</code> / รหัสผ่าน: <code>admin1234</code><br/>
            (สามารถเปลี่ยนรหัสผ่านได้ภายหลังในเมนู "บัญชีแอดมิน")
          </div>
          <div style="margin-top:16px; text-align:center;">
            <a href="/" style="color:var(--accent); font-weight:600; font-size:0.9rem;">← กลับไปหน้าเว็บอ่านนิยาย (ไม่ต้องล็อกอิน)</a>
          </div>
        </div>
      </div>
    `;

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      try {
        const data = await api('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        state.admin = data.admin;
        showToast('เข้าสู่ระบบสำเร็จ');
        await loadAllCoreData();
        renderShell();
      } catch (err) {
        renderLogin(err.message);
      }
    });
  }

  // ===================== DATA LOADERS =====================
  async function loadAllCoreData() {
    const [dashData, novelsData, catData, settingsData] = await Promise.all([
      api('/api/admin/dashboard'),
      api('/api/admin/novels'),
      api('/api/admin/categories'),
      api('/api/admin/settings')
    ]);
    state.dashboard = dashData;
    state.novels = novelsData.novels || [];
    state.categories = catData.categories || [];
    state.settings = settingsData.settings || {};
    if (state.settings.accent_color) {
      document.documentElement.style.setProperty('--accent', state.settings.accent_color);
    }
  }

  async function loadChaptersForNovel(novelId) {
    state.selectedNovelId = Number(novelId);
    const data = await api(`/api/admin/novels/${novelId}/chapters`);
    state.chapters = data.chapters || [];
  }

  // ===================== MAIN SHELL =====================
  function renderShell() {
    const siteName = state.settings.site_name || 'อักษราบุ๊ค';
    adminRoot.innerHTML = `
      <div class="admin-layout">
        <aside class="sidebar">
          <div class="sidebar-brand">
            <div class="sidebar-brand-title">${escapeHtml(siteName)}</div>
            <div class="sidebar-brand-sub">หลังบ้าน: ${escapeHtml(state.admin.username)} (${escapeHtml(state.admin.display_name)})</div>
          </div>

          <button class="side-btn ${state.tab === 'dashboard' ? 'active' : ''}" data-tab="dashboard">📊 ภาพรวมระบบ</button>
          <button class="side-btn ${state.tab === 'novels' ? 'active' : ''}" data-tab="novels">📚 จัดการนิยาย</button>
          <button class="side-btn ${state.tab === 'chapters' ? 'active' : ''}" data-tab="chapters">📝 ลงตอน / แก้ไขตอน</button>
          <button class="side-btn ${state.tab === 'categories' ? 'active' : ''}" data-tab="categories">🏷 จัดการหมวดหมู่</button>
          <button class="side-btn ${state.tab === 'settings' ? 'active' : ''}" data-tab="settings">🎨 ตั้งค่าหน้าเว็บไซต์</button>
          <button class="side-btn ${state.tab === 'account' ? 'active' : ''}" data-tab="account">🔐 บัญชี useradmin</button>

          <div class="sidebar-footer">
            <a href="/" target="_blank" class="side-btn" style="text-decoration:none;">🌐 เปิดดูหน้าเว็บจริง ↗</a>
            <button class="side-btn" id="logoutBtn" style="color:#fca5a5;">🚪 ออกจากระบบ</button>
          </div>
        </aside>

        <main class="main-area" id="tabContent"></main>
      </div>
    `;

    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.tab = btn.dataset.tab;
        state.editingChapter = null;
        if (state.tab === 'chapters' && !state.selectedNovelId && state.novels.length > 0) {
          await loadChaptersForNovel(state.novels[0].id);
        }
        renderShell();
      });
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await api('/api/admin/logout', { method: 'POST' });
      state.admin = null;
      renderLogin();
      showToast('ออกจากระบบแล้ว');
    });

    renderActiveTab();
  }

  function renderActiveTab() {
    const container = document.getElementById('tabContent');
    if (state.tab === 'dashboard') renderDashboard(container);
    else if (state.tab === 'novels') renderNovels(container);
    else if (state.tab === 'chapters') renderChapters(container);
    else if (state.tab === 'categories') renderCategories(container);
    else if (state.tab === 'settings') renderSettings(container);
    else if (state.tab === 'account') renderAccount(container);
  }

  // ===================== TAB 1: DASHBOARD =====================
  function renderDashboard(el) {
    const st = state.dashboard?.stats || {};
    const recent = state.dashboard?.recentNovels || [];

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">ภาพรวมเว็บไซต์</h1>
          <p class="page-sub">ยินดีต้อนรับคุณ ${escapeHtml(state.admin.display_name)} — จัดการนิยาย ตอนใหม่ และองค์ประกอบทั้งหมดของเว็บได้ที่นี่</p>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-primary" id="quickAddNovelBtn">+ เพิ่มนิยายใหม่</button>
          <button class="btn btn-outline" id="quickEditSiteBtn">🎨 แก้ไขหน้าเว็บ</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">นิยายทั้งหมด</div>
          <div class="stat-value">${Number(st.total_novels || 0).toLocaleString('th-TH')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">ตอนนิยายทั้งหมด</div>
          <div class="stat-value">${Number(st.total_chapters || 0).toLocaleString('th-TH')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">ยอดอ่านสะสม</div>
          <div class="stat-value">${Number(st.total_views || 0).toLocaleString('th-TH')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">หมวดหมู่ทั้งหมด</div>
          <div class="stat-value">${Number(st.total_categories || 0).toLocaleString('th-TH')}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2 class="panel-title">นิยายที่อัปเดตล่าสุด</h2>
          <button class="btn btn-outline btn-sm" id="viewAllNovelsBtn">ดูทั้งหมด →</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ปก</th>
                <th>ชื่อเรื่อง / ผู้แต่ง</th>
                <th>หมวดหมู่</th>
                <th>จำนวนตอน</th>
                <th>ยอดอ่าน</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              ${recent.map((n) => `
                <tr>
                  <td><img class="thumb" src="${escapeHtml(n.cover_url || PRESET_COVERS[0])}" alt="" /></td>
                  <td>
                    <div style="font-weight:700;">${escapeHtml(n.title)}</div>
                    <div style="font-size:0.82rem; color:var(--text-muted);">โดย ${escapeHtml(n.author)}</div>
                  </td>
                  <td>${escapeHtml(n.category_name || '-')}</td>
                  <td>${n.chapter_count} ตอน</td>
                  <td>${Number(n.views || 0).toLocaleString('th-TH')}</td>
                  <td>
                    <button class="btn btn-primary btn-sm" data-manage-chapters="${n.id}">+ ลงตอน</button>
                    <button class="btn btn-outline btn-sm" data-edit-novel="${n.id}">แก้ไข</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('quickAddNovelBtn').addEventListener('click', () => openNovelModal(null));
    document.getElementById('quickEditSiteBtn').addEventListener('click', () => { state.tab = 'settings'; renderShell(); });
    document.getElementById('viewAllNovelsBtn').addEventListener('click', () => { state.tab = 'novels'; renderShell(); });
    bindNovelRowActions();
  }

  // ===================== TAB 2: NOVELS =====================
  function renderNovels(el) {
    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">จัดการนิยายทั้งหมด</h1>
          <p class="page-sub">เพิ่มเรื่องใหม่ แก้ไขรายละเอียด เปลี่ยนปก หรือจัดการตอนในแต่ละเรื่อง</p>
        </div>
        <button class="btn btn-primary" id="addNovelBtn">+ เพิ่มนิยายใหม่</button>
      </div>

      <div class="panel">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ปก</th>
                <th>ชื่อนิยาย</th>
                <th>หมวดหมู่</th>
                <th>สถานะ</th>
                <th>การแสดงผล</th>
                <th>ตอน / ยอดอ่าน</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              ${state.novels.length ? state.novels.map((n) => `
                <tr>
                  <td><img class="thumb" src="${escapeHtml(n.cover_url || PRESET_COVERS[0])}" alt="" /></td>
                  <td>
                    <div style="font-weight:700;">${escapeHtml(n.title)} ${n.is_featured ? '<span class="pill-badge pill-amber">แนะนำ</span>' : ''}</div>
                    <div style="font-size:0.82rem; color:var(--text-muted);">ผู้แต่ง: ${escapeHtml(n.author)}</div>
                  </td>
                  <td>${escapeHtml(n.category_name || '-')}</td>
                  <td><span class="pill-badge ${n.status === 'completed' ? 'pill-green' : 'pill-gray'}">${statusLabel(n.status)}</span></td>
                  <td><span class="pill-badge ${n.is_published ? 'pill-green' : 'pill-gray'}">${n.is_published ? 'เผยแพร่' : 'ฉบับร่าง'}</span></td>
                  <td>${n.chapter_count} ตอน · 👁 ${Number(n.views || 0).toLocaleString('th-TH')}</td>
                  <td style="white-space:nowrap;">
                    <button class="btn btn-primary btn-sm" data-manage-chapters="${n.id}">จัดการตอน</button>
                    <button class="btn btn-outline btn-sm" data-edit-novel="${n.id}">แก้ไข</button>
                    <button class="btn btn-danger btn-sm" data-delete-novel="${n.id}">ลบ</button>
                  </td>
                </tr>
              `).join('') : `<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--text-muted);">ยังไม่มีนิยาย กดปุ่ม "+ เพิ่มนิยายใหม่" เพื่อเริ่มต้น</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('addNovelBtn').addEventListener('click', () => openNovelModal(null));
    bindNovelRowActions();
  }

  function bindNovelRowActions() {
    document.querySelectorAll('[data-manage-chapters]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await loadChaptersForNovel(btn.dataset.manageChapters);
        state.tab = 'chapters';
        state.editingChapter = null;
        renderShell();
      });
    });

    document.querySelectorAll('[data-edit-novel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const novel = state.novels.find((n) => n.id === Number(btn.dataset.editNovel));
        if (novel) openNovelModal(novel);
      });
    });

    document.querySelectorAll('[data-delete-novel]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.deleteNovel);
        const novel = state.novels.find((n) => n.id === id);
        if (!confirm(`ยืนยันการลบนิยาย "${novel?.title || ''}" และตอนทั้งหมดในเรื่องนี้?`)) return;
        try {
          await api(`/api/admin/novels/${id}`, { method: 'DELETE' });
          if (state.selectedNovelId === id) state.selectedNovelId = null;
          await loadAllCoreData();
          renderShell();
          showToast('ลบนิยายเรียบร้อยแล้ว');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  function openNovelModal(novel) {
    const isEdit = Boolean(novel);
    let currentCover = novel?.cover_url || PRESET_COVERS[0];

    modalRoot.innerHTML = `
      <div class="modal-backdrop" id="novelModalBackdrop">
        <div class="modal-card">
          <div class="modal-head">
            <h2 style="margin:0;">${isEdit ? 'แก้ไขข้อมูลนิยาย' : 'เพิ่มนิยายเรื่องใหม่'}</h2>
            <button class="btn btn-outline btn-sm" id="closeModalBtn">✕ ปิด</button>
          </div>
          <form id="novelForm">
            <div class="form-grid">
              <div class="form-group">
                <label>ชื่อเรื่องนิยาย *</label>
                <input class="input" name="title" value="${escapeHtml(novel?.title || '')}" required />
              </div>
              <div class="form-group">
                <label>นามปากกาผู้แต่ง *</label>
                <input class="input" name="author" value="${escapeHtml(novel?.author || '')}" required />
              </div>
              <div class="form-group">
                <label>หมวดหมู่</label>
                <select class="select" name="category_id">
                  <option value="">-- ไม่ระบุ --</option>
                  ${state.categories.map((c) => `
                    <option value="${c.id}" ${Number(novel?.category_id) === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>
                  `).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>สถานะนิยาย</label>
                <select class="select" name="status">
                  <option value="ongoing" ${(novel?.status || 'ongoing') === 'ongoing' ? 'selected' : ''}>ยังไม่จบ</option>
                  <option value="completed" ${novel?.status === 'completed' ? 'selected' : ''}>จบแล้ว</option>
                  <option value="hiatus" ${novel?.status === 'hiatus' ? 'selected' : ''}>พักอัปเดต</option>
                </select>
              </div>
              <div class="form-group full">
                <label>แท็ก (คั่นด้วยเครื่องหมายจุลภาค ,)</label>
                <input class="input" name="tags" placeholder="เช่น แฟนตาซี, ผจญภัย, พระเอกเก่ง" value="${escapeHtml(novel?.tags || '')}" />
              </div>
              <div class="form-group full">
                <label>เรื่องย่อ</label>
                <textarea class="textarea" name="synopsis" rows="4">${escapeHtml(novel?.synopsis || '')}</textarea>
              </div>
              <div class="form-group full">
                <label>รูปปกนิยาย (อัปโหลดจากเครื่อง, ใส่ URL หรือเลือกปกสำเร็จรูป)</label>
                <div class="cover-picker">
                  <img id="coverPreviewImg" class="cover-preview" src="${escapeHtml(currentCover)}" alt="preview" />
                  <div style="flex:1; min-width:220px;">
                    <input class="input" id="coverUrlInput" name="cover_url" value="${escapeHtml(currentCover)}" placeholder="/covers/cover-magic.svg หรือ https://..." />
                    <div style="margin-top:8px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                      <label class="btn btn-outline btn-sm" style="margin:0;">
                        📤 อัปโหลดไฟล์รูปปก
                        <input type="file" id="coverFileInput" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;" />
                      </label>
                      <span style="font-size:0.8rem; color:var(--text-muted);">PNG/JPG/WEBP ไม่เกิน 4MB</span>
                    </div>
                    <div class="preset-covers">
                      ${PRESET_COVERS.map((url) => `
                        <button type="button" class="preset-cover-btn ${currentCover === url ? 'selected' : ''}" data-preset-cover="${url}">
                          <img src="${url}" alt="" />
                        </button>
                      `).join('')}
                    </div>
                  </div>
                </div>
              </div>
              <div class="form-group full">
                <div class="check-row">
                  <label class="check-label">
                    <input type="checkbox" name="is_published" ${(!isEdit || novel.is_published) ? 'checked' : ''} />
                    เผยแพร่บนหน้าเว็บทันที
                  </label>
                  <label class="check-label">
                    <input type="checkbox" name="is_featured" ${novel?.is_featured ? 'checked' : ''} />
                    ปักหมุดเป็น "นิยายแนะนำ" บนหน้าแรก
                  </label>
                </div>
              </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
              <button type="button" class="btn btn-outline" id="cancelModalBtn">ยกเลิก</button>
              <button type="submit" class="btn btn-primary">${isEdit ? 'บันทึกการแก้ไข' : 'สร้างนิยาย'}</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const coverPreview = document.getElementById('coverPreviewImg');
    const coverInput = document.getElementById('coverUrlInput');

    coverInput.addEventListener('input', () => {
      if (coverInput.value.trim()) coverPreview.src = coverInput.value.trim();
    });

    document.querySelectorAll('[data-preset-cover]').forEach((btn) => {
      btn.addEventListener('click', () => {
        coverInput.value = btn.dataset.presetCover;
        coverPreview.src = btn.dataset.presetCover;
        document.querySelectorAll('[data-preset-cover]').forEach((b) => b.classList.toggle('selected', b === btn));
      });
    });

    document.getElementById('coverFileInput').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const uploaded = await api('/api/admin/upload', {
            method: 'POST',
            body: JSON.stringify({ dataUrl: reader.result })
          });
          coverInput.value = uploaded.url;
          coverPreview.src = uploaded.url;
          showToast('อัปโหลดรูปปกสำเร็จ');
        } catch (err) {
          showToast(err.message, 'error');
        }
      };
      reader.readAsDataURL(file);
    });

    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
    document.getElementById('novelModalBackdrop').addEventListener('click', (e) => {
      if (e.target.id === 'novelModalBackdrop') closeModal();
    });

    document.getElementById('novelForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        title: fd.get('title'),
        author: fd.get('author'),
        category_id: fd.get('category_id') ? Number(fd.get('category_id')) : null,
        status: fd.get('status'),
        tags: fd.get('tags'),
        synopsis: fd.get('synopsis'),
        cover_url: fd.get('cover_url'),
        is_published: e.target.querySelector('[name="is_published"]').checked,
        is_featured: e.target.querySelector('[name="is_featured"]').checked
      };

      try {
        if (isEdit) {
          await api(`/api/admin/novels/${novel.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          showToast('บันทึกข้อมูลนิยายแล้ว');
        } else {
          await api('/api/admin/novels', { method: 'POST', body: JSON.stringify(payload) });
          showToast('เพิ่มนิยายใหม่สำเร็จ');
        }
        closeModal();
        await loadAllCoreData();
        renderShell();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ===================== TAB 3: CHAPTERS =====================
  function renderChapters(el) {
    const selectedNovel = state.novels.find((n) => n.id === state.selectedNovelId) || null;
    const chEdit = state.editingChapter;
    const nextNum = state.chapters.length ? Math.max(...state.chapters.map((c) => c.chapter_number)) + 1 : 1;

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">ลงตอน / แก้ไขตอนนิยาย</h1>
          <p class="page-sub">เลือกนิยายที่ต้องการ แล้วเขียนตอนใหม่หรือแก้ไขเนื้อหาได้ทันที</p>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <select class="select" id="selectNovelForChapters" style="min-width:260px;">
            ${state.novels.length
              ? state.novels.map((n) => `<option value="${n.id}" ${n.id === state.selectedNovelId ? 'selected' : ''}>${escapeHtml(n.title)} (${n.chapter_count} ตอน)</option>`).join('')
              : '<option value="">-- ยังไม่มีนิยาย --</option>'
            }
          </select>
        </div>
      </div>

      ${!selectedNovel ? `
        <div class="panel" style="text-align:center; padding:40px;">
          <p>ยังไม่มีนิยายในระบบ กรุณาเพิ่มนิยายเรื่องแรกก่อน</p>
          <button class="btn btn-primary" id="goCreateNovelBtn">+ เพิ่มนิยายใหม่</button>
        </div>
      ` : `
        <div class="panel">
          <div class="panel-head">
            <h2 class="panel-title">${chEdit ? `แก้ไขตอนที่ ${chEdit.chapter_number}: ${escapeHtml(chEdit.title)}` : `✍️ เขียนตอนใหม่ — ${escapeHtml(selectedNovel.title)}`}</h2>
            ${chEdit ? `<button class="btn btn-outline btn-sm" id="cancelEditChapterBtn">+ สลับไปเขียนตอนใหม่</button>` : ''}
          </div>

          <form id="chapterForm">
            <div class="form-grid">
              <div class="form-group">
                <label>เลขตอน *</label>
                <input class="input" type="number" name="chapter_number" min="1" value="${chEdit ? chEdit.chapter_number : nextNum}" required />
              </div>
              <div class="form-group">
                <label>ชื่อตอน *</label>
                <input class="input" type="text" name="title" placeholder="เช่น บทนำ: จุดเริ่มต้นของการเดินทาง" value="${escapeHtml(chEdit?.title || '')}" required />
              </div>
              <div class="form-group full">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <label>เนื้อหาตอนนิยาย * (เว้นบรรทัดเพื่อขึ้นย่อหน้าใหม่)</label>
                  <span id="charCount" style="font-size:0.82rem; color:var(--text-muted);">0 ตัวอักษร</span>
                </div>
                <textarea class="textarea chapter-editor-area" id="chapterContentInput" name="content" placeholder="พิมพ์หรือวางเนื้อหานิยายที่นี่..." required>${escapeHtml(chEdit?.content || '')}</textarea>
              </div>
              <div class="form-group full">
                <label class="check-label">
                  <input type="checkbox" name="is_published" ${(!chEdit || chEdit.is_published) ? 'checked' : ''} />
                  เผยแพร่ตอนนี้ให้ผู้อ่านเปิดอ่านได้ทันที
                </label>
              </div>
            </div>
            <div style="display:flex; gap:10px;">
              <button type="submit" class="btn btn-primary">${chEdit ? 'บันทึกการแก้ไขตอน' : 'เผยแพร่ตอนใหม่'}</button>
              ${chEdit ? `<button type="button" class="btn btn-outline" id="cancelEditChapterBtn2">ยกเลิก</button>` : ''}
            </div>
          </form>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h2 class="panel-title">รายการตอนทั้งหมด (${state.chapters.length} ตอน)</h2>
            <a href="/#/novel/${selectedNovel.id}" target="_blank" class="btn btn-outline btn-sm">ดูหน้าอ่านเรื่องนี้ ↗</a>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ตอนที่</th>
                  <th>ชื่อตอน</th>
                  <th>สถานะ</th>
                  <th>ยอดอ่าน</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                ${state.chapters.length ? state.chapters.map((ch) => `
                  <tr>
                    <td><strong>ตอนที่ ${ch.chapter_number}</strong></td>
                    <td>${escapeHtml(ch.title)}</td>
                    <td><span class="pill-badge ${ch.is_published ? 'pill-green' : 'pill-gray'}">${ch.is_published ? 'เผยแพร่' : 'ร่าง'}</span></td>
                    <td>${Number(ch.views || 0).toLocaleString('th-TH')}</td>
                    <td style="white-space:nowrap;">
                      <button class="btn btn-outline btn-sm" data-edit-ch="${ch.id}">แก้ไข</button>
                      <button class="btn btn-danger btn-sm" data-delete-ch="${ch.id}">ลบ</button>
                    </td>
                  </tr>
                `).join('') : `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-muted);">ยังไม่มีตอนในนิยายเรื่องนี้</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      `}
    `;

    const goCreate = document.getElementById('goCreateNovelBtn');
    if (goCreate) {
      goCreate.addEventListener('click', () => openNovelModal(null));
      return;
    }

    document.getElementById('selectNovelForChapters').addEventListener('change', async (e) => {
      state.editingChapter = null;
      await loadChaptersForNovel(e.target.value);
      renderShell();
    });

    const contentInput = document.getElementById('chapterContentInput');
    const charCount = document.getElementById('charCount');
    const updateCount = () => {
      charCount.textContent = `${contentInput.value.length.toLocaleString('th-TH')} ตัวอักษร`;
    };
    updateCount();
    contentInput.addEventListener('input', updateCount);

    ['cancelEditChapterBtn', 'cancelEditChapterBtn2'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => { state.editingChapter = null; renderShell(); });
    });

    document.getElementById('chapterForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        chapter_number: Number(fd.get('chapter_number')),
        title: fd.get('title'),
        content: fd.get('content'),
        is_published: e.target.querySelector('[name="is_published"]').checked
      };

      try {
        if (chEdit) {
          await api(`/api/admin/chapters/${chEdit.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          showToast('แก้ไขตอนนิยายเรียบร้อยแล้ว');
        } else {
          await api(`/api/admin/novels/${selectedNovel.id}/chapters`, { method: 'POST', body: JSON.stringify(payload) });
          showToast('ลงตอนนิยายใหม่เรียบร้อยแล้ว');
        }
        state.editingChapter = null;
        await Promise.all([loadAllCoreData(), loadChaptersForNovel(selectedNovel.id)]);
        renderShell();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.querySelectorAll('[data-edit-ch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ch = state.chapters.find((c) => c.id === Number(btn.dataset.editCh));
        if (ch) {
          state.editingChapter = ch;
          renderShell();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });

    document.querySelectorAll('[data-delete-ch]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.deleteCh);
        if (!confirm('ยืนยันการลบตอนนิยายนี้?')) return;
        try {
          await api(`/api/admin/chapters/${id}`, { method: 'DELETE' });
          if (state.editingChapter?.id === id) state.editingChapter = null;
          await Promise.all([loadAllCoreData(), loadChaptersForNovel(selectedNovel.id)]);
          renderShell();
          showToast('ลบตอนนิยายแล้ว');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  // ===================== TAB 4: CATEGORIES =====================
  function renderCategories(el) {
    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">จัดการหมวดหมู่นิยาย</h1>
          <p class="page-sub">เพิ่ม แก้ไข หรือจัดลำดับหมวดหมู่ที่แสดงบนหน้าแรก</p>
        </div>
      </div>

      <div class="panel">
        <h2 class="panel-title" style="margin-bottom:14px;">เพิ่มหมวดหมู่ใหม่</h2>
        <form id="addCategoryForm" class="form-grid">
          <div class="form-group">
            <label>ชื่อหมวดหมู่ *</label>
            <input class="input" name="name" placeholder="เช่น ย้อนยุค, สยองขวัญ, ต่างโลก" required />
          </div>
          <div class="form-group">
            <label>ลำดับการแสดงผล</label>
            <input class="input" type="number" name="sort_order" value="${state.categories.length + 1}" />
          </div>
          <div class="form-group full">
            <label>คำอธิบายสั้นๆ</label>
            <input class="input" name="description" placeholder="อธิบายแนวเรื่องของหมวดหมู่นี้" />
          </div>
          <div class="form-group full" style="margin-bottom:0;">
            <button type="submit" class="btn btn-primary" style="width:fit-content;">+ เพิ่มหมวดหมู่</button>
          </div>
        </form>
      </div>

      <div class="panel">
        <h2 class="panel-title" style="margin-bottom:14px;">หมวดหมู่ทั้งหมด (${state.categories.length})</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ลำดับ</th>
                <th>ชื่อหมวดหมู่</th>
                <th>คำอธิบาย</th>
                <th>จำนวนนิยาย</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              ${state.categories.map((c) => `
                <tr>
                  <td>${c.sort_order}</td>
                  <td><strong>${escapeHtml(c.name)}</strong></td>
                  <td style="color:var(--text-muted);">${escapeHtml(c.description || '-')}</td>
                  <td>${c.novel_count} เรื่อง</td>
                  <td style="white-space:nowrap;">
                    <button class="btn btn-outline btn-sm" data-edit-cat="${c.id}">แก้ไข</button>
                    <button class="btn btn-danger btn-sm" data-delete-cat="${c.id}">ลบ</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('addCategoryForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/admin/categories', {
          method: 'POST',
          body: JSON.stringify({
            name: fd.get('name'),
            description: fd.get('description'),
            sort_order: Number(fd.get('sort_order') || 0)
          })
        });
        await loadAllCoreData();
        renderShell();
        showToast('เพิ่มหมวดหมู่เรียบร้อยแล้ว');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.querySelectorAll('[data-edit-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cat = state.categories.find((c) => c.id === Number(btn.dataset.editCat));
        if (!cat) return;
        const newName = prompt('แก้ไขชื่อหมวดหมู่:', cat.name);
        if (!newName || !newName.trim()) return;
        const newDesc = prompt('แก้ไขคำอธิบายหมวดหมู่:', cat.description || '') ?? cat.description;
        try {
          await api(`/api/admin/categories/${cat.id}`, {
            method: 'PUT',
            body: JSON.stringify({ name: newName.trim(), description: newDesc.trim(), sort_order: cat.sort_order })
          });
          await loadAllCoreData();
          renderShell();
          showToast('แก้ไขหมวดหมู่แล้ว');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('[data-delete-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.deleteCat);
        if (!confirm('ยืนยันการลบหมวดหมู่นี้? (นิยายในหมวดนี้จะไม่ถูกลบ)')) return;
        try {
          await api(`/api/admin/categories/${id}`, { method: 'DELETE' });
          await loadAllCoreData();
          renderShell();
          showToast('ลบหมวดหมู่แล้ว');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  // ===================== TAB 5: SITE SETTINGS =====================
  function renderSettings(el) {
    const s = state.settings;
    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">ตั้งค่าและแก้ไขสิ่งต่างๆ ภายในเว็บไซต์</h1>
          <p class="page-sub">ปรับชื่อเว็บ แถบประกาศ ข้อความแบนเนอร์ สีธีมหลัก และข้อมูลท้ายเว็บได้ทันที</p>
        </div>
        <a href="/" target="_blank" class="btn btn-outline">ดูผลลัพธ์บนหน้าเว็บ ↗</a>
      </div>

      <div class="panel">
        <form id="settingsForm">
          <div class="form-grid">
            <div class="form-group">
              <label>ชื่อเว็บไซต์</label>
              <input class="input" name="site_name" value="${escapeHtml(s.site_name || '')}" required />
            </div>
            <div class="form-group">
              <label>สโลแกนใต้ชื่อเว็บ</label>
              <input class="input" name="site_tagline" value="${escapeHtml(s.site_tagline || '')}" />
            </div>
            <div class="form-group full">
              <label>ข้อความแถบประกาศด้านบนสุด (เว้นว่างไว้หากต้องการซ่อน)</label>
              <input class="input" name="announcement" value="${escapeHtml(s.announcement || '')}" placeholder="เช่น แจ้งอัปเดตตอนใหม่ทุกวันศุกร์เวลา 20:00 น." />
            </div>
            <div class="form-group full">
              <label>หัวข้อใหญ่หน้าแรก (Hero Title)</label>
              <input class="input" name="hero_title" value="${escapeHtml(s.hero_title || '')}" />
            </div>
            <div class="form-group full">
              <label>คำอธิบายหน้าแรก (Hero Subtitle)</label>
              <textarea class="textarea" name="hero_subtitle" rows="3">${escapeHtml(s.hero_subtitle || '')}</textarea>
            </div>
            <div class="form-group">
              <label>สีธีมหลักของเว็บไซต์ (Accent Color)</label>
              <div style="display:flex; gap:10px; align-items:center;">
                <input type="color" id="accentColorPicker" name="accent_color" value="${escapeHtml(s.accent_color || '#b45309')}" style="width:48px; height:40px; border:1px solid var(--border); border-radius:8px; cursor:pointer;" />
                <div class="color-presets">
                  ${COLOR_PRESETS.map((hex) => `
                    <button type="button" class="color-dot" style="background:${hex};" data-color="${hex}" title="${hex}"></button>
                  `).join('')}
                </div>
              </div>
            </div>
            <div class="form-group">
              <label>ข้อมูลติดต่อ</label>
              <input class="input" name="contact_info" value="${escapeHtml(s.contact_info || '')}" />
            </div>
            <div class="form-group full">
              <label>ข้อความท้ายเว็บไซต์ (Footer)</label>
              <input class="input" name="footer_text" value="${escapeHtml(s.footer_text || '')}" />
            </div>
          </div>

          <button type="submit" class="btn btn-primary" style="margin-top:8px;">💾 บันทึกการตั้งค่าเว็บไซต์</button>
        </form>
      </div>
    `;

    const colorPicker = document.getElementById('accentColorPicker');
    document.querySelectorAll('[data-color]').forEach((dot) => {
      dot.addEventListener('click', () => {
        colorPicker.value = dot.dataset.color;
      });
    });

    document.getElementById('settingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      try {
        const res = await api('/api/admin/settings', {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        state.settings = res.settings;
        document.documentElement.style.setProperty('--accent', state.settings.accent_color || '#b45309');
        renderShell();
        showToast('บันทึกการตั้งค่าเว็บไซต์เรียบร้อยแล้ว');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ===================== TAB 6: ACCOUNT =====================
  function renderAccount(el) {
    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">จัดการบัญชีผู้ดูแลระบบ (${escapeHtml(state.admin.username)})</h1>
          <p class="page-sub">แก้ไขชื่อที่แสดง หรือเปลี่ยนรหัสผ่านเข้าสู่ระบบหลังบ้าน</p>
        </div>
      </div>

      <div class="panel" style="max-width:560px;">
        <form id="accountForm">
          <div class="form-group">
            <label>ชื่อผู้ใช้ (Username)</label>
            <input class="input" value="${escapeHtml(state.admin.username)}" disabled style="background:#f5f5f4;" />
          </div>
          <div class="form-group">
            <label>ชื่อที่แสดง (Display Name)</label>
            <input class="input" name="display_name" value="${escapeHtml(state.admin.display_name)}" required />
          </div>
          <hr style="border:none; border-top:1px solid var(--border); margin:18px 0;" />
          <div style="font-weight:700; margin-bottom:10px;">เปลี่ยนรหัสผ่าน (เว้นว่างหากไม่ต้องการเปลี่ยน)</div>
          <div class="form-group">
            <label>รหัสผ่านปัจจุบัน</label>
            <input class="input" type="password" name="current_password" />
          </div>
          <div class="form-group">
            <label>รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)</label>
            <input class="input" type="password" name="new_password" />
          </div>
          <button type="submit" class="btn btn-primary">บันทึกข้อมูลบัญชี</button>
        </form>
      </div>
    `;

    document.getElementById('accountForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await api('/api/admin/account', {
          method: 'PUT',
          body: JSON.stringify({
            display_name: fd.get('display_name'),
            current_password: fd.get('current_password'),
            new_password: fd.get('new_password')
          })
        });
        state.admin = res.admin;
        renderShell();
        showToast('อัปเดตข้อมูลบัญชี useradmin แล้ว');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ===================== BOOT =====================
  (async function init() {
    try {
      const me = await api('/api/admin/me');
      if (me.authenticated) {
        state.admin = me.admin;
        await loadAllCoreData();
        renderShell();
        return;
      }
    } catch {
      // Not logged in
    }
    renderLogin();
  })();
})();
