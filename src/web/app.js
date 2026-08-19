// 极简前端 SPA：浏览 + 弹窗密码(X-Folder-Password 头) + 搜索 + 排序 + 预览。
// 密码不进 URL：经请求头传递，地址栏始终干净。下载/预览走 /api/link 拿直链 JSON。
const state = { 
  path: '/', 
  pwSet: new Set(), 
  sort: 'name_asc',
  view: localStorage.getItem('view') || 'list', // 视图模式：list 或 grid
  sidebarOpen: false
};
const PW_HEADER = 'X-Folder-Password';

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 客户端已知密码集合：进入受保护层级时弹窗收集，存入 Set。
// 每个请求把集合内所有密码以重复 X-Folder-Password 头带上，后端逐层校验
// （父目录 + 子目录各有 .passwd 时，需两层密码都满足 = 子层重新鉴权）。
function pwHeaders() {
  const h = new Headers();
  for (const pw of state.pwSet) h.append(PW_HEADER, pw);
  return h;
}

async function apiList(path, fresh = false) {
  const params = new URLSearchParams({ path });
  if (state.sort) params.set('sort', state.sort);
  if (fresh) params.set('fresh', '1');
  const r = await fetch('/api/list?' + params.toString(), { headers: pwHeaders() });
  if (r.status === 403) {
    const body = await r.json().catch(() => ({}));
    return { needPassword: true, lockedAt: body.lockedAt, received: body.received };
  }
  if (!r.ok) throw new Error('list failed ' + r.status);
  return { entries: await r.json() };
}

/** 取文件直链（经 /api/link，密码走头），返回 { url, cacheControl }。 */
async function getLink(path) {
  const r = await fetch('/api/link?path=' + encodeURIComponent(path), { headers: pwHeaders() });
  if (r.status === 403) {
    const body = await r.json().catch(() => ({}));
    throw { needPassword: true, lockedAt: body.lockedAt };
  }
  if (!r.ok) throw new Error('link failed ' + r.status);
  return r.json();
}

/** 弹窗输入密码，返回输入的密码或 null（取消）。hint 为可选诊断提示（显示在输入框下方）。 */
function askPassword(hintPath, hint) {
  return new Promise((resolve) => {
    const modal = document.getElementById('pwModal');
    const input = document.getElementById('pwInput');
    const ok = document.getElementById('pwOk');
    const cancel = document.getElementById('pwCancel');
    const title = document.getElementById('pwTitle');
    const hintEl = document.getElementById('pwHint');
    if (title) title.textContent = hintPath && hintPath !== '/' ? `请输入 ${hintPath} 的密码` : '请输入密码';
    if (hintEl) hintEl.textContent = hint || '';
    input.value = '';
    modal.classList.add('show');
    input.focus();
    const done = (val) => {
      modal.classList.remove('show');
      ok.onclick = null;
      cancel.onclick = null;
      input.onkeydown = null;
      resolve(val);
    };
    ok.onclick = () => done(input.value);
    cancel.onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value);
      else if (e.key === 'Escape') done(null);
    };
  });
}

async function openPath(path, fresh = false, pushUrl = true) {
  state.path = path;
  // 更新 URL（不刷新页面）
  if (pushUrl) {
    const url = path === '/' ? '/' : path;
    history.pushState({ path }, '', url);
  }
  renderCrumbs();
  renderTree();
  const listEl = document.getElementById('list');
  listEl.innerHTML = '<div class="empty">加载中…</div>';
  let res;
  try {
    res = await apiList(path, fresh);
  } catch (e) {
    listEl.innerHTML = `<div class="empty">错误：${esc(e.message)}</div>`;
    return;
  }
  if (res.needPassword) {
    const hint = res.received
      ? `服务端已收到 ${res.received} 个密码，仍未解锁 ${res.lockedAt || path}；检查该层 .passwd 内容或输入的密码。`
      : '';
    const pw = await askPassword(res.lockedAt || path, hint);
    if (pw === null) {
      listEl.innerHTML = '<div class="empty">已取消</div>';
      return;
    }
    state.pwSet.add(pw);
    return openPath(path);
  }
  // 服务端已排序（文件夹优先），前端不再重排
  const entries = res.entries;
  if (!entries.length) {
    listEl.innerHTML = '<div class="empty">空目录</div>';
    return;
  }
  
  // 根据视图模式渲染
  if (state.view === 'grid') {
    renderGridView(entries, listEl);
  } else {
    renderListView(entries, listEl);
  }
}

function renderListView(entries, listEl) {
  listEl.className = 'list-view';
  listEl.innerHTML = entries
    .map(
      (e) => `<div class="row" data-path="${esc(e.path)}" data-dir="${e.isDir}">
        <div class="ico">${e.isDir ? '📁' : '📄'}</div>
        <div class="name">${esc(e.name)}</div>
        <div class="size">${e.isDir ? '' : fmtSize(e.size)}</div>
      </div>`
    )
    .join('');
  listEl.querySelectorAll('.row').forEach((row) => {
    row.onclick = () => {
      const p = row.dataset.path;
      if (row.dataset.dir === 'true') openPath(p);
      else preview(p, row.querySelector('.name').textContent);
    };
  });
}

function renderGridView(entries, listEl) {
  listEl.className = 'grid-view';
  listEl.innerHTML = entries
    .map((e) => {
      const isImage = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(e.name);
      const thumb = isImage 
        ? `<img src="/api/link?path=${encodeURIComponent(e.path)}" loading="lazy" />`
        : `<div class="icon">${e.isDir ? '📁' : '📄'}</div>`;
      return `<div class="grid-item" data-path="${esc(e.path)}" data-dir="${e.isDir}">
        <div class="thumb">${thumb}</div>
        <div class="name">${esc(e.name)}</div>
      </div>`;
    })
    .join('');
  listEl.querySelectorAll('.grid-item').forEach((item) => {
    item.onclick = () => {
      const p = item.dataset.path;
      if (item.dataset.dir === 'true') openPath(p);
      else preview(p, item.querySelector('.name').textContent);
    };
  });
}

function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(1) + ' ' + u[i];
}

async function preview(path, name) {
  const lower = name.toLowerCase();
  let url;
  try {
    const link = await getLink(path);
    url = link.url;
  } catch (e) {
    if (e && e.needPassword) {
      const pw = await askPassword(e.lockedAt || state.path);
      if (pw === null) return;
      state.pwSet.add(pw);
      return preview(path, name);
    }
    alert('预览失败：' + (e.message || e));
    return;
  }
  let inner = '';
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(lower)) {
    inner = `<img src="${url}" />`;
  } else if (/\.(mp4|webm|mov|mkv|m4v)$/.test(lower)) {
    inner = `<video src="${url}" controls autoplay></video>`;
  } else if (/\.(mp3|wav|ogg|m4a)$/.test(lower)) {
    inner = `<audio src="${url}" controls autoplay></audio>`;
  } else if (/\.pdf$/.test(lower)) {
    inner = `<iframe src="${url}"></iframe>`;
  } else if (/\.(docx?|xlsx?|pptx?|doc|xls|ppt)$/.test(lower)) {
    // Office 文件：使用微软 Office Online Viewer
    const officeUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`;
    inner = `<iframe src="${officeUrl}"></iframe>`;
  } else if (/\.(txt|md|json|js|ts|py|java|c|cpp|h|hpp|css|html|xml|yaml|yml|ini|cfg|sh|bash|zsh|sql|go|rs|rb|php|pl|swift|kt|scala|r|lua|vim|dockerfile|makefile)$/.test(lower)) {
    // 代码/文本文件：直接读取内容
    try {
      const resp = await fetch(url);
      const text = await resp.text();
      const escaped = esc(text);
      inner = `<pre class="code-preview"><code>${escaped}</code></pre>`;
    } catch (e) {
      alert('读取文件失败：' + e.message);
      return;
    }
  } else {
    // 其他类型：直接用直链触发下载（浏览器跟随 302 直链，无密码暴露）
    window.location.href = url;
    return;
  }
  document.getElementById('modalBody').innerHTML = inner;
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
  document.getElementById('modalBody').innerHTML = '';
}

function renderCrumbs() {
  const parts = state.path.split('/').filter(Boolean);
  let acc = '';
  const segs = ['<span onclick="openPath(\'/\')">根</span>'];
  for (const p of parts) {
    acc += '/' + p;
    const pp = acc;
    segs.push(`<span onclick="openPath('${esc(pp)}')">${esc(p)}</span>`);
  }
  document.getElementById('crumbs').innerHTML = segs.join(' / ');
}

// 左侧导航树（支持展开/折叠子目录）
const treeCache = new Map(); // 缓存已加载的目录内容

async function renderTree() {
  const treeEl = document.getElementById('tree');
  if (!treeEl) return;
  
  // 构建路径层级
  const parts = state.path.split('/').filter(Boolean);
  let html = '';
  let acc = '';
  
  // 根目录
  html += `<div class="tree-item${parts.length === 0 ? ' active' : ''}" onclick="openPath('/')">📦 根</div>`;
  
  // 逐层展开
  for (let i = 0; i < parts.length; i++) {
    const parentPath = acc || '/';
    acc += '/' + parts[i];
    const isActive = i === parts.length - 1;
    
    // 获取子目录列表
    let children = treeCache.get(parentPath);
    if (!children) {
      try {
        const res = await apiList(parentPath);
        if (res.entries) {
          children = res.entries.filter(e => e.isDir);
          treeCache.set(parentPath, children);
        }
      } catch (e) {
        children = [];
      }
    }
    
    // 渲染当前层级的子目录
    if (children && children.length > 0) {
      for (const child of children) {
        const isCurrentPath = child.path === acc;
        html += `<div class="tree-item${isCurrentPath ? ' active' : ''}" style="margin-left:${(i + 1) * 16}px" onclick="openPath('${esc(child.path)}')">📁 ${esc(child.name)}</div>`;
      }
    }
  }
  
  treeEl.innerHTML = html;
}

// 侧边栏切换
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  state.sidebarOpen = !state.sidebarOpen;
  document.getElementById('sidebar').classList.toggle('open', state.sidebarOpen);
  document.body.classList.toggle('sidebar-open', state.sidebarOpen);
});

// 视图切换
document.querySelectorAll('.view-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.view = btn.dataset.view;
    localStorage.setItem('view', state.view);
    document.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    // 重新渲染当前目录
    openPath(state.path, false, false);
  });
});

// 初始化视图按钮状态
document.querySelectorAll('.view-btn').forEach((btn) => {
  btn.classList.toggle('active', btn.dataset.view === state.view);
});

// 排序切换
document.getElementById('sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  openPath(state.path, false, false);
});

// 刷新按钮：强制回源当前目录（绕过缓存，立即反映 .passwd / 文件的改动）
document.getElementById('refresh').addEventListener('click', () => openPath(state.path, true, false));

// 浏览器前进/后退支持
window.addEventListener('popstate', (e) => {
  const path = e.state?.path || location.pathname || '/';
  openPath(path, false, false);
});

// 搜索（现搜 + 后端内存索引）；密码走头
document.getElementById('search').addEventListener('input', async (e) => {
  const q = e.target.value.trim();
  const listEl = document.getElementById('list');
  if (!q) return openPath(state.path);
  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(state.path)}`, {
    headers: pwHeaders(),
  });
  if (r.status === 403) {
    const body = await r.json().catch(() => ({}));
    const pw = await askPassword(body.lockedAt || state.path);
    if (pw === null) return;
    state.pwSet.add(pw);
    return document.getElementById('search').dispatchEvent(new Event('input'));
  }
  const entries = await r.json();
  listEl.innerHTML = entries.length
    ? entries
        .map(
          (e) => `<div class="row" data-path="${esc(e.path)}">
            <div class="ico">${e.isDir ? '📁' : '📄'}</div>
            <div class="name">${esc(e.name)}</div>
            <div class="size">${e.isDir ? '' : fmtSize(e.size)}</div>
          </div>`
        )
        .join('')
    : '<div class="empty">无匹配</div>';
  listEl.querySelectorAll('.row').forEach((row) => {
    row.onclick = () => preview(row.dataset.path, row.querySelector('.name').textContent);
  });
});

// 拉取公用配置（站点标题、默认排序）
fetch('/api/config')
  .then((r) => r.json())
  .then((d) => {
    if (d && d.title) document.title = d.title;
    if (d && d.sort) {
      state.sort = d.sort;
      const sel = document.getElementById('sort');
      if (sel) sel.value = d.sort;
    }
  })
  .catch(() => {});

// 登录功能
const adminState = { loggedIn: false };

function updateLoginUI() {
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const saveConfigBtn = document.getElementById('saveConfigBtn');
  
  if (adminState.loggedIn) {
    loginBtn.style.display = 'none';
    logoutBtn.style.display = '';
    saveConfigBtn.style.display = '';
  } else {
    loginBtn.style.display = '';
    logoutBtn.style.display = 'none';
    saveConfigBtn.style.display = 'none';
  }
}

function askLogin() {
  return new Promise((resolve) => {
    const modal = document.getElementById('loginModal');
    const input = document.getElementById('loginPassword');
    const ok = document.getElementById('loginOk');
    const cancel = document.getElementById('loginCancel');
    input.value = '';
    modal.classList.add('show');
    input.focus();
    const done = (val) => {
      modal.classList.remove('show');
      ok.onclick = null;
      cancel.onclick = null;
      input.onkeydown = null;
      resolve(val);
    };
    ok.onclick = () => done(input.value);
    cancel.onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value);
      else if (e.key === 'Escape') done(null);
    };
  });
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const password = await askLogin();
  if (password === null) return;
  
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (r.ok) {
      adminState.loggedIn = true;
      updateLoginUI();
      openPath(state.path, true, false); // 刷新列表显示操作按钮
    } else {
      alert('登录失败：密码错误');
    }
  } catch (e) {
    alert('登录失败：' + e.message);
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await fetch('/api/admin/logout', { method: 'POST' });
  } catch (e) {}
  adminState.loggedIn = false;
  updateLoginUI();
  openPath(state.path, false, false);
});

// 编辑配置功能
let editingPath = '';

function askEdit(path, currentPassword = '', currentHint = '', currentHidden = false) {
  return new Promise((resolve) => {
    const modal = document.getElementById('editModal');
    const pathInput = document.getElementById('editPath');
    const pwInput = document.getElementById('editPassword');
    const hintInput = document.getElementById('editHint');
    const hiddenInput = document.getElementById('editHidden');
    const ok = document.getElementById('editOk');
    const cancel = document.getElementById('editCancel');
    
    pathInput.value = path;
    pwInput.value = currentPassword;
    hintInput.value = currentHint;
    hiddenInput.checked = currentHidden;
    editingPath = path;
    
    modal.classList.add('show');
    pwInput.focus();
    
    const done = (val) => {
      modal.classList.remove('show');
      ok.onclick = null;
      cancel.onclick = null;
      resolve(val);
    };
    
    ok.onclick = () => done({
      path: pathInput.value,
      password: pwInput.value,
      hint: hintInput.value,
      hidden: hiddenInput.checked
    });
    cancel.onclick = () => done(null);
  });
}

async function editEntry(path) {
  if (!adminState.loggedIn) return;
  
  // 获取当前配置
  try {
    const r = await fetch('/api/admin/config?path=' + encodeURIComponent(path));
    const config = await r.json();
    
    const result = await askEdit(
      path,
      config.password || '',
      config.hint || '',
      config.hidden || false
    );
    
    if (result === null) return;
    
    // 保存配置
    const saveR = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    });
    
    if (saveR.ok) {
      openPath(state.path, true, false); // 刷新列表
    } else {
      alert('保存失败');
    }
  } catch (e) {
    alert('编辑失败：' + e.message);
  }
}

// 保存配置到 xlsx
document.getElementById('saveConfigBtn').addEventListener('click', async () => {
  if (!confirm('确定要保存所有配置到 .elist.xlsx 吗？')) return;
  
  try {
    const r = await fetch('/api/admin/save', { method: 'POST' });
    if (r.ok) {
      alert('配置已保存');
    } else {
      alert('保存失败');
    }
  } catch (e) {
    alert('保存失败：' + e.message);
  }
});

// 修改列表渲染，添加操作按钮
const originalRenderListView = renderListView;
renderListView = function(entries, listEl) {
  listEl.className = 'list-view';
  listEl.innerHTML = entries
    .map(
      (e) => `<div class="row" data-path="${esc(e.path)}" data-dir="${e.isDir}">
        <div class="ico">${e.isDir ? '📁' : '📄'}</div>
        <div class="name">${esc(e.name)}</div>
        <div class="size">${e.isDir ? '' : fmtSize(e.size)}</div>
        ${adminState.loggedIn && e.isDir ? `<button class="btn" style="padding:2px 8px;font-size:12px" onclick="event.stopPropagation();editEntry('${esc(e.path)}')">⚙️</button>` : ''}
      </div>`
    )
    .join('');
  listEl.querySelectorAll('.row').forEach((row) => {
    row.onclick = () => {
      const p = row.dataset.path;
      if (row.dataset.dir === 'true') openPath(p);
      else preview(p, row.querySelector('.name').textContent);
    };
  });
};

// 初始化登录状态
updateLoginUI();

openPath('/');
