// ============================================================
//  Elist 前端 —— 零构建原生 SPA（带左侧栏 + 全量预览）
//  性能优先：无框架运行时、静态 CSS、所有预览库(vendor)按需懒加载，
//  媒体用 Plyr（失败回退原生 controls），其余预览类型 lazyload 本地库。
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
  up: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 19V6.8L5.4 12.4 4 11l8-8 8 8-1.4 1.4L13 6.8V19h-2z"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5z"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3v10.6A4 4 0 1 0 11 17V7h6V3H9z"/></svg>',
  archive: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v3H2V6a2 2 0 0 1 2-2zM2 11h20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9zm7 2v2h6v-2H9z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5zM9 12v2h6v-2H9zm0 4v2h6v-2H9z"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.7 6 3.4 12l5.3 6 1.4-1.4L6.2 12l3.9-4.6L8.7 6zm6.6 0-1.4 1.4L17.8 12l-3.9 4.6 1.4 1.4 5.3-6-5.3-6z"/></svg>',
  txt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5zM9 13v2h6v-2H9z"/></svg>',
  img: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5 17l4-5 3 3 3-4 4 6H5z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
};

const state = {
  title: 'Elist',
  path: '/',
  view: localStorage.getItem('elist.view') || 'list',
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
  selected: new Set(),
  dirEntries: [],      // 当前目录完整 listing（未搜索），供纯前端过滤复用
  listedPath: null,    // dirEntries 对应的 path，变化时重新拉取
  searchedRoot: false, // 上次拉取是否为根目录搜索结果（用于清空搜索时回退到普通列表）
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
// 子目录条目后端不再下发 name（恒等于 basename(path)）；根目录盘标题保留。
// 此处统一补回 name，避免下游渲染/排序逻辑改动。
function normalizeEntries(arr) {
  for (const e of arr) if (e.name == null) e.name = basename(e.path);
  return arr;
}
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
  if (['zip'].includes(e)) return 'zip';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(e)) return 'office';
  if (['ttf', 'otf', 'woff', 'woff2'].includes(e)) return 'font';
  if (['md', 'markdown'].includes(e)) return 'markdown';
  if (e === 'json') return 'json';
  if (['csv', 'tsv'].includes(e)) return 'csv';
  if (['yaml', 'yml'].includes(e)) return 'yaml';
  if (e === 'xml') return 'xml';
  const CODE = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp',
    'css', 'scss', 'html', 'htm', 'sh', 'bash', 'zsh', 'sql', 'go', 'rs',
    'rb', 'php'];
  if (CODE.includes(e)) return 'code';
  if (['txt', 'log', 'ini', 'conf', 'toml', 'gitignore', 'env', 'properties'].includes(e)) return 'text';
  return 'other';
}
function isImageName(name) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext(name));
}
// 条目类型排序权重（网格按类型分组）
function typeRank(entry) {
  if (entry.isDir) return 0;
  switch (mediaType(entry.name)) {
    case 'video': return 1;
    case 'audio': return 2;
    case 'image': return 3;
    case 'zip': return 4;
    case 'office': return 5;
    case 'code': return 6;
    default: return 7; // text/markdown/json/csv/yaml/xml/other
  }
}
// 条目类型图标（网格/列表按类别区分）
function entryIcon(entry) {
  if (entry.isDir) return { svg: ICON.dir, cls: 'dir' };
  switch (mediaType(entry.name)) {
    case 'video': return { svg: ICON.video, cls: 'video' };
    case 'audio': return { svg: ICON.audio, cls: 'audio' };
    case 'image': return { svg: ICON.img, cls: 'image' };
    case 'zip': return { svg: ICON.archive, cls: 'archive' };
    case 'office': return { svg: ICON.doc, cls: 'doc' };
    case 'code': return { svg: ICON.code, cls: 'code' };
    default: return { svg: ICON.txt, cls: 'text' };
  }
}
function formatXml(xml) {
  try {
    let out = '', indent = 0;
    const cleaned = xml.replace(/>\s*</g, '><');
    const tokens = cleaned.match(/<[^>]+>|[^<]+/g) || [];
    for (const t of tokens) {
      if (t.startsWith('</')) indent--;
      out += '\n' + '  '.repeat(Math.max(0, indent)) + t;
      if (t.startsWith('<') && !t.startsWith('</') && !t.endsWith('/>')) indent++;
    }
    return out.trim();
  } catch { return xml; }
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
  const headers = pwHeader();
  // 已登录管理员：带头，后端放行隐藏目录并返回 hidden/locked 标记
  if (state.adminPw) headers['X-Admin-Password'] = state.adminPw;
  return handleRes(await fetch(url, { headers }));
}
async function apiSend(url, body, { admin = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin) headers['X-Admin-Password'] = state.adminPw;
  Object.assign(headers, pwHeader());
  return handleRes(await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }));
}
async function apiAdminGet(url) {
  return handleRes(await fetch(url, { headers: { 'X-Admin-Password': state.adminPw } }));
}

// 本地 vendor 库懒加载（按需、缓存、走 CF 边缘）
const libCache = {};
function loadScript(url) {
  if (libCache[url]) return libCache[url];
  libCache[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => { delete libCache[url]; reject(new Error('加载失败: ' + url)); };
    document.head.appendChild(s);
  });
  return libCache[url];
}
function loadCssOnce(href) {
  if (document.querySelector('link[href="' + href + '"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

// ---------------- 导航 ----------------
async function browse(path, { fresh = false, search = null } = {}) {
  state.path = path;
  state.search = search || '';
  state.loading = true;
  state.error = null;
  state.lockedAt = null;
  // 同步地址栏：让目录分享链接 / 刷新后保持当前目录（文件夹复制链接即 /?path=<enc>）
  try {
    const u = path && path !== '/' ? '/?path=' + encodeURIComponent(path) : '/';
    history.replaceState(null, '', u);
  } catch (_) {}
  render();
  try {
    // 根目录搜索需跨盘扫描，仍走后端 /api/search；子目录内搜索改为纯前端过滤（零 worker 往返）。
    const searchingRoot = !!state.search && path === '/';
    // 仅在以下情况重新拉取：强制刷新 / 切目录 / 根目录搜索 / 刚从根目录搜索清空（回退普通列表）。
    const needFetch = fresh || path !== state.listedPath || searchingRoot || (state.search === '' && state.searchedRoot);
    if (needFetch) {
      let data;
      if (searchingRoot) {
        data = await apiGet(`/api/search?q=${enc(state.search)}&path=/`);
        state.searchedRoot = true;
      } else {
        data = await apiGet(`/api/list?path=${enc(path)}${fresh ? '&fresh=1' : ''}`);
        state.searchedRoot = false;
      }
      state.dirEntries = normalizeEntries(Array.isArray(data) ? data : []);
      state.listedPath = path;
    }
    // 当前目录内搜索：直接对内存 listing 做前端过滤，输入即出、不消耗 CF CPU。
    let view = state.dirEntries;
    if (state.search && path !== '/') {
      const q = state.search.toLowerCase();
      view = state.dirEntries.filter((e) => e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q));
    }
    // 排序策略：
    // - 搜索结果：按 state.sort 普通排序（跨盘/跨目录结果，排序有意义）
    // - 根目录(盘列表)：保持服务端返回的挂载顺序（由 MOUNT_ORDER 变量控制，与左侧栏一致），
    //   列表/网格视图都按此顺序，不强制默认排序（用户：根目录文件夹按挂载顺序排列）
    // - 子目录网格视图：图片墙排序（可预览图片居上、其余按类型）
    // - 其余子目录列表视图：按 state.sort 前端排序（文件夹恒居上 + 所选字段；文件夹固定名称正序）
    if (state.search) {
      state.entries = clientSort(view, state.sort);
    } else if (path === '/') {
      state.entries = view;
    } else if (state.view === 'grid') {
      state.entries = wallSort(view);
    } else {
      state.entries = clientSort(view, state.sort);
    }
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

// 纯前端排序：仅本地重排已加载的 entries 并就地重绘，不重拉服务端、不丢缓存。
// 文件夹恒居上（与默认序一致），再按所选字段/方向排文件。
function clientSort(entries, spec) {
  const [key, dir] = (spec || 'name_asc').split('_');
  const desc = dir === 'desc';
  const dirs = entries.filter((e) => e.isDir);
  const files = entries.filter((e) => !e.isDir);
  const cmp = (a, b) => {
    let r = 0;
    if (key === 'name') r = String(a.name).localeCompare(String(b.name), 'zh');
    else if (key === 'time') r = (Date.parse(a.modified || '') || 0) - (Date.parse(b.modified || '') || 0);
    else if (key === 'size') r = (a.size || 0) - (b.size || 0);
    else if (key === 'type') { const ra = typeRank(a), rb = typeRank(b); r = ra === rb ? String(a.name).localeCompare(String(b.name), 'zh') : ra - rb; }
    return desc ? -r : r;
  };
  // 文件夹始终按名称正序固定，不参与大小/时间等排序的跳动（用户：文件夹不太想手动排序）
  dirs.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  files.sort(cmp);
  return [...dirs, ...files];
}

// 网格图片墙排序：与列表排序解耦——网格视图「只按类型排、可预览类在上边」。
// 可预览图片(直接图片预览)恒居最上（按名称），其余条目按类型权重(文件夹/视频/音频/压缩/文档/代码/其他)排序；
// 非图片条目统一以小图标瓦片呈现，故此排序即决定非均匀墙的上下分组。
function wallSort(entries) {
  const imgs = entries.filter((e) => !e.isDir && mediaType(e.name) === 'image');
  const rest = entries.filter((e) => !( !e.isDir && mediaType(e.name) === 'image'));
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'zh');
  imgs.sort(byName);
  rest.sort((a, b) => {
    const ra = typeRank(a), rb = typeRank(b);
    return ra === rb ? byName(a, b) : ra - rb;
  });
  return [...imgs, ...rest];
}

function applySort(key) {
  const [k, d] = state.sort.split('_');
  const desc = (k === key) ? d !== 'desc' : false;
  state.sort = `${key}_${desc ? 'desc' : 'asc'}`;
  localStorage.setItem('elist.sort', state.sort);
  state.entries = clientSort(state.entries, state.sort);
  render();
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
          ${state.view === 'grid' ? `<button class="btn sm" id="grid-selall">全选</button><button class="btn sm ghost" id="grid-selclear">清空</button>` : ''}
          <button class="btn" id="refresh" title="刷新">刷新</button>
        </div>
        <div class="content" id="content"></div>
      </main>
    </div>
    ${state.view === 'grid' ? `<div class="float-batch" id="floatbatch">
      <span class="fb-count" id="fb-count">已选 ${state.selected.size}</span>
      <button class="btn sm" id="selall">全选</button>
      <button class="btn sm" id="selinv">反选</button>
      <button class="btn sm" id="sellink">复制链接</button>
      <button class="btn sm primary" id="seldl">下载</button>
      <button class="btn sm ghost" id="selclear">✕ 清空</button>
    </div>` : ''}`;
  renderDrives();
  renderCrumbs();
  renderContent();
  bindToolbar();
  updateBatchUI();
}

function renderDrives() {
  const box = document.getElementById('drives');
  const home = `<button class="drive ${state.path === '/' ? 'active' : ''}" data-path="/">${ICON.home}<span class="name">根目录</span></button>`;
  const items = state.drives.map((d) => {
    const active = state.path === d.path || state.path.startsWith(d.path + '/') ? 'active' : '';
    // 与列表/网格一致：同步显示隐藏(👁)/加密(🔒)徽标（隐藏仅管理员可见，非管理员已被服务端过滤）
    return `<button class="drive ${active}" data-path="${esc(d.path)}">${ICON.drive}<span class="name">${esc(d.name)}</span>${badgesHtml(d)}</button>`;
  }).join('');
  box.innerHTML = home + items;
  box.querySelectorAll('.drive').forEach((b) => { b.onclick = () => browse(b.dataset.path); });
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
  // 加载中不显示任何文字（避免"加载中"出现位置问题），加载完直接出内容
  if (state.loading) { c.innerHTML = ''; return; }
  if (state.error) { c.innerHTML = `<div class="state-msg"><div class="err">${esc(state.error)}</div></div>`; return; }
  if (!state.entries.length) {
    c.innerHTML = `<div class="state-msg"><span class="state-ico">${state.search ? ICON.file : ICON.dir}</span>${state.search ? '无匹配结果' : '空目录'}</div>`;
    return;
  }
  c.innerHTML = state.view === 'list' ? renderList() : renderGrid();
  bindItems(c);
  bindLazyThumbs(c);
}

function itemActionsHtml(entry) {
  // 操作列仅管理员可见；非 admin 时 renderList 根本不渲染该列（含列头），故这里也守卫返回空。
  if (!state.admin) return '';
  return `<button class="btn sm icon row-menu" data-act="menu" data-path="${esc(entry.path)}" title="操作">${ICON.menu}</button>`;
}

// 隐藏/加密徽标（管理员可见隐藏目录时显示）
function badgesHtml(e) {
  return (e.hidden ? '<span class="badge" title="已隐藏">👁</span>' : '') +
         (e.locked ? '<span class="badge" title="已加密">🔒</span>' : '');
}

function renderList() {
  // 非 admin（未登录）：操作列整列不渲染（连列头都不显示）。admin 才渲染该列。
  const showActs = state.admin;
  const rows = state.entries.map((e) => {
    const ic = entryIcon(e);
    const isFile = !e.isDir;
    return `<tr class="row" data-path="${esc(e.path)}" data-dir="${e.isDir ? 1 : 0}">
      <td class="ck">${isFile ? `<input type="checkbox" class="ckbox" data-path="${esc(e.path)}" ${state.selected.has(e.path) ? 'checked' : ''}/>` : ''}</td>
      <td class="op">${isFile ? `<button class="btn sm icon" data-act="copyrow" data-path="${esc(e.path)}" title="复制链接">${ICON.external}</button>` : (e.isDir ? `<button class="btn sm icon" data-act="copydir" data-path="${esc(e.path)}" title="复制文件夹链接">${ICON.external}</button>` : '')}</td>
      <td class="op">${isFile ? `<button class="btn sm icon" data-act="dlrow" data-path="${esc(e.path)}" title="下载">${ICON.download}</button>` : ''}</td>
      <td class="name"><span class="label"><span class="glyph ${ic.cls}">${ic.svg}</span><span class="txt">${esc(e.name)}</span>${badgesHtml(e)}</span></td>
      ${showActs ? `<td class="acts">${itemActionsHtml(e)}</td>` : ''}
      <td class="size">${e.isDir ? '' : esc(fmtSize(e.size))}</td>
      <td class="mod">${esc(fmtDate(e.modified))}</td>
    </tr>`;
  }).join('');
  const files = state.entries.filter((e) => !e.isDir);
  const allChecked = files.length > 0 && files.every((e) => state.selected.has(e.path));
  const actsTh = showActs ? `<th class="acts"><button class="btn sm icon" data-act="actshead" title="管理">${ICON.menu}</button></th>` : '';
  // 当前排序列与方向，用于表头着色：正序=sort-asc，倒序=sort-desc（两种颜色，见 styles.css）
  const [sk, sd] = state.sort.split('_');
  const sortCls = (k) => (sk === k ? (sd === 'desc' ? 'sort-desc' : 'sort-asc') : '');
  return `<table class="list">
    <thead><tr>
      <th class="ck"><input type="checkbox" class="ckall" ${allChecked ? 'checked' : ''}/></th>
      <th class="op"><button class="btn sm icon" data-batchlink title="复制选中文件链接">${ICON.external}</button></th>
      <th class="op"><button class="btn sm icon" data-batchdl title="下载选中文件">${ICON.download}</button></th>
      <th class="name"><span class="label">
        <button class="glyph th-sort ${sortCls('type')}" data-sort="type" title="按类型排序">${ICON.grid}</button>
        <button class="txt th-sort ${sortCls('name')}" data-sort="name" title="按名称排序">名称</button>
      </span></th>
      ${actsTh}
      <th class="size ${sortCls('size')}" data-sort="size">大小</th>
      <th class="mod ${sortCls('time')}" data-sort="time">修改时间</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderGrid() {
  // 均匀网格：每张卡片等宽，图片封面(object-fit:cover)、其余居中类型图标，行列整齐不混乱。
  // 图片墙逻辑仅体现在排序(wallSort 把可预览图片排最上)，不靠瓦片尺寸差制造混乱。
  const cards = state.entries.map((e) => {
    const ic = entryIcon(e);
    const isImg = !e.isDir && mediaType(e.name) === 'image';
    const ck = e.isDir ? '' : `<span class="card-ck"><input type="checkbox" class="ckbox" data-path="${esc(e.path)}" ${state.selected.has(e.path) ? 'checked' : ''}/></span>`;
    const copyBtn = e.isDir
      ? `<button class="btn sm icon card-copy" data-act="copydir" data-path="${esc(e.path)}" title="复制文件夹链接">${ICON.external}</button>`
      : `<button class="btn sm icon card-copy" data-act="copyrow" data-path="${esc(e.path)}" title="复制链接">${ICON.external}</button>`;
    const thumb = isImg
      ? `<div class="thumb thumb-img"><img class="lazy" data-path="${esc(e.path)}" alt="" loading="lazy"/></div>`
      : `<div class="thumb thumb-ico"><span class="glyph ${ic.cls}">${ic.svg}</span></div>`;
    return `<div class="card" data-path="${esc(e.path)}" data-dir="${e.isDir ? 1 : 0}">
      ${ck}
      <div class="acts">${copyBtn}<button class="btn sm icon card-menu" data-act="menu" data-path="${esc(e.path)}" title="操作">${ICON.menu}</button></div>
      ${thumb}
      <div class="name">${esc(e.name)}${badgesHtml(e)}</div>
      <div class="meta">${e.isDir ? '文件夹' : esc(fmtSize(e.size))}</div>
    </div>`;
  }).join('');
  return `<div class="grid">${cards}</div>`;
}

function bindItems(c) {
  // 多选复选框（常驻勾选列）
  c.querySelectorAll('.ckbox').forEach((cb) => {
    cb.onclick = (ev) => ev.stopPropagation();
    cb.onchange = () => {
      const p = cb.dataset.path;
      if (cb.checked) state.selected.add(p);
      else state.selected.delete(p);
      updateBatchUI();
    };
  });
  // 表头全选（仅文件，目录不可多选）
  const ckall = c.querySelector('.ckall');
  if (ckall) ckall.onchange = () => {
    const files = state.entries.filter((e) => !e.isDir);
    if (ckall.checked) files.forEach((e) => state.selected.add(e.path));
    else files.forEach((e) => state.selected.delete(e.path));
    updateBatchUI();
  };
  // 链接/下载列头：批量复制/下载当前目录全部文件
  const thLink = c.querySelector('[data-batchlink]');
  if (thLink) thLink.onclick = (ev) => { ev.stopPropagation(); copySelectedLinks(thLink); };
  const thDl = c.querySelector('[data-batchdl]');
  if (thDl) thDl.onclick = (ev) => { ev.stopPropagation(); downloadSelected(thDl); };
  c.querySelectorAll('.row, .card').forEach((el) => {
    el.onclick = (ev) => {
      // 勾选列(.ck)与链接/下载列(.op)整列不触发预览或导航，留出点击误差空间
      if (ev.target.closest('[data-act]')) return;
      if (ev.target.closest('.ck, .op')) return;
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
      else if (act === 'menu') entryMenu(entry);
      else if (act === 'copyrow') copyRowLink(path, entry.name, btn);
      else if (act === 'dlrow') downloadRow(path, entry.name, btn);
      else if (act === 'copydir') copyFolderLink(path, btn);
      else if (act === 'actshead') headerMenu();
    };
  });
  // 列头排序：每次列表重建后重新绑定（含名称列内的 type/name 两个触发区）
  c.querySelectorAll('[data-sort]').forEach((el) => {
    el.onclick = () => applySort(el.dataset.sort);
  });
}

// 列头「管理」图标弹出的全局操作菜单（含新建文件夹，替代原工具栏新建按钮）
function headerMenu() {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<h3>管理</h3>
    <div class="row-actions" style="flex-direction:column;align-items:stretch;gap:8px">
      <button class="btn block" data-act="mkdir">${ICON.newfolder}<span>新建文件夹</span></button>
    </div>`;
  const bd = openModal(m);
  m.querySelector('[data-act="mkdir"]').onclick = () => { closeModal(bd); doMkdir(); };
}

// 网格卡片 ⋯ 操作菜单（盘符挂载根禁用移动/重命名/删除——移动根=整盘改名移走，危险）
function isDriveRoot(path) {
  return state.drives.some((d) => d.path === path);
}
function entryMenu(entry) {
  const driveRoot = isDriveRoot(entry.path);
  let opButtons;
  if (!state.admin) {
    // 非管理员：仅提供复制链接 / 下载（隐藏/重命名/移动/删除需管理员；文件夹无下载）
    opButtons = `<button class="btn block" data-op="copy">${ICON.external}<span>复制链接</span></button>`;
    if (!entry.isDir) opButtons += `<button class="btn block" data-op="dl">${ICON.download}<span>下载</span></button>`;
  } else if (driveRoot) {
    opButtons = `<button class="btn block" data-op="hide">${ICON.hide}<span>隐藏/加密</span></button>`;
  } else {
    opButtons = `<button class="btn block" data-op="rename">${ICON.rename}<span>重命名</span></button>
       <button class="btn block" data-op="move">${ICON.move}<span>移动</span></button>
       <button class="btn block" data-op="hide">${ICON.hide}<span>隐藏/加密</span></button>
       <button class="btn block danger" data-op="delete">${ICON.del}<span>删除</span></button>`;
  }
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<h3>${esc(entry.name)}</h3>
    <div class="row-actions" style="flex-direction:column;align-items:stretch;gap:8px">${opButtons}</div>`;
  const bd = openModal(m);
  if (!state.admin) {
    // 文件夹复制的是「进入该目录的浏览链接」(copyFolderLink)，文件才是 /api/raw 直链(copyRowLink)
    m.querySelector('[data-op="copy"]').onclick = (e) => { const b = e.currentTarget; (entry.isDir ? copyFolderLink(entry.path, b) : copyRowLink(entry.path, entry.name, b)); setTimeout(() => closeModal(bd), 220); };
    m.querySelector('[data-op="dl"]').onclick = (e) => { const b = e.currentTarget; downloadRow(entry.path, entry.name, b); setTimeout(() => closeModal(bd), 220); };
    return;
  }
  if (!driveRoot) {
    m.querySelector('[data-op="rename"]').onclick = () => { closeModal(bd); doRename(entry); };
    m.querySelector('[data-op="move"]').onclick = () => { closeModal(bd); doMove(entry); };
    m.querySelector('[data-op="delete"]').onclick = () => { closeModal(bd); doDelete(entry); };
  }
  m.querySelector('[data-op="hide"]').onclick = () => { closeModal(bd); setFolderPassword(entry.path); };
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
  document.getElementById('refresh').onclick = () => browse(state.path, { fresh: true });
  document.getElementById('theme').onclick = toggleTheme;
  document.getElementById('admin').onclick = () => state.admin ? adminMenu() : login();

  // 底部浮动批量条
  const selall = document.getElementById('selall');
  if (selall) selall.onclick = () => { state.entries.forEach((e) => state.selected.add(e.path)); updateBatchUI(); };
  const selinv = document.getElementById('selinv');
  if (selinv) selinv.onclick = () => {
    state.entries.forEach((e) => {
      if (state.selected.has(e.path)) state.selected.delete(e.path);
      else state.selected.add(e.path);
    });
    updateBatchUI();
  };
  const selclear = document.getElementById('selclear');
  if (selclear) selclear.onclick = () => { state.selected.clear(); updateBatchUI(); };
  const sellink = document.getElementById('sellink');
  if (sellink) sellink.onclick = copySelectedLinks;
  const seldl = document.getElementById('seldl');
  if (seldl) seldl.onclick = downloadSelected;

  // 网格视图：工具栏常驻 全选 / 清空（列表视图用表头复选框，网格无表头故单独提供）
  const gsa = document.getElementById('grid-selall');
  if (gsa) gsa.onclick = () => { state.entries.forEach((e) => state.selected.add(e.path)); updateBatchUI(); };
  const gsc = document.getElementById('grid-selclear');
  if (gsc) gsc.onclick = () => { state.selected.clear(); updateBatchUI(); };

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
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('elist.theme', next);
}

// 网格图片缩略图懒加载
function bindLazyThumbs(c) {
  const imgs = c.querySelectorAll('img.lazy');
  if (!imgs.length) return;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      es.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); loadThumb(en.target); } });
    }, { rootMargin: '300px' });
    imgs.forEach((img) => io.observe(img));
  } else {
    imgs.forEach((img) => loadThumb(img));
  }
}
async function loadThumb(img) {
  try {
    img.src = rawUrl(img.dataset.path);
  } catch { img.remove(); }
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
      // 登录后无感刷新：重新拉取侧栏与当前目录（带管理员态），仅更新显示，不整页 reload
      await loadSidebar();
      await browse(state.path, { fresh: true });
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

async function adminMenu() {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<h3>管理员</h3>
    <div class="admin-config-info" id="cfgInfo">
      <div class="cfg-row"><span class="cfg-label">配置文件账号</span><span class="cfg-val" id="cfgAccount">加载中…</span></div>
      <div class="cfg-row"><span class="cfg-label">配置文件路径</span><span class="cfg-val" id="cfgPath">—</span></div>
    </div>
    <div class="row-actions" style="flex-direction:column;align-items:stretch;gap:8px">
      <button class="btn block" id="e5test">${ICON.refresh}<span>测试所有 E5 续期 API</span></button>
      <button class="btn block danger" id="logout">${ICON.del}<span>登出</span></button>
    </div>
    <div id="e5result" class="e5-result" style="display:none"></div>`;
  const bd = openModal(m);
  // 拉取当前配置文件位置
  try {
    const info = await apiAdminGet('/api/admin/status');
    m.querySelector('#cfgAccount').textContent = info.account || '（无可用账号）';
    m.querySelector('#cfgPath').textContent = info.path || '—';
  } catch (e) {
    m.querySelector('#cfgAccount').textContent = '获取失败';
    m.querySelector('#cfgPath').textContent = e.message || '—';
  }
  m.querySelector('#e5test').onclick = async () => {
    const btn = m.querySelector('#e5test');
    const box = m.querySelector('#e5result');
    btn.disabled = true;
    box.style.display = 'block';
    box.textContent = '正在真实跑全部 E5 续期 API（建/改/读/删）…';
    try {
      const r = await apiSend('/api/admin/e5rnl-test', {}, { admin: true });
      if (!r.ok) {
        box.className = 'e5-result fail';
        box.textContent = '测试失败：' + (r.error || r.message || '未知错误');
        btn.disabled = false;
        return;
      }
      // 按账号汇总每 action 结果
      let html = '<div class="e5-sum">测试完成，按账号结果：</div>';
      for (const item of r.results) {
        const ok = item.results.filter((x) => x.ok && !x.skipped).length;
        const total = item.results.filter((x) => !x.skipped).length;
        const fails = item.results.filter((x) => !x.ok && !x.skipped);
        html += `<div class="e5-acc"><div class="e5-acc-h">${esc(item.key)} — ${ok}/${total} 成功</div>`;
        if (fails.length) {
          html += '<div class="e5-fails">' + fails.map((f) => {
            const label = f.requiresPermission ? `需授权 ${f.requiresPermission}` : (f.error || '失败');
            return `<span class="e5-${f.requiresPermission ? 'perm' : 'err'}">${esc(f.action)}: ${esc(label)}</span>`;
          }).join('<br/>') + '</div>';
        }
        html += '</div>';
      }
      // 缺失权限汇总（一次性授予即可让灰色项转绿）
      if (r.missingPermissions && r.missingPermissions.length) {
        html += `<div class="e5-perm-sum"><strong>需在 Entra ID 为应用授予并管理员同意以下 Graph 权限：</strong><br/>`
          + r.missingPermissions.map((p) => `<code>${esc(p)}</code>`).join('、') + '</div>';
      }
      box.className = 'e5-result ok';
      box.innerHTML = html;
    } catch (e) {
      box.className = 'e5-result fail';
      box.textContent = '请求异常：' + e.message;
    }
    btn.disabled = false;
  };
  m.querySelector('#logout').onclick = () => {
    closeModal(bd);
    state.admin = false; state.adminPw = '';
    sessionStorage.removeItem('elist.adminPw');
    // 同步清除服务端种的 elist_admin cookie，使 /dav 网页视图的管理身份与本站登录态保持一致
    // （该 cookie 是 /dav 继承网页登录态的载体；不清则 /dav 仍显示管理员）。
    apiSend('/api/admin/logout', {}).catch(() => {});
    // 登出后无感刷新：重新拉取侧栏与当前目录（已无管理员态，隐藏项被服务端过滤），仅更新显示
    loadSidebar().then(() => browse(state.path, { fresh: true }));
  };
}

async function setFolderPassword(path) {
  let cur = { password: '', hint: '', hidden: false };
  try { cur = await apiAdminGet(`/api/admin/config?path=${enc(path)}`); } catch (e) {}
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
      await apiSend('/api/admin/config', { path, password: pw, hint, hidden }, { admin: true });
      await apiSend('/api/admin/save', {}, { admin: true });
      closeModal(bd);
      alertModal('已保存', (hidden ? '目录已隐藏。' : '目录设置已更新。'), 'ok');
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

// ---------------- 批量选择 ----------------
// 代理链接：完全由前端拼出（同源 /api/raw），无需打后端 round-trip。
// 复制链接与下载按钮共用这一口；download=true 切 attachment 触发下载。
// name: 已知文件名时附加到 URL 路径段（/api/raw/<enc name>?path=…），
// 使链接以真实扩展名结尾（兼容按后缀命名的顽固下载器，即 alist "Customised" 形式）；
// 缺失时回退短形式 /api/raw?path=…（由 Content-Disposition 的 filename* 正确命名）。
function rawUrl(path, download = false, name = '') {
  const q = `?path=${encodeURIComponent(path)}`;
  const seg = name ? `/${encodeURIComponent(name)}` : '';
  return `${location.origin}/api/raw${seg}${q}${download ? '&download=1' : ''}`;
}
// 复制链接 = 自适应链接（以文件名结尾，纯前端拼出，无后端请求）。
// 服务端按类型决定处置：图片/PDF/音视频/文本等内联预览，其余自动下载。
// 仍需强制下载时请用 triggerDownload（带 ?download=1）。
function getLink(path, name = '') { return rawUrl(path, false, name); }

// 打开预览前做一次极小权限探测（Range 0-0，只取状态、丢 body），
// 保留受密码保护目录的「需要密码」提示；复用 /api/raw 的同款门禁。
// 仅此主动动作触发一次请求，复制/下载/缩略图均不再打后端。
async function probeAccess(path) {
  const headers = pwHeader();
  if (state.adminPw) headers['X-Admin-Password'] = state.adminPw;
  headers['Range'] = 'bytes=0-0';
  const r = await fetch(rawUrl(path), { headers });
  if (r.body && r.body.cancel) { try { r.body.cancel(); } catch {} }
  if (r.status === 401 || r.status === 403) {
    let data = {};
    try { data = await r.json().catch(() => ({})); } catch {}
    if (data.error === 'password_required') {
      const e = new ApiError('password_required', r.status);
      e.lockedAt = data.lockedAt;
      throw e;
    }
    throw new ApiError(data.error || ('HTTP ' + r.status), r.status);
  }
  if (!r.ok && r.status !== 206) throw new ApiError('HTTP ' + r.status, r.status);
}
async function copyRowLink(path, name = '', el = null) {
  try {
    const url = await getLink(path, name);
    const ok = await copyShareLink(url);
    flash(el, ok);
    if (!ok) alertModal('复制失败', '浏览器禁止复制，请手动复制链接', 'danger');
  } catch (e) { flash(el, false); alertModal('复制失败', e.message, 'danger'); }
}
async function downloadRow(path, name = '', el = null) {
  try { triggerDownload(path, name); flash(el, true); }
  catch (e) { flash(el, false); alertModal('下载失败', e.message, 'danger'); }
}
// 复制文件夹链接：文件夹本身不可经 /api/raw 下载，其「链接」= 进入该目录的浏览页 URL
// （?path=<enc>），可直接分享、粘贴到浏览器即打开该目录。点击按钮变色反馈同文件复制。
async function copyFolderLink(path, el = null) {
  const url = `${location.origin}/?path=${encodeURIComponent(path)}`;
  const ok = await copyShareLink(url);
  flash(el, ok);
  if (!ok) alertModal('复制失败', '浏览器禁止复制，请手动复制链接', 'danger');
}
function updateBatchUI() {
  // 网格底部浮动条
  const fb = document.getElementById('floatbatch');
  const cnt = document.getElementById('fb-count');
  if (cnt) cnt.textContent = `已选 ${state.selected.size}`;
  if (fb) fb.style.display = state.selected.size ? 'flex' : 'none';
  // 行复选框与全选状态同步（全选只统计文件）
  document.querySelectorAll('.content .ckbox').forEach((cb) => { cb.checked = state.selected.has(cb.dataset.path); });
  const files = state.entries.filter((e) => !e.isDir);
  const all = document.querySelector('.list .ckall');
  if (all) all.checked = files.length > 0 && files.every((e) => state.selected.has(e.path));
}

// 触发下载：走复制链接同一口 /api/raw?download=1（worker 同域流式回传），
// 绝不跳转当前页、不弹多窗、不暴露存储直链、不受跨域 CORS 限制。
// 批量下载复用此函数错峰触发即可，不会破坏页面。
function triggerDownload(path, name = '') {
  const a = document.createElement('a');
  a.href = rawUrl(path, true, name);
  a.download = basename(path);
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function copySelectedLinks(btn = null) {
  const paths = [...state.selected];
  if (!paths.length) { if (btn) flash(btn, false); return; }
  const urls = [];
  for (const p of paths) {
    try {
      urls.push(await getLink(p));
    } catch { /* 单个失败跳过 */ }
  }
  if (!urls.length) { flash(btn, false); alertModal('复制失败', '未获取到任何直链', 'danger'); return; }
  const text = urls.join('\n');
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const i = document.createElement('textarea');
    i.value = text; document.body.appendChild(i); i.select();
    document.execCommand('copy'); i.remove();
    ok = true;
  }
  flash(btn, ok);
}
async function downloadSelected(btn = null) {
  const paths = [...state.selected];
  if (!paths.length) { if (btn) flash(btn, false); return; }
  let ok = 0;
  for (const p of paths) {
    try { triggerDownload(p); ok++; } catch { /* 跳过 */ }
    await new Promise((r) => setTimeout(r, 350)); // 错峰，避免浏览器合并/拦截
  }
  flash(btn, ok > 0);
}

// ---------------- 预览 ----------------
let plyrPromise = null;
function loadPlyr() {
  if (window.Plyr) return Promise.resolve(window.Plyr);
  if (plyrPromise) return plyrPromise;
  plyrPromise = new Promise((resolve, reject) => {
    loadCssOnce('/vendor/plyr.css');
    const s = document.createElement('script');
    s.src = '/vendor/plyr.polyfilled.min.js';
    s.onload = () => resolve(window.Plyr);
    s.onerror = () => reject(new Error('plyr load failed'));
    document.head.appendChild(s);
  });
  return plyrPromise;
}

function previewBar() {
  return `<div class="preview-controls">
    <button class="btn" data-act="copy">${ICON.external}<span>复制链接</span></button>
    <button class="btn primary" data-act="dl">${ICON.download}<span>下载</span></button>
  </div>`;
}
function bindPreviewBar(pb, url) {
  pb.querySelectorAll('[data-act="copy"]').forEach((b) => { b.onclick = () => { flash(b, true); copyShareLink(url).then((ok) => flash(b, ok)); }; });
  pb.querySelectorAll('[data-act="dl"]').forEach((b) => { b.onclick = () => { flash(b, true); window.open(url, '_blank'); }; });
}

async function openPreview(entry) {
  const m = document.createElement('div');
  m.className = 'modal preview-modal';
  m.innerHTML = `<h3 class="pv-title"><span class="pv-name">${esc(entry.name)}</span>
    <span class="pv-tools">
      <button class="btn ghost sm" data-pv="info">${ICON.file}<span>信息</span></button>
      <button class="btn ghost sm" data-pv="x">✕</button>
    </span></h3>
    <div class="preview-body" id="pb"><div class="state-msg">加载中…</div></div>`;
  const bd = openModal(m);
  m.querySelector('[data-pv="x"]').onclick = () => closeModal(bd);
  m.querySelector('[data-pv="info"]').onclick = () => showFileInfo(entry);
  const pb = m.querySelector('#pb');
  try {
    await probeAccess(entry.path);
    const url = rawUrl(entry.path, false, entry.name);
    const type = mediaType(entry.name);
    await renderPreview(type, entry, url, pb);
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

async function renderPreview(type, entry, url, pb) {
  if (type === 'image') return previewImage(url, pb, entry);
  if (type === 'video' || type === 'audio') return renderMedia(type, entry, url, pb);
  if (type === 'pdf') {
    pb.innerHTML = previewBar() + `<iframe src="${esc(url)}" style="width:100%;height:76vh;border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>`;
    return bindPreviewBar(pb, url);
  }
  if (type === 'markdown') return renderMarkdown(url, pb);
  if (type === 'json') return renderJson(url, pb);
  if (type === 'csv') return renderCsv(url, pb);
  if (type === 'yaml') return renderYaml(url, pb);
  if (type === 'xml') return renderXml(url, pb);
  if (type === 'code') return renderCode(entry, url, pb);
  if (type === 'text') return renderText(url, pb);
  if (type === 'zip') return renderZip(url, pb, entry.size);
  if (type === 'office') return renderOffice(url, pb);
  if (type === 'font') return renderFont(url, pb);
  pb.innerHTML = `<div class="notice">该类型暂不支持内联预览，请下载查看。</div>` + previewBar();
  bindPreviewBar(pb, url);
}

function renderMedia(type, entry, url, pb) {
  pb.innerHTML = `<div id="media"></div><div class="preview-bar">
    <button class="btn" data-act="opennew">${ICON.external}<span>新窗口</span></button>
    <button class="btn primary" data-act="dl">${ICON.download}<span>下载</span></button></div>`;
  const media = pb.querySelector('#media');
  const el = document.createElement(type);
  el.controls = true;
  const src = document.createElement('source');
  src.src = url;
  el.appendChild(src);
  media.appendChild(el);
  loadPlyr().then((Plyr) => {
    try {
      new Plyr(el, {
        controls: type === 'video'
          ? ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'fullscreen']
          : ['play', 'progress', 'current-time', 'duration', 'mute', 'volume'],
      });
    } catch (_) { /* 原生 controls 兜底，自带进度条 */ }
  }).catch(() => {});
  pb.querySelector('[data-act="opennew"]').onclick = () => window.open(url, '_blank');
  pb.querySelector('[data-act="dl"]').onclick = () => window.open(url, '_blank');
}

// ---- 图片增强：缩放/旋转/纯图全屏/复制/二维码/EXIF ----
async function previewImage(url, pb, entry) {
  let zoom = 1, rot = 0;
  const controls = `<div class="preview-controls">
    <button class="btn sm" data-img="zin">放大</button>
    <button class="btn sm" data-img="zout">缩小</button>
    <button class="btn sm" data-img="rot">旋转</button>
    <button class="btn sm" data-img="rst">重置</button>
    <span class="ctrl-sep"></span>
    <button class="btn sm" data-img="fs">全屏</button>
    <button class="btn sm" data-img="qr">二维码</button>
    <button class="btn sm" data-act="copy">复制链接</button>
    <button class="btn sm primary" data-act="dl">下载</button>
  </div>`;
  let exifPanel = '';
  if (state.admin) {
    try {
      await loadScript('/vendor/exifreader.min.js');
      const resp = await fetch(url);
      const buffer = await resp.arrayBuffer();
      const tags = (window.ExifReader.load || window.ExifReader.read)(buffer);
      const rows = [];
      if (tags.Make) rows.push(`相机: ${tags.Make.description}`);
      if (tags.Model) rows.push(`型号: ${tags.Model.description}`);
      if (tags.DateTime) rows.push(`时间: ${tags.DateTime.description}`);
      if (tags.FocalLength) rows.push(`焦距: ${tags.FocalLength.description}`);
      if (tags.ApertureValue) rows.push(`光圈: ${tags.ApertureValue.description}`);
      if (tags.ISOSpeedRatings) rows.push(`ISO: ${tags.ISOSpeedRatings.description}`);
      if (tags.ExposureTime) rows.push(`快门: ${tags.ExposureTime.description}`);
      if (tags.GPSLatitude && tags.GPSLongitude) {
        rows.push(`GPS: ${tags.GPSLatitude.description}, ${tags.GPSLongitude.description}`);
      }
      if (rows.length) exifPanel = `<div class="exif-panel"><strong>EXIF 信息</strong><br>${rows.join('<br>')}</div>`;
    } catch (_) { /* EXIF 可选，失败静默 */ }
  }
  pb.innerHTML = controls +
    `<div class="image-container"><img id="previewImg" src="${esc(url)}" alt="${esc(entry.name)}"/></div>` +
    exifPanel;
  const img = pb.querySelector('#previewImg');
  const apply = () => { img.style.transform = `scale(${zoom}) rotate(${rot}deg)`; };
  pb.querySelector('[data-img="zin"]').onclick = () => { zoom = Math.min(5, zoom + 0.15); apply(); };
  pb.querySelector('[data-img="zout"]').onclick = () => { zoom = Math.max(0.1, zoom - 0.15); apply(); };
  pb.querySelector('[data-img="rot"]').onclick = () => { rot = (rot + 90) % 360; apply(); };
  pb.querySelector('[data-img="rst"]').onclick = () => { zoom = 1; rot = 0; apply(); };
  pb.querySelector('[data-img="fs"]').onclick = () => {
    const bd = pb.closest('.modal-backdrop');
    if (!document.fullscreenElement) {
      bd.classList.add('fs-image');
      const t = bd.querySelector('.pv-title'); if (t) t.style.display = 'none';
      bd.querySelectorAll('.preview-controls').forEach((x) => { x.style.display = 'none'; });
      if (bd.requestFullscreen) bd.requestFullscreen().catch(() => {});
    } else if (document.exitFullscreen) document.exitFullscreen();
  };
  pb.querySelector('[data-img="qr"]').onclick = () => showQRCode(url);
  bindPreviewBar(pb, url);
}

// 退出全屏时恢复图片预览的标题与工具条
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    modalRoot.querySelectorAll('.modal-backdrop.fs-image').forEach((bd) => {
      bd.classList.remove('fs-image');
      const t = bd.querySelector('.pv-title'); if (t) t.style.display = '';
      bd.querySelectorAll('.preview-controls').forEach((x) => { x.style.display = ''; });
    });
  }
});

async function showQRCode(url) {
  try {
    await loadScript('/vendor/qrcode-generator.min.js');
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<h3>扫描二维码</h3>
      <div class="qr-box"><img src="${qr.createDataURL(4, 8)}" alt="二维码"/></div>
      <div class="row-actions"><button class="btn primary" id="ok">关闭</button></div>`;
    const bd = openModal(m);
    m.querySelector('#ok').onclick = () => closeModal(bd);
  } catch (e) { alertModal('二维码失败', e.message, 'danger'); }
}

// 点击反馈：按钮短暂变色（ok=绿/蓝，bad=红），约 1s 后复原。用于复制/下载，替代弹窗。
function flash(el, ok = true) {
  if (!el) return;
  el.classList.remove('flash-ok', 'flash-bad');
  void el.offsetWidth; // 触发重排以重启动画
  el.classList.add(ok ? 'flash-ok' : 'flash-bad');
  setTimeout(() => el.classList.remove('flash-ok', 'flash-bad'), 1000);
}

// 复制到剪贴板：不再弹窗，返回是否成功（由调用方决定按钮变色）。
async function copyShareLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    try {
      const i = document.createElement('input');
      i.value = url; document.body.appendChild(i); i.select();
      document.execCommand('copy'); i.remove();
      return true;
    } catch { return false; }
  }
}

function showFileInfo(entry) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<h3>文件信息</h3>
    <dl class="fileinfo-grid">
      <dt>名称</dt><dd>${esc(entry.name)}</dd>
      <dt>路径</dt><dd>${esc(entry.path)}</dd>
      <dt>大小</dt><dd>${entry.size != null ? esc(fmtSize(entry.size)) : '—'}</dd>
      <dt>类型</dt><dd>${esc(entry.mime || '—')}</dd>
      <dt>修改时间</dt><dd>${esc(fmtDate(entry.modified))}</dd>
    </dl>
    <div class="row-actions"><button class="btn primary" id="ok">知道了</button></div>`;
  const bd = openModal(m);
  m.querySelector('#ok').onclick = () => closeModal(bd);
}

// ---- Markdown ----
async function renderMarkdown(url, pb) {
  await loadScript('/vendor/marked.min.js');
  await loadScript('/vendor/dompurify.min.js');
  const text = await (await fetch(url)).text();
  const html = window.DOMPurify.sanitize(window.marked.parse(text));
  pb.innerHTML = `<div class="preview-controls"><button class="btn" data-act="mdraw">原始文本</button></div>
    <div class="markdown-body">${html}</div>
    <pre class="raw-pre" style="display:none">${esc(text)}</pre>` + previewBar();
  const md = pb.querySelector('.markdown-body');
  const raw = pb.querySelector('pre.raw-pre');
  pb.querySelector('[data-act="mdraw"]').onclick = () => {
    const showRaw = raw.style.display !== 'none';
    raw.style.display = showRaw ? 'none' : 'block';
    md.style.display = showRaw ? 'block' : 'none';
    pb.querySelector('[data-act="mdraw"]').textContent = showRaw ? '原始文本' : '渲染视图';
  };
  bindPreviewBar(pb, url);
}

// ---- JSON ----
async function renderJson(url, pb) {
  const text = await (await fetch(url)).text();
  let formatted;
  try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { formatted = text; }
  pb.innerHTML = `<div class="preview-controls"><button class="btn" data-act="wrap">折叠/展开</button></div>
    <div class="json-viewer"><pre>${esc(formatted)}</pre></div>` + previewBar();
  const pre = pb.querySelector('pre');
  pb.querySelector('[data-act="wrap"]').onclick = () => {
    const collapsed = pre.dataset.collapsed === '1';
    if (!collapsed) {
      try { pre.textContent = JSON.stringify(JSON.parse(text)); pre.dataset.collapsed = '1'; pb.querySelector('[data-act="wrap"]').textContent = '展开'; }
      catch {}
    } else {
      pre.textContent = formatted; pre.dataset.collapsed = '0'; pb.querySelector('[data-act="wrap"]').textContent = '折叠/展开';
    }
  };
  bindPreviewBar(pb, url);
}

// ---- CSV/TSV ----
async function renderCsv(url, pb) {
  await loadScript('/vendor/papaparse.min.js');
  const text = await (await fetch(url)).text();
  const res = window.Papa.parse(text, { skipEmptyLines: true });
  const rows = (res.data || []).filter((r) => Array.isArray(r));
  let html = '<div class="csv-wrap"><table class="csv-table">';
  rows.slice(0, 3000).forEach((r, i) => {
    html += `<tr>${r.map((cell) => i === 0 ? `<th>${esc(cell)}</th>` : `<td>${esc(cell)}</td>`).join('')}</tr>`;
  });
  html += '</table></div>';
  if (rows.length > 3000) html += `<div class="notice" style="margin-top:10px">仅显示前 3000 行（共 ${rows.length} 行）</div>`;
  pb.innerHTML = html + previewBar();
  bindPreviewBar(pb, url);
}

// ---- YAML ----
async function renderYaml(url, pb) {
  await loadScript('/vendor/js-yaml.min.js');
  const text = await (await fetch(url)).text();
  let out = text;
  try { out = JSON.stringify(window.jsyaml.load(text), null, 2); } catch {}
  pb.innerHTML = `<div class="json-viewer"><pre>${esc(out)}</pre></div>` + previewBar();
  bindPreviewBar(pb, url);
}

// ---- XML ----
async function renderXml(url, pb) {
  const text = await (await fetch(url)).text();
  const pretty = formatXml(text) || text;
  pb.innerHTML = `<pre class="raw-pre">${esc(pretty)}</pre>` + previewBar();
  bindPreviewBar(pb, url);
}

// ---- 纯文本 ----
async function renderText(url, pb) {
  const text = await (await fetch(url)).text();
  pb.innerHTML = `<pre class="raw-pre">${esc(text)}</pre>` + previewBar();
  bindPreviewBar(pb, url);
}

// ---- 代码高亮（Prism，按需语言包 + 依赖顺序）----
const LANG_MAP = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', java: 'java', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  css: 'css', scss: 'css', html: 'markup', htm: 'markup',
  sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql', go: 'go', rs: 'rust',
  rb: 'python', php: 'php', md: 'markdown', yaml: 'yaml', yml: 'yaml', json: 'json',
};
const LANG_DEPS = {
  clike: [], javascript: ['clike'], typescript: ['javascript'],
  jsx: ['markup', 'javascript'], tsx: ['jsx', 'typescript'],
  c: ['clike'], cpp: ['c'], java: ['clike'], php: ['markup', 'clike'],
  markdown: ['markup'], css: [], json: [], yaml: [], bash: [], sql: [],
  go: [], rust: [], python: [], markup: [],
};
async function ensurePrismLang(lang) {
  if (lang === 'plaintext' || window.Prism.languages[lang]) return;
  for (const d of (LANG_DEPS[lang] || [])) await ensurePrismLang(d);
  await loadScript(`/vendor/prism-${lang}.min.js`);
}
async function renderCode(entry, url, pb) {
  await loadScript('/vendor/prism.min.js');
  loadCssOnce('/vendor/prism-tomorrow.min.css');
  const text = await (await fetch(url)).text();
  const lang = LANG_MAP[ext(entry.name)] || 'plaintext';
  await ensurePrismLang(lang);
  let highlighted;
  try {
    highlighted = lang === 'plaintext'
      ? esc(text)
      : window.Prism.highlight(text, window.Prism.languages[lang], lang);
  } catch { highlighted = esc(text); }
  pb.innerHTML = `<pre class="code-viewer"><code class="language-${lang}">${highlighted}</code></pre>` + previewBar();
  bindPreviewBar(pb, url);
}

// ---- ZIP（Range 中央目录扫描：不下载包体、不全量解压）----
const ZIP_MAX_BUFFER = 50 * 1024 * 1024; // 无 Range 时仅 ≤50MB 允许整包下载解析中央目录
async function fetchWithRange(url, rangeHeader) {
  const r = await fetch(url, { headers: { Range: rangeHeader } });
  if (r.status !== 206) throw new Error('no-range');
  return new Uint8Array(await r.arrayBuffer());
}
function parseZipEntries(cd) {
  const entries = [];
  let pos = 0;
  const dv = new DataView(cd.buffer, cd.byteOffset);
  while (pos + 46 <= cd.length && dv.getUint32(pos, true) === 0x02014b50) {
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    let compSize = dv.getUint32(pos + 20, true);
    let localOffset = dv.getUint32(pos + 42, true);
    // zip64 条目级：0xFFFFFFFF 字段 → extra field(0x0001) 中按序取实际 64 位值
    if (compSize === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) {
      const extra = cd.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen);
      const zdv = new DataView(extra.buffer, extra.byteOffset);
      let ei = (extra.length >= 4 && zdv.getUint16(0, true) === 0x0001) ? 4 : 0;
      if (dv.getUint32(pos + 24, true) === 0xFFFFFFFF && ei + 8 <= extra.length) ei += 8; // uncompSize
      if (compSize === 0xFFFFFFFF && ei + 8 <= extra.length) { compSize = Number(zdv.getBigUint64(ei, true)); ei += 8; }
      if (localOffset === 0xFFFFFFFF && ei + 8 <= extra.length) { localOffset = Number(zdv.getBigUint64(ei, true)); ei += 8; }
    }
    entries.push({
      name: new TextDecoder().decode(cd.subarray(pos + 46, pos + 46 + nameLen)),
      method: dv.getUint16(pos + 10, true),
      compSize,
      localOffset,
    });
    pos += 46 + nameLen + extraLen + dv.getUint16(pos + 32, true);
  }
  return entries;
}
function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  return -1;
}
// 解析 EOCD 得到中央目录范围，支持 zip64（cdSize/cdOffset 为 0xFFFFFFFF 时经 locator 找 zip64 EOCD）
function eocdCdRange(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('bad-zip');
  const dv = new DataView(buf.buffer, buf.byteOffset);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z64off = Number(dv.getBigUint64(loc + 8, true));
      if (z64off + 56 <= buf.length && dv.getUint32(z64off, true) === 0x06064b50) {
        cdSize = Number(dv.getBigUint64(z64off + 40, true));
        cdOffset = Number(dv.getBigUint64(z64off + 48, true));
      }
    }
  }
  return { cdOffset, cdSize };
}
function parseZipBuffer(buf) {
  const { cdOffset, cdSize } = eocdCdRange(buf);
  return parseZipEntries(buf.subarray(cdOffset, cdOffset + cdSize));
}
async function listZipByRange(url) {
  const tail = await fetchWithRange(url, 'bytes=-65536');
  const eocd = findEocd(tail);
  if (eocd < 0) throw new Error('bad-zip');
  const dv = new DataView(tail.buffer, tail.byteOffset);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  if (cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z64off = Number(dv.getBigUint64(loc + 8, true));
      try {
        const z64 = await fetchWithRange(url, `bytes=${z64off}-${z64off + 55}`);
        if (z64.length >= 56 && new DataView(z64.buffer, z64.byteOffset).getUint32(0, true) === 0x06064b50) {
          const zdv = new DataView(z64.buffer, z64.byteOffset);
          cdSize = Number(zdv.getBigUint64(40, true));
          cdOffset = Number(zdv.getBigUint64(48, true));
        }
      } catch { /* 保留原值尝试 */ }
    }
  }
  const cd = await fetchWithRange(url, `bytes=${cdOffset}-${cdOffset + cdSize - 1}`);
  return parseZipEntries(cd);
}
async function fetchZipEntryByRange(url, entry) {
  const buf = await fetchWithRange(url, `bytes=${entry.localOffset}-${entry.localOffset + entry.compSize + 1024}`);
  const dv = new DataView(buf.buffer, buf.byteOffset);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('bad-local');
  const start = 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  const comp = buf.subarray(start, start + entry.compSize);
  return entry.method === 0 ? comp : window.fflate.inflateSync(comp);
}
function extractFromBuffer(buf, entry) {
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const start = entry.localOffset + 30 + dv.getUint16(entry.localOffset + 26, true) + dv.getUint16(entry.localOffset + 28, true);
  const comp = buf.subarray(start, start + entry.compSize);
  return entry.method === 0 ? comp : window.fflate.inflateSync(comp);
}
async function openZipPreview(url, size) {
  // 1) 主路径：Range 中央目录（秒开、不下载包体）
  let supportsRange = false;
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    supportsRange = r.status === 206;
  } catch { supportsRange = false; }
  if (supportsRange) {
    await loadScript('/vendor/fflate.umd.js'); // deflate 条目 inflate 必需（此前漏加载导致单文件预览失败）
    const entries = await listZipByRange(url);
    return { entries, getData: (e) => fetchZipEntryByRange(url, e) };
  }
  // 2) 降级：仅 ≤50MB 允许整包下载解析中央目录（不 inflate 内容）
  if (size != null && size <= ZIP_MAX_BUFFER) {
    await loadScript('/vendor/fflate.umd.js');
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const entries = parseZipBuffer(buf);
    return { entries, getData: (e) => Promise.resolve(extractFromBuffer(buf, e)) };
  }
  return null; // 大文件且无 Range：放弃内容预览
}
function downloadBlob(name, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data]));
  a.download = basename(name);
  a.click();
}
function showZipEntry(name, data) {
  const e = name.split('.').pop().toLowerCase();
  const objUrl = URL.createObjectURL(new Blob([data]));
  const m = document.createElement('div');
  m.className = 'modal preview-modal';
  m.innerHTML = `<h3 class="pv-title"><span class="pv-name">${esc(basename(name))}</span>
    <span class="pv-tools"><button class="btn ghost sm" data-zx="dl">${ICON.download}<span>下载</span></button>
    <button class="btn ghost sm" data-zx="x">✕</button></span></h3>
    <div class="preview-body" id="pb">加载中…</div>`;
  const bd = openModal(m);
  const pb = m.querySelector('#pb');
  m.querySelector('[data-zx="x"]').onclick = () => closeModal(bd);
  m.querySelector('[data-zx="dl"]').onclick = () => downloadBlob(name, data);
  if (['txt', 'md', 'json', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'css', 'html',
    'xml', 'yaml', 'yml', 'ini', 'cfg', 'sh', 'sql', 'go', 'rs', 'rb', 'php', 'log', 'csv', 'toml'].includes(e)) {
    pb.innerHTML = `<pre class="raw-pre">${esc(new TextDecoder().decode(data))}</pre>`;
  } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(e)) {
    pb.innerHTML = `<img src="${esc(objUrl)}" style="max-width:100%;max-height:72vh;border-radius:8px;display:block"/>`;
  } else {
    pb.innerHTML = `<div class="notice">该类型暂不支持内联预览，可下载查看。</div>`;
  }
}
async function renderZip(url, pb, size) {
  let zip = null;
  try { zip = await openZipPreview(url, size); } catch { zip = null; }
  if (!zip) {
    pb.innerHTML = `<div class="notice">该存储不支持分段读取，无法预览压缩包内容（大文件不做全量解压，避免内存爆）。</div>
      <div class="preview-bar"><button class="btn primary" data-act="dl">${ICON.download}<span>下载整个压缩包</span></button></div>`;
    pb.querySelector('[data-act="dl"]').onclick = () => window.open(url, '_blank');
    return;
  }
  const entries = zip.entries;
  const tree = zipTree(entries);
  let html = `<div class="zip-file-list"><strong>压缩包内容（${entries.length} 项）</strong><ul>`;
  if (!entries.length) html += '<li class="zip-empty">（空压缩包）</li>';
  else html += zipTreeHtml(tree);
  html += '</ul></div>';
  pb.innerHTML = html + previewBar();
  // 目录行折叠
  pb.querySelectorAll('li.zdir').forEach((li) => {
    li.onclick = (ev) => {
      if (ev.target.closest('button')) return;
      const sub = li.nextElementSibling;
      const twist = li.querySelector('.ztwist');
      if (!sub) return;
      const open = sub.style.display !== 'none';
      sub.style.display = open ? 'none' : 'block';
      if (twist) twist.textContent = open ? '▸' : '▾';
    };
  });
  const entryMap = new Map(entries.map((en) => [en.name, en]));
  pb.querySelectorAll('[data-zip]').forEach((btn) => {
    btn.onclick = async () => {
      const name = btn.dataset.path;
      const en = entryMap.get(name);
      if (!en) { alertModal('错误', '文件不存在', 'danger'); return; }
      try {
        const data = await zip.getData(en);
        if (btn.dataset.zip === 'pv') showZipEntry(name, data);
        else downloadBlob(name, data);
      } catch (e) { alertModal('失败', e.message, 'danger'); }
    };
  });
  // ZIP 内图片条目：懒加载内联缩略图（仅可见区域，避免大包一次性拉满）
  const thumbImgs = pb.querySelectorAll('img[data-zipthumb]');
  if (thumbImgs.length) {
    const loadThumb = async (img) => {
      const en = entryMap.get(img.dataset.zipthumb);
      if (!en) return;
      try {
        const data = await zip.getData(en);
        img.src = URL.createObjectURL(new Blob([data]));
      } catch { img.remove(); }
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => {
        es.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); loadThumb(en.target); } });
      }, { rootMargin: '200px' });
      thumbImgs.forEach((img) => io.observe(img));
    } else {
      thumbImgs.forEach((img) => loadThumb(img));
    }
  }
  bindPreviewBar(pb, url);
}

// 压缩包条目按路径构建树（目录可折叠，避免大量文件平铺）
function zipTree(entries) {
  const root = { dirs: new Map(), files: [] };
  for (const en of entries) {
    const parts = en.name.split('/').filter(Boolean);
    if (!parts.length) continue;
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast && !en.name.endsWith('/')) {
        node.files.push({ ...en, base: seg });
      } else {
        if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
        node = node.dirs.get(seg);
      }
    }
  }
  return root;
}
function zipTreeHtml(node) {
  let html = '';
  for (const [name, dir] of node.dirs) {
    html += `<li class="zdir"><span class="ztwist">▸</span><span class="zname">${esc(name)}/</span></li>
      <ul class="zsub">${zipTreeHtml(dir)}</ul>`;
  }
  for (const f of node.files) {
    const isImg = isImageName(f.base);
    const thumb = isImg ? `<img class="zip-thumb" data-zipthumb="${enc(f.name)}" alt="" loading="lazy"/>` : '';
    html += `<li data-path="${esc(f.name)}">${thumb}<span class="zname">${esc(f.base)}</span>
      <span class="zsize">${fmtSize(f.compSize)}</span>
      <button class="btn sm" data-zip="pv" data-path="${esc(f.name)}">预览</button>
      <button class="btn sm" data-zip="dl" data-path="${esc(f.name)}">下载</button></li>`;
  }
  return html;
}

// ---- Office（微软在线预览）----
function renderOffice(url, pb) {
  const officeUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`;
  pb.innerHTML = previewBar() +
    `<div class="notice">Office 在线预览由微软服务提供，需文件直链公网可访问；无法加载时请直接下载。</div>
    <iframe src="${esc(officeUrl)}" style="width:100%;height:72vh;border:1px solid var(--border);border-radius:8px;background:#fff;margin-top:10px"></iframe>`;
  bindPreviewBar(pb, url);
}

// ---- 字体 ----
function renderFont(url, pb) {
  pb.innerHTML = `<div style="text-align:center;padding:40px 10px">
      <div style="font-size:46px;font-family:PreviewFont;word-break:break-all">AaBbCcDdEeFfGg 0123456789 字体预览</div>
      <style>@font-face { font-family: "PreviewFont"; src: url("${url}"); }</style>
      <div class="preview-meta" style="justify-content:center;margin-top:18px">字体预览（示例文本）</div>
    </div>` + previewBar();
  bindPreviewBar(pb, url);
}

// ---------------- 启动 ----------------
async function init() {
  const t = localStorage.getItem('elist.theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
  // 会话里有管理员密码则恢复登录态（后端现支持 X-Admin-Password 无状态鉴权）
  if (state.adminPw) state.admin = true;
  try {
    const cfg = await apiGet('/api/config');
    if (cfg && cfg.title) state.title = cfg.title;
  } catch (_) {}
  await loadSidebar();
  render();
  // 分享链接 /?path=<enc>（文件夹复制链接、目录直链）进入对应目录，而非永远回根目录
  let start = '/';
  try {
    const p = new URLSearchParams(location.search).get('path');
    if (p) start = decodeURIComponent(p);
  } catch (_) {}
  browse(start);
}
init();
