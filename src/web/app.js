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

// 预览库按需加载缓存
const previewLibs = {};

// 动态加载库（CDN）
async function loadLib(name, url) {
  if (previewLibs[name]) return previewLibs[name];
  const script = document.createElement('script');
  script.src = url;
  document.head.appendChild(script);
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
  });
  previewLibs[name] = window[name];
  return previewLibs[name];
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 客户端已知密码集合：进入受保护层级时弹窗收集，存入 Set。
// 每个请求把集合内所有密码以重复 X-Folder-Password 头带上，后端逐层校验
// （父目录 + 子目录各有密码配置时，需两层密码都满足 = 子层重新鉴权）。
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
      ? `服务端已收到 ${res.received} 个密码，仍未解锁 ${res.lockedAt || path}；检查配置或输入的密码。`
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
  listEl.querySelectorAll('.row').forEach((row, idx) => {
    row.onclick = () => {
      const p = row.dataset.path;
      if (row.dataset.dir === 'true') openPath(p);
      else preview(p, row.querySelector('.name').textContent, entries[idx]);
    };
  });
}

function renderGridView(entries, listEl) {
  listEl.className = 'grid-view';
  listEl.innerHTML = entries
    .map((e) => {
      const isImage = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(e.name);
      // 用 data-src 延迟加载，后续用 fetch 带密码头获取缩略图
      const thumb = isImage 
        ? `<img data-src="${esc(e.path)}" class="lazy-thumb" loading="lazy" />`
        : `<div class="icon">${e.isDir ? '📁' : '📄'}</div>`;
      return `<div class="grid-item" data-path="${esc(e.path)}" data-dir="${e.isDir}">
        <div class="thumb">${thumb}</div>
        <div class="name">${esc(e.name)}</div>
      </div>`;
    })
    .join('');
  // 用 fetch 加载缩略图，带密码头
  listEl.querySelectorAll('.lazy-thumb').forEach((img) => {
    const path = img.dataset.src;
    loadThumb(path).then(url => {
      if (url) img.src = url;
    }).catch(() => {});
  });
  listEl.querySelectorAll('.grid-item').forEach((item) => {
    item.onclick = () => {
      const p = item.dataset.path;
      if (item.dataset.dir === 'true') openPath(p);
      else preview(p, item.querySelector('.name').textContent);
    };
  });
}

async function loadThumb(path) {
  const res = await fetch(`/api/link?path=${encodeURIComponent(path)}`, { headers: pwHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return data.url || null;
}

function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(1) + ' ' + u[i];
}

// 图片预览增强：EXIF + 缩放旋转
async function previewImage(url, name) {
  let controls = `
    <div class="preview-controls">
      <button onclick="zoomImage(0.1)">放大</button>
      <button onclick="zoomImage(-0.1)">缩小</button>
      <button onclick="rotateImage(90)">旋转</button>
      <button onclick="resetImage()">重置</button>
      <button onclick="toggleFullscreen()">全屏</button>
      <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
      <button onclick="showQRCode('${esc(url)}')">二维码</button>
    </div>
  `;
  
  let exifPanel = '';
  if (adminState.loggedIn) {
    try {
      await loadLib('ExifReader', 'https://cdn.jsdelivr.net/npm/exifreader@5.0.0/dist/exif-reader.min.js');
      const resp = await fetch(url);
      const buffer = await resp.arrayBuffer();
      const tags = ExifReader.read(buffer);
      
      const exifData = [];
      if (tags.Make) exifData.push(`相机: ${tags.Make.description}`);
      if (tags.Model) exifData.push(`型号: ${tags.Model.description}`);
      if (tags.DateTime) exifData.push(`时间: ${tags.DateTime.description}`);
      if (tags.FocalLength) exifData.push(`焦距: ${tags.FocalLength.description}`);
      if (tags.ApertureValue) exifData.push(`光圈: ${tags.ApertureValue.description}`);
      if (tags.ISOSpeedRatings) exifData.push(`ISO: ${tags.ISOSpeedRatings.description}`);
      if (tags.ExposureTime) exifData.push(`快门: ${tags.ExposureTime.description}`);
      if (tags.GPSLatitude && tags.GPSLongitude) {
        exifData.push(`GPS: ${tags.GPSLatitude.description}, ${tags.GPSLongitude.description}`);
      }
      
      if (exifData.length > 0) {
        exifPanel = `<div class="exif-panel"><strong>EXIF 信息</strong><br>${exifData.join('<br>')}</div>`;
      }
    } catch (e) {
      console.log('EXIF 读取失败:', e);
    }
  }
  
  return `
    ${controls}
    <div class="image-container">
      <img id="previewImg" src="${url}" style="max-width:100%;max-height:80vh;transition:transform 0.3s" />
    </div>
    ${exifPanel}
  `;
}

// 图片操作函数
let imageZoom = 1;
let imageRotate = 0;

function zoomImage(delta) {
  imageZoom = Math.max(0.1, Math.min(5, imageZoom + delta));
  updateImageTransform();
}

function rotateImage(deg) {
  imageRotate = (imageRotate + deg) % 360;
  updateImageTransform();
}

function resetImage() {
  imageZoom = 1;
  imageRotate = 0;
  updateImageTransform();
}

function updateImageTransform() {
  const img = document.getElementById('previewImg');
  if (img) {
    img.style.transform = `scale(${imageZoom}) rotate(${imageRotate}deg)`;
  }
}

// 全屏预览
function toggleFullscreen() {
  const modal = document.getElementById('modal');
  if (!document.fullscreenElement) {
    modal.requestFullscreen().catch(err => {
      console.log('全屏失败:', err);
    });
  } else {
    document.exitFullscreen();
  }
}

// 复制分享链接
async function copyShareLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    alert('链接已复制');
  } catch (e) {
    // 降级方案
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    alert('链接已复制');
  }
}

// 显示二维码
async function showQRCode(url) {
  try {
    await loadLib('QRCode', 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js');
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, url);
    
    const modal = document.createElement('div');
    modal.className = 'pwmodal show';
    modal.innerHTML = `
      <div class="pwbox">
        <div class="pwtitle">扫描二维码</div>
        <div style="text-align:center"></div>
        <div class="pwrow">
          <button class="btn" onclick="this.closest('.pwmodal').remove()">关闭</button>
        </div>
      </div>
    `;
    modal.querySelector('div > div').appendChild(canvas);
    document.body.appendChild(modal);
  } catch (e) {
    alert('二维码生成失败: ' + e.message);
  }
}

// 文件信息面板
function showFileInfo(path, name, size, mime) {
  const modal = document.createElement('div');
  modal.className = 'pwmodal show';
  modal.innerHTML = `
    <div class="pwbox">
      <div class="pwtitle">文件信息</div>
      <div style="font-size:14px;line-height:1.8">
        <div><strong>文件名:</strong> ${esc(name)}</div>
        <div><strong>路径:</strong> ${esc(path)}</div>
        <div><strong>大小:</strong> ${fmtSize(size)}</div>
        <div><strong>类型:</strong> ${esc(mime || '未知')}</div>
      </div>
      <div class="pwrow">
        <button class="btn" onclick="this.closest('.pwmodal').remove()">关闭</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function preview(path, name, entry = null) {
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
      return preview(path, name, entry);
    }
    alert('预览失败：' + (e.message || e));
    return;
  }
  
  let inner = '';
  
  // 图片预览（增强版）
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(lower)) {
    inner = await previewImage(url, name);
  } 
  // 视频预览
  else if (/\.(mp4|webm|mov|mkv|m4v)$/.test(lower)) {
    inner = `
      <div class="preview-controls">
        <button onclick="toggleFullscreen()">全屏</button>
        <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
      </div>
      <video src="${url}" controls autoplay style="max-width:100%;max-height:80vh"></video>
    `;
  } 
  // 音频预览
  else if (/\.(mp3|wav|ogg|m4a)$/.test(lower)) {
    inner = `
      <div class="preview-controls">
        <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
      </div>
      <audio src="${url}" controls autoplay style="width:100%"></audio>
    `;
  } 
  // PDF 预览
  else if (/\.pdf$/.test(lower)) {
    inner = `
      <div class="preview-controls">
        <button onclick="toggleFullscreen()">全屏</button>
        <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
      </div>
      <iframe src="${url}" style="width:100%;height:80vh;border:none"></iframe>
    `;
  } 
  // Office 文件预览
  else if (/\.(docx?|xlsx?|pptx?|doc|xls|ppt)$/.test(lower)) {
    const officeUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`;
    inner = `<iframe src="${officeUrl}" style="width:100%;height:80vh;border:none"></iframe>`;
  } 
  // Markdown 预览
  else if (/\.md$/.test(lower)) {
    try {
      await loadLib('marked', 'https://cdn.jsdelivr.net/npm/marked@11.1.0/marked.min.js');
      await loadLib('DOMPurify', 'https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js');
      
      const resp = await fetch(url);
      const text = await resp.text();
      const html = DOMPurify.sanitize(marked.parse(text));
      
      inner = `
        <div class="preview-controls">
          <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
          <button onclick="toggleRaw()">原始文本</button>
        </div>
        <div id="mdRendered" class="markdown-body">${html}</div>
        <pre id="mdRaw" style="display:none">${esc(text)}</pre>
      `;
    } catch (e) {
      alert('Markdown 渲染失败: ' + e.message);
      return;
    }
  } 
  // JSON 预览（虚拟滚动）
  else if (/\.json$/.test(lower)) {
    try {
      const resp = await fetch(url);
      const text = await resp.text();
      const data = JSON.parse(text);
      const formatted = JSON.stringify(data, null, 2);
      
      inner = `
        <div class="preview-controls">
          <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
          <button onclick="toggleJSON()">折叠/展开</button>
        </div>
        <div class="json-viewer" style="max-height:70vh;overflow:auto">
          <pre>${esc(formatted)}</pre>
        </div>
      `;
    } catch (e) {
      alert('JSON 解析失败: ' + e.message);
      return;
    }
  } 
  // CSV 预览（表格）
  else if (/\.(csv|tsv)$/.test(lower)) {
    try {
      await loadLib('Papa', 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js');
      
      const resp = await fetch(url);
      const text = await resp.text();
      const result = Papa.parse(text, { header: true, skipEmptyLines: true });
      
      if (result.data.length === 0) {
        inner = '<div class="empty">空文件</div>';
      } else {
        const headers = result.meta.fields || [];
        let table = '<table class="csv-table"><thead><tr>';
        headers.forEach(h => table += `<th>${esc(h)}</th>`);
        table += '</tr></thead><tbody>';
        
        // 虚拟滚动：只显示前 100 行
        const displayRows = result.data.slice(0, 100);
        displayRows.forEach(row => {
          table += '<tr>';
          headers.forEach(h => table += `<td>${esc(row[h] || '')}</td>`);
          table += '</tr>';
        });
        table += '</tbody></table>';
        
        if (result.data.length > 100) {
          table += `<div class="empty">显示前 100 行，共 ${result.data.length} 行</div>`;
        }
        
        inner = `
          <div class="preview-controls">
            <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
          </div>
          <div style="max-height:70vh;overflow:auto">${table}</div>
        `;
      }
    } catch (e) {
      alert('CSV 解析失败: ' + e.message);
      return;
    }
  } 
  // YAML 预览
  else if (/\.(yaml|yml)$/.test(lower)) {
    try {
      await loadLib('jsyaml', 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js');
      
      const resp = await fetch(url);
      const text = await resp.text();
      const data = jsyaml.load(text);
      const formatted = JSON.stringify(data, null, 2);
      
      inner = `
        <div class="preview-controls">
          <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
        </div>
        <div style="max-height:70vh;overflow:auto">
          <pre>${esc(formatted)}</pre>
        </div>
      `;
    } catch (e) {
      alert('YAML 解析失败: ' + e.message);
      return;
    }
  } 
  // XML 预览
  else if (/\.xml$/.test(lower)) {
    try {
      const resp = await fetch(url);
      const text = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      const formatted = new XMLSerializer().serializeToString(doc);
      
      inner = `
        <div class="preview-controls">
          <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
        </div>
        <div style="max-height:70vh;overflow:auto">
          <pre>${esc(formatted)}</pre>
        </div>
      `;
    } catch (e) {
      alert('XML 解析失败: ' + e.message);
      return;
    }
  } 
  // 代码文件预览（语法高亮 - Prism.js）
  else if (/\.(txt|js|ts|py|java|c|cpp|h|hpp|css|html|ini|cfg|sh|bash|zsh|sql|go|rs|rb|php|pl|swift|kt|scala|r|lua|vim|dockerfile|makefile)$/.test(lower)) {
    try {
      // 加载 Prism 核心（如果未加载）
      if (!window.Prism) {
        await loadLib('Prism', 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js');
        // 加载主题 CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css';
        document.head.appendChild(link);
      }
      
      const resp = await fetch(url);
      const text = await resp.text();
      
      // 根据扩展名选择语言
      const langMap = {
        'js': 'javascript', 'ts': 'typescript', 'py': 'python',
        'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'c',
        'css': 'css', 'html': 'markup', 'xml': 'markup',
        'ini': 'ini', 'cfg': 'ini', 'sh': 'bash', 'bash': 'bash',
        'zsh': 'bash', 'sql': 'sql', 'go': 'go', 'rs': 'rust',
        'rb': 'ruby', 'php': 'php', 'pl': 'perl', 'swift': 'swift',
        'kt': 'kotlin', 'scala': 'scala', 'r': 'r', 'lua': 'lua',
        'vim': 'vim', 'dockerfile': 'docker', 'makefile': 'makefile'
      };
      
      const ext = lower.split('.').pop();
      const lang = langMap[ext] || 'plaintext';
      
      // 按需加载语言组件
      if (lang !== 'plaintext' && !Prism.languages[lang]) {
        await loadLib(`prism-${lang}`, `https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-${lang}.min.js`);
      }
      
      let highlighted;
      try {
        if (lang === 'plaintext' || !Prism.languages[lang]) {
          highlighted = esc(text);
        } else {
          highlighted = Prism.highlight(text, Prism.languages[lang], lang);
        }
      } catch (e) {
        highlighted = esc(text);
      }
      
      inner = `
        <div class="preview-controls">
          <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
        </div>
        <pre style="max-height:70vh;overflow:auto"><code class="language-${lang}">${highlighted}</code></pre>
      `;
    } catch (e) {
      // 降级：无高亮
      const resp = await fetch(url);
      const text = await resp.text();
      inner = `<pre style="max-height:70vh;overflow:auto">${esc(text)}</pre>`;
    }
  } 
  // ZIP 压缩包预览
  else if (/\.zip$/.test(lower)) {
    try {
      await loadLib('fflate', 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js');
      
      const resp = await fetch(url);
      const buffer = await resp.arrayBuffer();
      const zip = fflate.unzipSync(new Uint8Array(buffer));
      
      let fileList = '<div class="zip-file-list"><strong>压缩包内容:</strong><ul>';
      for (const [path, data] of Object.entries(zip)) {
        const size = data.length;
        fileList += `<li>
          <span>${esc(path)}</span>
          <span style="color:var(--muted);font-size:12px">${fmtSize(size)}</span>
          <button class="btn" style="padding:2px 8px;font-size:12px" onclick="extractZipFile('${esc(path)}', '${esc(url)}')">预览</button>
          <button class="btn" style="padding:2px 8px;font-size:12px" onclick="downloadZipFile('${esc(path)}', '${esc(url)}')">下载</button>
        </li>`;
      }
      fileList += '</ul></div>';
      
      inner = `
        <div class="preview-controls">
          <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
        </div>
        ${fileList}
      `;
    } catch (e) {
      alert('ZIP 解析失败: ' + e.message);
      return;
    }
  } 
  // 字体文件预览
  else if (/\.(ttf|otf|woff|woff2)$/.test(lower)) {
    inner = `
      <div class="preview-controls">
        <button onclick="copyShareLink('${esc(url)}')">复制链接</button>
      </div>
      <div style="text-align:center;padding:40px">
        <div style="font-size:48px;font-family:CustomFont">AaBbCcDdEeFfGg</div>
        <style>@font-face { font-family: 'CustomFont'; src: url('${url}'); }</style>
        <div style="margin-top:20px;color:var(--muted)">字体预览</div>
      </div>
    `;
  } 
  // 其他类型：下载
  else {
    window.location.href = url;
    return;
  }
  
  // 添加文件信息按钮
  if (entry) {
    inner = `
      <div class="preview-controls" style="border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:8px">
        <button onclick="showFileInfo('${esc(path)}', '${esc(name)}', ${entry.size || 0}, '${esc(entry.mime || '')}')">文件信息</button>
      </div>
      ${inner}
    `;
  }
  
  document.getElementById('modalBody').innerHTML = inner;
  document.getElementById('modal').classList.add('show');
}

// ZIP 文件预览
async function extractZipFile(filePath, zipUrl) {
  try {
    const resp = await fetch(zipUrl);
    const buffer = await resp.arrayBuffer();
    const zip = fflate.unzipSync(new Uint8Array(buffer));
    const data = zip[filePath];
    
    if (!data) {
      alert('文件不存在');
      return;
    }
    
    // 根据文件类型预览
    const ext = filePath.split('.').pop().toLowerCase();
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    
    if (/\.(txt|md|json|js|ts|py|java|c|cpp|h|css|html|xml|yaml|yml|ini|cfg|sh|sql|go|rs|rb|php)$/.test(ext)) {
      const text = new TextDecoder().decode(data);
      const modal = document.createElement('div');
      modal.className = 'pwmodal show';
      modal.innerHTML = `
        <div class="pwbox" style="width:90vw;max-width:800px">
          <div class="pwtitle">${esc(filePath)}</div>
          <pre style="max-height:70vh;overflow:auto">${esc(text)}</pre>
          <div class="pwrow">
            <button class="btn" onclick="this.closest('.pwmodal').remove()">关闭</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    } else if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(ext)) {
      const modal = document.createElement('div');
      modal.className = 'pwmodal show';
      modal.innerHTML = `
        <div class="pwbox">
          <div class="pwtitle">${esc(filePath)}</div>
          <img src="${url}" style="max-width:100%;max-height:70vh" />
          <div class="pwrow">
            <button class="btn" onclick="this.closest('.pwmodal').remove()">关闭</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    } else {
      // 其他类型：下载
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath.split('/').pop();
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    alert('解压失败: ' + e.message);
  }
}

// ZIP 文件下载
async function downloadZipFile(filePath, zipUrl) {
  try {
    const resp = await fetch(zipUrl);
    const buffer = await resp.arrayBuffer();
    const zip = fflate.unzipSync(new Uint8Array(buffer));
    const data = zip[filePath];
    
    if (!data) {
      alert('文件不存在');
      return;
    }
    
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filePath.split('/').pop();
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('下载失败: ' + e.message);
  }
}

// Markdown 原始文本切换
function toggleRaw() {
  const rendered = document.getElementById('mdRendered');
  const raw = document.getElementById('mdRaw');
  if (rendered && raw) {
    const isHidden = rendered.style.display === 'none';
    rendered.style.display = isHidden ? '' : 'none';
    raw.style.display = isHidden ? 'none' : '';
  }
}

// JSON 折叠切换
function toggleJSON() {
  const pre = document.querySelector('.json-viewer pre');
  if (pre) {
    const text = pre.textContent;
    try {
      const data = JSON.parse(text);
      if (pre.dataset.collapsed === 'true') {
        pre.textContent = JSON.stringify(data, null, 2);
        pre.dataset.collapsed = 'false';
      } else {
        pre.textContent = JSON.stringify(data);
        pre.dataset.collapsed = 'true';
      }
    } catch (e) {}
  }
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

// 刷新按钮：强制回源当前目录（绕过缓存，立即反映配置 / 文件的改动）
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

// 页面离开时自动保存配置
window.addEventListener('beforeunload', (e) => {
  if (adminState.loggedIn) {
    // 发送同步请求保存配置
    navigator.sendBeacon('/api/admin/save');
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
