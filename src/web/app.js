// 极简前端 SPA：浏览 + 弹窗密码(X-Folder-Password 头) + 搜索 + 排序 + 预览。
// 密码不进 URL：经请求头传递，地址栏始终干净。下载/预览走 /api/link 拿直链 JSON。
const state = { path: '/', pwSet: new Set(), sort: 'name_asc' };
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

async function apiList(path) {
  const params = new URLSearchParams({ path });
  if (state.sort) params.set('sort', state.sort);
  const r = await fetch('/api/list?' + params.toString(), { headers: pwHeaders() });
  if (r.status === 403) {
    const body = await r.json().catch(() => ({}));
    return { needPassword: true, lockedAt: body.lockedAt };
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

/** 弹窗输入密码，返回输入的密码或 null（取消）。 */
function askPassword(hintPath) {
  return new Promise((resolve) => {
    const modal = document.getElementById('pwModal');
    const input = document.getElementById('pwInput');
    const ok = document.getElementById('pwOk');
    const cancel = document.getElementById('pwCancel');
    const title = document.getElementById('pwTitle');
    if (title) title.textContent = hintPath && hintPath !== '/' ? `请输入 ${hintPath} 的密码` : '请输入密码';
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
    const pw = await askPassword(res.lockedAt || path);
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

// 排序切换
document.getElementById('sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  openPath(state.path);
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

openPath('/');
