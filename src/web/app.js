// ============================================================
//  Elist 前端 —— 零构建原生 SPA（带左侧栏）
//  性能优先：无框架运行时、静态 CSS、Plyr 仅在预览媒体时懒加载，
//  失败自动回退原生 <video>/<audio>（自带进度条）。
// ============================================================

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');

const ICON = {
  dir: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/></svg>',
  drive: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h16a2 2 0 0 1 2 2v3H2V7a2 2 0 0 1 2-2zm-2 7h20v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7zm4 3h4v2H6v-2z"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 2 12h3v8h6v-5h2v5h6v-8h3L12 3z"/></svg>',
  hide: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 7a5 5 0 0 1 5 5c0 .65-.13 1.26-.36 1.83l2.42 2.42A11.6 11.6 0 0 0 23 12C21.3 7.7 17 4.6 12 4.6c-1.3 0-2.55.2-3.7.57l2.2 2.2A5 5 0 0 1 12 7zm-6.4-.4 3 3A5 5 0 0 0 12 17a5 5 0 0 0 4.9-4l3 3A11.7 11.7 0 0 1 12 19.4C7 19.4 2.7 16.3 1 12a12.2 12.2 0 0 1 4.6-4.4zM4.3 2 3 3.3l3 3 2 2 .2.2A5 5 0 0 0 12 17a5 5 0 0 0 4.4-2.6L20 21l1.3-1.3L4.3 2z"/></svg>',
  rename: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 9h4V6l5 5-5 5v-3h-4v3l-5-5 5-5v3z"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2zM4 6h16v1H4V6z"/></svg>',
  newfolder: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9h-7V4zm4 8h-3v3h-2v-3H9v-2h3V7h2v3h3v2z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 0 1 6 0v3H9z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 3h2v9h3l-4 4-4-4h3V3zM5 19h14v2H5v-2z"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 3v2h3.6l-9.3 9.3 1.4 1.4L19 6.4V10h2V3h-7zM5 5h6V5H5v14h14v-6h2v8H3V5h2z"/></svg>',
};

const state = {
  title: 'Elist',
  path: '/',
  view: localStorage.getItem('elist.view') || 'grid',
  sort: localStorage.getItem('elist.sort') || 'name_asc',
  entries: [],
  passwords: [],
  admin: false,
  adminPw: sessionStorage.getItem('elist.adminPw') || '',
  loading: false,
  error: null,
  lockedAt: null,
  search: '',
  drives: [],
  showHidden: false,
};

// ---------------- 工具 ----------------
const enc = encodeURIComponent;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
function ext(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}
function basename(p) { const i = p.lastIndexOf('/'); return p.slice(i + 1); }
function parentDir(p) { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
function joinPath(dir, name) {
  if (dir === '/' || dir === '') return '/' + name;
  return dir.replace(/\/$/, '') + '/' + name;
}
function fmtSize(b) {
  if (b == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return (i === 0 ? b : b.toFixed(b < 10 ? 2 : 1)) + ' ' + u[i];
}
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleString();
}
function mediaType(name) {
  const e = ext(name);
  if (['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ogv', 'avi'].includes(e)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'].includes(e)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(e)) return 'image';
  if (['pdf'].includes(e)) return 'pdf';
  if (['txt', 'md', 'markdown', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'css', 'scss',
    'html', 'htm', 'xml', 'log', 'csv', 'yaml', 'yml', 'sh', 'bash', 'toml', 'ini', 'conf',
    'java', 'c', 'cpp', 'h', 'go', 'rs', 'php', 'sql', 'gitignore'].includes(e)) return 'text';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(e)) return 'office';
  return 'other';
}

// ---------------- API ----------------
function pwHeader() {
  const h = {};
  if (state.passwords.length) h['X-Folder-Password'] = state.passwords.join(',');
  return h;
}
class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}
async function handleRes(res) {
  if (res.status === 401 || res.status === 403) {
    let data = {};
    try { data = await res.json(); } catch {}
    if (data.error === 'password_required') {
      const e = new ApiError('password_required', res.status);
      e.lockedAt = data.lockedAt;
      throw e;
    }
    throw new ApiError(data.error || ('HTTP ' + res.status), res.status);
  }
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch {}
    throw new ApiError(data.error || ('HTTP ' + res.status), res.status);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}
async function apiGet(url) {
  return handleRes(await fetch(url, { headers: pwHeader() }));
}
async function apiSend(url, body, { admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers['X-Admin-Password'] = state.adminPw;
  Object.assign(headers, pwHeader());
  return handleRes(await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }));
}
async function apiAuth(url, opts = {}) {
  return handleRes(await fetch(url, opts));
}

// ---------------- 导航 ----------------
async function browse(path, { fresh = false, search = null } = {}) {
  state.path = path;
  state.search = search || '';
  state.loading = true;
  state.error = null;
  state.lockedAt = null;
  render();
  try {
    let data;
    if (state.search) {
      data = await apiGet(`/api/search?q=${enc(state.search)}&path=${enc(path)}`);
    } else {
      data = await apiGet(`/api/list?path=${enc(path)}&sort=${state.sort}${fresh ? '&fresh=1' : ''}`);
    }
    state.entries = Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.message === 'password_required') {
      state.lockedAt = e.lockedAt;
      const pw = await promptPassword(e.lockedAt);
      if (pw) { state.passwords.push(pw); return browse(path, { fresh: true, search }); }
      state.error = '需要密码才能访问该目录';
    } else {
      state.error = e.message || '加载失败';
    }
  } finally {
    state.loading = false;
    render();
  }
}

function applySort(key) {
  const [k, d] = state.sort.split('_');
  const desc = (k === key) ? d !== 'desc' : false;
  state.sort = `${key}_${desc ? 'desc' : 'asc'}`;
  localStorage.setItem('elist.sort', state.sort);
  browse(state.path, { fresh: true });
}

async function loadSidebar() {
  try {
    const data = await apiGet('/api/list?path=/');
    state.drives = Array.isArray(data) ? data : [];
  } catch (_) { state.drives = []; }
}

// ---------------- 渲染 ----------------
function render() {
  const adminLabel = state.admin ? '管理员 ●' : '管理员';
  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="side-head">
          <div class="logo">E</div>
          <div class="brand">${esc(state.title)}<span class="dot">.</span></div>
        </div>
        <div class="side-section">盘符 / 挂载</div>
        <nav class="drives" id="drives"></nav>
        <div class="side-foot">
          <div class="admin-state ${state.admin ? 'on' : ''}">${state.admin ? '● 已登录管理员' : '○ 未登录'}</div>
          <button class="btn block" id="admin">${ICON.lock}<span>${adminLabel}</span></button>
          <button class="btn block icon" id="theme"><span>◐</span><span>切换主题</span></button>
        </div>
      </aside>
      <main class="main">
        <div class="toolbar">
          <div class="breadcrumb" id="crumbs"></div>
          <div class="search"><input id="search" placeholder="搜索当前目录…" value="${esc(state.search)}"/></div>
          <div class="seg" id="viewseg">
            <button data-view="list" class="${state.view === 'list' ? 'active' : ''}">${ICON.list}<span>列表</span></button>
            <button data-view="grid" class="${state.view === 'grid' ? 'active' : ''}">${ICON.grid}<span>网格</span></button>
          </div>
          <select class="input" id="sortsel">
            <option value="name_asc"${state.sort === 'name_asc' ? ' selected' : ''}>名称 ↑</option>
            <option value="name_desc"${state.sort === 'name_desc' ? ' selected' : ''}>名称 ↓</option>
            <option value="time_desc"${state.sort === 'time_desc' ? ' selected' : ''}>时间 ↓</option>
            <option value="time_asc"${state.sort === 'time_asc' ? ' selected' : ''}>时间 ↑</option>
            <option value="size_desc"${state.sort === 'size_desc' ? ' selected' : ''}>大小 ↓</option>
            <option value="size_asc"${state.sort === 'size_asc' ? ' selected' : ''}>大小 ↑</option>
          </select>
          <button class="btn" id="refresh" title="刷新">刷新</button>
          ${state.admin ? `<button class="btn primary" id="newfolder">${ICON.newfolder}<span>新建</span></button>` : ''}
        </div>
        <div class="content" id="content"></div>
      </main>
    </div>`;
  renderDrives();
  renderCrumbs();
  renderContent();
  bindToolbar();
  bindSidebar();
}

function renderDrives() {
  const box = document.getElementById('drives');
  const home = `<button class="drive ${state.path === '/' ? 'active' : ''}" data-path="/">${ICON.home}<span class="name">根目录</span></button>`;
  const items = state.drives.map((d) => {
    const active = state.path === d.path || state.path.startsWith(d.path + '/') ? 'active' : '';
    return `<button class="drive ${active}" data-path="${esc(d.path)}">${ICON.drive}<span class="name">${esc(d.name)}</span></button>`;
  }).join('');
  box.innerHTML = home + items;
}

function renderCrumbs() {
  const box = document.getElementById('crumbs');
  const parts = state.path.split('/').filter(Boolean);
  const crumbs = [{ name: '根', path: '/' }];
  let acc = '';
  for (const p of parts) { acc += '/' + p; crumbs.push({ name: p, path: acc }); }
  box.innerHTML = crumbs.map((c, i) => {
    const cur = i === crumbs.length - 1;
    const sep = i > 0 ? '<span class="crumb-sep">/</span>' : '';
    return `${sep}<button class="crumb${cur ? ' current' : ''}" data-path="${esc(c.path)}">${esc(c.name)}</button>`;
  }).join('');
  box.querySelectorAll('.crumb').forEach((b) => { b.onclick = () => browse(b.dataset.path); });
}

function renderContent() {
  const c = document.getElementById('content');
  if (state.loading) { c.innerHTML = `<div class="state-msg">加载中…</div>`; return; }
  if (state.error) { c.innerHTML = `<div class="state-msg"><div class="err">${esc(state.error)}</div></div>`; return; }
  if (!state.entries.length) {
    c.innerHTML = `<div class="state-msg">${state.search ? '无匹配结果' : '空目录'}</div>`;
    return;
  }
  c.innerHTML = state.view === 'list' ? renderList() : renderGrid();
  bindItems(c);
}

function itemActionsHtml(entry) {
  if (!state.admin) return '';
  return `<div class="fab-acts">
    <button class="btn sm" data-act="rename" data-path="${esc(entry.path)}" title="重命名">${ICON.rename}</button>
    <button class="btn sm" data-act="move" data-path="${esc(entry.path)}" title="移动">${ICON.move}</button>
    <button class="btn sm" data-act="hide" data-path="${esc(entry.path)}" title="隐藏/取消隐藏">${ICON.hide}</button>
    <button class="btn sm danger" data-act="delete" data-path="${esc(entry.path)}" title="删除">${ICON.del}</button>
  </div>`;
}

function renderList() {
  const rows = state.entries.map((e) => {
    const icon = e.isDir ? ICON.dir : ICON.file;
    return `<tr class="row" data-path="${esc(e.path)}" data-dir="${e.isDir ? 1 : 0}">
      <td class="name"><span class="label">${icon}<span class="txt">${esc(e.name)}</span></span></td>
      <td class="size">${e.isDir ? '' : esc(fmtSize(e.size))}</td>
      <td class="mod">${esc(fmtDate(e.modified))}</td>
      <td class="acts">${itemActionsHtml(e)}</td>
    </tr>`;
  }).join('');
  return `<table class="list">
    <thead><tr>
      <th data-sort="name">名称</th><th data-sort="size">大小</th>
      <th data-sort="time">修改时间</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderGrid() {
  const cards = state.entries.map((e) => {
    const icon = e.isDir ? ICON.dir : ICON.file;
    return `<div class="card" data-path="${esc(e.path)}" data-dir="${e.isDir ? 1 : 0}">
      <div class="thumb">${icon}</div>
      <div class="name">${esc(e.name)}</div>
      <div class="meta">${e.isDir ? '文件夹' : esc(fmtSize(e.size))}</div>
      <div class="acts">${itemActionsHtml(e)}</div>
    </div>`;
  }).join('');
  return `<div class="grid">${cards}</div>`;
}

function bindItems(c) {
  c.querySelectorAll('.row, .card').forEach((el) => {
    el.onclick = (ev) => {
      if (ev.target.closest('[data-act]')) return;
      const entry = state.entries.find((x) => x.path === el.dataset.path);
      if (!entry) return;
      if (entry.isDir) browse(entry.path);
      else openPreview(entry);
    };
  });
  c.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      const path = btn.dataset.path;
      const entry = state.entries.find((x) => x.path === path);
      const act = btn.dataset.act;
      if (act === 'rename') doRename(entry);
      else if (act === 'move') doMove(entry);
      else if (act === 'hide') setFolderPassword(path);
      else if (act === 'delete') doDelete(entry);
    };
  });
}

function bindSidebar() {
  document.getElementById('drives').querySelectorAll('.drive').forEach((b) => {
    b.onclick = () => browse(b.dataset.path);
  });
}

function bindToolbar() {
  document.getElementById('viewseg').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { state.view = b.dataset.view; localStorage.setItem('elist.view', state.view); render(); };
  });
  const sortsel = document.getElementById('sortsel');
  sortsel.onchange = () => { state.sort = sortsel.value; localStorage.setItem('elist.sort', state.sort); browse(state.path, { fresh: true }); };
  document.getElementById('refresh').onclick = () => browse(state.path, { fresh: true });
  document.getElementById('theme').onclick = toggleTheme;
  document.getElementById('admin').onclick = () => state.admin ? adminMenu() : login();

  const nf = document.getElementById('newfolder');
  if (nf) nf.onclick = () => doMkdir();

  const search = document.getElementById('search');
  let t;
  search.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = search.value.trim();
      if (q) browse(state.path, { search: q });
      else browse(state.path);
    }, 300);
  };

  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.onclick = () => applySort(th.dataset.sort);
  });
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('elist.theme', next);
}

// ---------------- 模态框 ----------------
function openModal(node) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.appendChild(node);
  modalRoot.appendChild(bd);
  bd.addEventListener('click', (e) => { if (e.target === bd) closeModal(bd); });
  return bd;
}
function closeModal(bd) { bd.remove(); }
function escClose(e) { if (e.key === 'Escape') { const b = modalRoot.lastElementChild; if (b) b.remove(); } }
document.addEventListener('keydown', escClose);

function promptText({ title, label, value = '', placeholder = '', type = 'text' }) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<h3>${esc(title)}</h3>
      <div class="field"><label>${esc(label)}</label>
      <input class="input" id="v" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"/></div>
      <div class="row-actions">
        <button class="btn ghost" id="cancel">取消</button>
        <button class="btn primary" id="ok">确定</button>
      </div>`;
    const bd = openModal(m);
    const input = m.querySelector('#v');
    input.focus(); input.select();
    const done = (v) => { closeModal(bd); resolve(v); };
    m.querySelector('#ok').onclick = () => done(input.value);
    m.querySelector('#cancel').onclick = () => done(null);
    input.onkeydown = (e) => { if (e.key === 'Enter') done(input.value); };
  });
}

function promptPassword(lockedAt) {
  return promptText({
    title: '需要密码',
    label: `该目录受密码保护${lockedAt ? '：' + lockedAt : ''}`,
    type: 'password',
    placeholder: '目录密码',
  });
}

function alertModal(title, msg, kind = '') {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<h3>${esc(title)}</h3>
      <div class="notice ${kind}">${esc(msg)}</div>
      <div class="row-actions"><button class="btn primary" id="ok">知道了</button></div>`;
    const bd = openModal(m);
    m.querySelector('#ok').onclick = () => { closeModal(bd); resolve(); };
  });
}

// ---------------- 管理员 ----------------
async function login() {
  const pw = await promptText({ title: '管理员登录', label: '管理员密码', type: 'password' });
  if (pw === null) return;
  try {
    const data = await apiSend('/api/admin/login', { password: pw });
    if (data.success) {
      state.adminPw = pw; state.admin = true;
      sessionStorage.setItem('elist.adminPw', pw);
      render();
    }
  } catch (e) {
    if (e.message === '密码未设置') {
      alertModal('密码未设置',
        '管理员密码（admin_password）当前为空。请先在存储根目录的 .elist.xlsx 配置表 config 工作表中，将 admin_password 设为非空值并保存，再登录。',
        'warn');
    } else if (e.message === '密码错误') {
      alertModal('登录失败', '密码错误，请重试。', 'danger');
    } else {
      alertModal('登录失败', e.message, 'danger');
    }
  }
}

function adminMenu() {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<h3>管理员</h3>
    <div class="field"><div class="notice">已登录。可管理当前目录密码、隐藏目录、新建文件夹，或重命名/移动/删除文件（鼠标悬停条目右侧按钮）。</div></div>
    <div class="row-actions" style="flex-direction:column;align-items:stretch;gap:8px">
      <button class="btn block" id="setpw">${ICON.lock}<span>设置当前目录密码</span></button>
      <button class="btn block" id="newfolder">${ICON.newfolder}<span>新建文件夹</span></button>
      <button class="btn block" id="savecfg">${ICON.grid}<span>保存配置</span></button>
      <button class="btn block danger" id="logout">${ICON.del}<span>登出</span></button>
    </div>`;
  const bd = openModal(m);
  m.querySelector('#setpw').onclick = () => { closeModal(bd); setFolderPassword(state.path); };
  m.querySelector('#newfolder').onclick = () => { closeModal(bd); doMkdir(); };
  m.querySelector('#savecfg').onclick = async () => {
    closeModal(bd);
    try { await apiAuth('/api/admin/save', { method: 'POST' }); alertModal('已保存', '配置已写回 .elist.xlsx。', 'ok'); }
    catch (e) { alertModal('保存失败', e.message, 'danger'); }
  };
  m.querySelector('#logout').onclick = () => {
    closeModal(bd);
    state.admin = false; state.adminPw = '';
    sessionStorage.removeItem('elist.adminPw');
    render();
  };
}

async function setFolderPassword(path) {
  let cur = { password: '', hint: '', hidden: false };
  try { cur = await apiAuth(`/api/admin/config?path=${enc(path)}`); } catch (e) {}
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<h3>目录设置：${esc(basename(path) || '根')}</h3>
    <div class="field"><label>路径</label><input class="input" value="${esc(path)}" disabled/></div>
    <div class="field"><label>访问密码（留空=取消密码）</label><input class="input" id="pw" type="text" value="${esc(cur.password || '')}"/></div>
    <div class="field"><label>提示（可选）</label><input class="input" id="hint" value="${esc(cur.hint || '')}"/></div>
    <div class="field"><label class="checkbox"><input type="checkbox" id="hidden" ${cur.hidden ? 'checked' : ''}/> 在列表中隐藏此目录</label></div>
    <div class="row-actions">
      <button class="btn ghost" id="cancel">取消</button>
      <button class="btn primary" id="ok">保存</button>
    </div>`;
  const bd = openModal(m);
  m.querySelector('#ok').onclick = async () => {
    const pw = m.querySelector('#pw').value;
    const hint = m.querySelector('#hint').value;
    const hidden = m.querySelector('#hidden').checked;
    const btn = m.querySelector('#ok');
    btn.disabled = true;
    try {
      await apiAuth('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, password: pw, hint, hidden }),
      });
      await apiAuth('/api/admin/save', { method: 'POST' });
      closeModal(bd);
      alertModal('已保存', (hidden ? '目录已隐藏。' : '目录设置已更新。'), 'ok');
      // 若隐藏了当前目录或父链，刷新列表
      await loadSidebar();
      browse(state.path, { fresh: true });
    } catch (e) { btn.disabled = false; alertModal('保存失败', e.message, 'danger'); }
  };
  m.querySelector('#cancel').onclick = () => closeModal(bd);
}

// ---------------- 文件操作 ----------------
async function doMkdir() {
  const name = await promptText({ title: '新建文件夹', label: '文件夹名称', placeholder: '新文件夹' });
  if (!name) return;
  const target = joinPath(state.path, name);
  try {
    await apiSend('/api/file/mkdir', { path: target }, { admin: true });
    browse(state.path, { fresh: true });
  } catch (e) { alertModal('创建失败', e.message, 'danger'); }
}
async function doRename(entry) {
  const name = await promptText({ title: '重命名', label: '新名称', value: basename(entry.path) });
  if (!name || name === basename(entry.path)) return;
  const target = joinPath(parentDir(entry.path), name);
  try {
    await apiSend('/api/file/move', { sourcePath: entry.path, targetPath: target }, { admin: true });
    browse(state.path, { fresh: true });
  } catch (e) { alertModal('重命名失败', e.message, 'danger'); }
}
async function doMove(entry) {
  const target = await promptText({ title: '移动', label: '目标完整路径', value: entry.path });
  if (!target || target === entry.path) return;
  try {
    await apiSend('/api/file/move', { sourcePath: entry.path, targetPath: target }, { admin: true });
    browse(state.path, { fresh: true });
  } catch (e) { alertModal('移动失败', e.message, 'danger'); }
}
async function doDelete(entry) {
  const ok = await promptText({ title: '删除确认', label: `确定删除「${entry.name}」？输入 YES 确认`, placeholder: 'YES' });
  if (ok !== 'YES') return;
  try {
    await apiSend('/api/file/delete', { path: entry.path }, { admin: true });
    browse(state.path, { fresh: true });
  } catch (e) { alertModal('删除失败', e.message, 'danger'); }
}

// ---------------- 预览 ----------------
let plyrPromise = null;
function loadPlyr() {
  if (window.Plyr) return Promise.resolve(window.Plyr);
  if (plyrPromise) return plyrPromise;
  plyrPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/vendor/plyr.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = '/vendor/plyr.polyfilled.min.js';
    s.onload = () => resolve(window.Plyr);
    s.onerror = () => reject(new Error('plyr load failed'));
    document.head.appendChild(s);
  });
  return plyrPromise;
}

async function openPreview(entry) {
  const type = mediaType(entry.name);
  const m = document.createElement('div');
  m.className = 'modal preview-modal';
  m.innerHTML = `<h3 style="display:flex;justify-content:space-between;align-items:center">
      <span>${esc(entry.name)}</span>
      <button class="btn ghost sm" id="x">✕</button></h3>
    <div class="preview-body" id="pb"><div class="state-msg">加载中…</div></div>`;
  const bd = openModal(m);
  m.querySelector('#x').onclick = () => closeModal(bd);

  const pb = m.querySelector('#pb');
  const metaBar = `<div class="preview-meta"><span>${type === 'other' ? '文件' : type}</span>${entry.size != null ? `<span>${esc(fmtSize(entry.size))}</span>` : ''}</div>`;

  try {
    if (type === 'video' || type === 'audio' || type === 'image' || type === 'pdf') {
      const { url } = await apiGet(`/api/link?path=${enc(entry.path)}`);
      if (type === 'image') {
        pb.innerHTML = metaBar + `<img src="${esc(url)}" alt="${esc(entry.name)}"/>`;
      } else if (type === 'pdf') {
        pb.innerHTML = metaBar + `<iframe src="${esc(url)}"></iframe>`;
      } else if (type === 'video' || type === 'audio') {
        pb.innerHTML = metaBar + `<div id="media"></div><div class="preview-bar">
          <button class="btn" id="opennew">${ICON.external}<span>新窗口</span></button>
          <button class="btn primary" id="dl">${ICON.download}<span>下载</span></button></div>`;
        const media = m.querySelector('#media');
        const el = document.createElement(type);
        el.controls = true;
        const src = document.createElement('source');
        src.src = url;
        el.appendChild(src);
        media.appendChild(el);
        try {
          const Plyr = await loadPlyr();
          new Plyr(el, {
            controls: type === 'video'
              ? ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'fullscreen']
              : ['play', 'progress', 'current-time', 'duration', 'mute', 'volume'],
          });
        } catch (_) { /* 原生 controls 已兜底，自带进度条 */ }
        m.querySelector('#opennew').onclick = () => window.open(url, '_blank');
        m.querySelector('#dl').onclick = () => window.open(url, '_blank');
      }
    } else if (type === 'text') {
      const { url } = await apiGet(`/api/link?path=${enc(entry.path)}`);
      try {
        const txt = await (await fetch(url)).text();
        pb.innerHTML = metaBar + `<pre>${esc(txt)}</pre><div class="preview-bar">
          <button class="btn primary" id="dl">${ICON.download}<span>下载</span></button></div>`;
        m.querySelector('#dl').onclick = () => window.open(url, '_blank');
      } catch (_) {
        pb.innerHTML = metaBar + `<div class="notice">无法内联读取（可能跨域），可下载查看。</div>
          <div class="preview-bar"><button class="btn primary" id="dl">${ICON.download}<span>下载</span></button></div>`;
        m.querySelector('#dl').onclick = () => window.open(url, '_blank');
      }
    } else {
      const { url } = await apiGet(`/api/link?path=${enc(entry.path)}`);
      pb.innerHTML = metaBar + `<div class="notice">该类型暂不支持内联预览，请下载查看。</div>
        <div class="preview-bar"><button class="btn primary" id="dl">${ICON.download}<span>下载</span></button></div>`;
      m.querySelector('#dl').onclick = () => window.open(url, '_blank');
    }
  } catch (e) {
    if (e.message === 'password_required') {
      const pw = await promptPassword(e.lockedAt);
      if (pw) { state.passwords.push(pw); return openPreview(entry); }
      pb.innerHTML = `<div class="notice danger">需要密码</div>`;
    } else {
      pb.innerHTML = `<div class="notice danger">预览失败：${esc(e.message)}</div>`;
    }
  }
}

// ---------------- 启动 ----------------
async function init() {
  const t = localStorage.getItem('elist.theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
  try {
    const cfg = await apiGet('/api/config');
    if (cfg && cfg.title) state.title = cfg.title;
  } catch (_) {}
  await loadSidebar();
  render();
  browse('/');
}
init();
