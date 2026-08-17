// 极简前端 SPA：浏览 + 密码 + 搜索 + 预览（全部经 302 直链，Worker 不搬字节）。
const state = { path: '/', passwords: {} };

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function downloadUrl(path) {
  return `/api/download?path=${encodeURIComponent(path)}`;
}

async function apiList(path) {
  const pw = state.passwords[path] || '';
  const r = await fetch(`/api/list?path=${encodeURIComponent(path)}`, {
    headers: pw ? { 'X-Folder-Password': pw } : {},
  });
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
  const entries = res.entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
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
  let inner = '';
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(lower)) {
    inner = `<img src="${downloadUrl(path)}" />`;
  } else if (/\.(mp4|webm|mov|mkv|m4v)$/.test(lower)) {
    inner = `<video src="${downloadUrl(path)}" controls autoplay></video>`;
  } else if (/\.(mp3|wav|ogg|m4a)$/.test(lower)) {
    inner = `<audio src="${downloadUrl(path)}" controls autoplay></audio>`;
  } else if (/\.pdf$/.test(lower)) {
    inner = `<iframe src="${downloadUrl(path)}"></iframe>`;
  } else {
    // 其他类型：直接触发下载（浏览器跟随 302 直链）
    window.location.href = downloadUrl(path);
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

// 搜索（现搜 + 后端内存索引）
document.getElementById('search').addEventListener('input', async (e) => {
  const q = e.target.value.trim();
  const listEl = document.getElementById('list');
  if (!q) return openPath(state.path);
  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(state.path)}`);
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

// 拉取公用配置（站点标题等）
fetch('/api/config')
  .then((r) => r.json())
  .then((d) => { if (d && d.title) document.title = d.title; })
  .catch(() => {});

openPath('/');
