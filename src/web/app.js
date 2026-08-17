// 极简前端 SPA：浏览 + 密码(?pw 级联) + 搜索 + 排序 + 预览（全部经 302 直链，Worker 不搬字节）。
const state = { path: '/', passwords: {}, sort: 'name_asc' };

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 沿路径向上找最近已知密码，实现密码级联（进入子目录沿用父门禁密码）。 */
function pwFor(path) {
  const parts = path.split('/').filter(Boolean);
  let acc = '';
  for (const p of parts) {
    acc += '/' + p;
    if (state.passwords[acc]) return state.passwords[acc];
  }
  return '';
}

function downloadUrl(path) {
  const pw = pwFor(path);
  return `/api/download?path=${encodeURIComponent(path)}${pw ? '&pw=' + encodeURIComponent(pw) : ''}`;
}

function listUrl(path, sort) {
  const pw = pwFor(path);
  const params = new URLSearchParams({ path });
  if (sort) params.set('sort', sort);
  if (pw) params.set('pw', pw);
  return `/api/list?${params.toString()}`;
}

async function apiList(path) {
  const r = await fetch(listUrl(path, state.sort));
  if (r.status === 403) return { needPassword: true };
  if (!r.ok) throw new Error('list failed ' + r.status);
  return { entries: await r.json() };
}

async function openPath(path) {
  state.path = path;
  renderCrumbs();
  const listEl = document.getElementById('list');
  listEl.innerHTML = '<div class="empty">加载中…</div>';
  let res;
  try {
    res = await apiList(path);
  } catch (e) {
    listEl.innerHTML = `<div class="empty">错误：${esc(e.message)}</div>`;
    return;
  }
  if (res.needPassword) {
    const pw = prompt('该目录需要密码：');
    if (pw === null) return;
    state.passwords[path] = pw;
    return openPath(path);
  }
  // 服务端已排序（文件夹优先），前端不再重排
  const entries = res.entries;
  if (!entries.length) {
    listEl.innerHTML = '<div class="empty">空目录</div>';
    return;
  }
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

function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(1) + ' ' + u[i];
}

function preview(path, name) {
  const lower = name.toLowerCase();
  const url = downloadUrl(path);
  let inner = '';
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(lower)) {
    inner = `<img src="${url}" />`;
  } else if (/\.(mp4|webm|mov|mkv|m4v)$/.test(lower)) {
    inner = `<video src="${url}" controls autoplay></video>`;
  } else if (/\.(mp3|wav|ogg|m4a)$/.test(lower)) {
    inner = `<audio src="${url}" controls autoplay></audio>`;
  } else if (/\.pdf$/.test(lower)) {
    inner = `<iframe src="${url}"></iframe>`;
  } else {
    // 其他类型：直接触发下载（浏览器跟随 302 直链）
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

// 排序切换
document.getElementById('sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  openPath(state.path);
});

// 搜索（现搜 + 后端内存索引）
document.getElementById('search').addEventListener('input', async (e) => {
  const q = e.target.value.trim();
  const listEl = document.getElementById('list');
  if (!q) return openPath(state.path);
  const pw = pwFor(state.path);
  const params = new URLSearchParams({ q, path: state.path });
  if (pw) params.set('pw', pw);
  const r = await fetch(`/api/search?${params.toString()}`);
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

openPath('/');
