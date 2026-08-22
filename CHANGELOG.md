# 变更记录（CHANGELOG）

> 仅记录功能性变更与缺陷修复，运维/环境/清理类操作不在此列。

## 2026-08-21

### 修复：点进目录弹密码框（配置加载失败伪装成密码提示）

- **严重级别**：P0（线上功能阻断）
- **现象**：首页可显示挂载盘（来自 `MOUNT_*` 环境变量），但点进任意目录后前端弹出“请输入 /xxx 的密码”，输入任何密码均无效。
- **根因**：`src/routes/fs.ts` 的 `loadXlsxConfig()` 在构造 OneDrive 驱动配置时，只传了 `{mount, root, driver, addition}`，**漏传 `user_id`**。而 `src/drivers/onedrive.ts:42` 要求 `mount.user_id` 非空，否则抛 `onedrive app-only requires user_id (UPN or objectId)`。`user_id` 仅存在于 `MOUNT_<NAME>` 的 `users[].user_id`（正常挂载路径经 `config.ts:65` 已传入）。
- **因果链**：驱动初始化抛错 → `hasError=true` → `.elist.xlsx` 不标记已加载 → `acl.ts:56` 见 `!isLoaded()` 按安全设计（fail-closed）返回 `{ok:false}` → 所有非根路径返回 `password_required`(403) → 前端弹密码框。
- **修复**：新增 `getMountUserId(env, accountName)`，按账号名配对解析 `MOUNT_<NAME>`，优先取命中 `CONFIG_PATH` 的用户、否则取首个有挂载的用户，并将其 `user_id` 传入两处 `driver.init`（`CONFIG_AUTH` 分支与遍历分支）。
- **验证**：`tsc --noEmit` 零错误；`wrangler tail` 不再出现 `requires user_id` 报错；`wrangler deploy` 上线新版本 `02c79924`。线上（自定义域名 `dr.zhbq.eu.org` 及 `elist.zhuboqi.workers.dev`）实测：`/api/list?path=/zh33`、`/api/list?path=/admin` 及子目录（`/admin/Attachments`、`/admin/mskeep` 等）均返回 200 且为真实文件 JSON（如 mp3/zip/jpg/cer），**无任何 password_required**。原始 `curl` 直取 `/zh33` 返回 `["08-18", "15526853300-2608181526.mp3", ...]` 文件数组，修复确认。
- **遗留（非本次范围）**：深层目录（如 `/admin/程序自动创建文件夹`）偶发 `Too many subrequests by single Worker invocation` 限流，属独立性能/限额问题，不影响功能与本次修复。
- **关联文档**：`docs/onedrive-variable.md` 新增 FAQ“点进目录弹密码框（实则不是密码问题）”，消除“弹密码=需要密码”的认知偏差。

### 修复：首次加载未自动创建 .elist.xlsx

- **严重级别**：P1（功能逻辑缺失）
- **现象**：配置加载正常、列表可用，但存储根目录从不出现 `.elist.xlsx` 空白配置文件。
- **根因**：`loadXlsxConfig()` 的“未找到 .elist.xlsx”分支（`src/routes/fs.ts:182-187`）仅调用 `xlsxConfig.markLoaded()` 标记内存已加载，**从不将空白配置文件写回存储**，导致空白 `.elist.xlsx` 永不落盘。
- **修复**：在该分支 `markLoaded()` 之前，复用既有 `getConfigMount(c)`（已按 `CONFIG_AUTH`/首个账号选好目标存储、且 `root` 已设为 `CONFIG_PATH` 或 `/`）初始化 driver，调用 `xlsxConfig.generateXlsx(c.env.CONF_PW)` 生成空白工作簿，并以 `driver.writeBinary(xlsxPath, content)` 写入存储根（落点 `CONFIG_PATH` 或 `/`）。写失败 catch 后仍 `markLoaded()`，不阻断浏览。加解密参数与保存/读取路径完全对齐；默认落点不依赖任何额外变量，与预期一致。
- **验证**：`tsc --noEmit` 零错误；`wrangler deploy` 上线后冷启动不再缺文件；raw curl 确认存储根出现 `.elist.xlsx`。

### 修复：部署失败（wrangler 类型检查报错 + 空壳 Worker）

- **现象**：CF 上 Worker 只是 dashboard 的 Hello World 模板（275 字节），真实代码未部署；`wrangler deploy` 因类型错误被卡。
- **根因**：`src/routes/webdav.ts:131` 把 `depth`（string）传给 `buildPropfind` 的第 5 参数 `selfIsDir`（boolean），`tsc` 报 TS2345；`package.json` 的 build 脚本 `tsc --noEmit` 门禁会阻断任何走类型检查的部署流程。
- **修复**：PROPFIND 分支传参改为 `buildPropfind(baseUrl, storagePath, children, isDir, isDir)`，并实现 RFC 4918 `Depth:0` 语义（目录只返回自身不列子项，文件始终返回自身）。联动修复 `49bd6e4` 提交引入的回归：WebDAV PUT 二进制上传损坏、PROPFIND 文件条目丢失 size/modified。
- **验证**：`tsc --noEmit` 零错误；`wrangler deploy` 成功（代码 + 静态资产 + cron）；线上首页正常渲染挂载盘。

> 注：上述 webdav.ts 类型修复、fs.ts user_id 修复、fs.ts 自动创建 .elist.xlsx 修复，均已随本轮一并 commit 并 `git push` 至 `origin/main`；CF 侧已重新 `wrangler deploy` 上线。

### 修复/增强：管理员密码纯表控制（自动键空值 + 空密码拦截）

- **设计（用户拍板）**：不引入 `ADMIN_PASSWORD` 环境变量、不做首次引导/设置向导。管理员密码完全由 `.elist.xlsx` 的 config 工作表控制——自动建表或缺项时自动键入该键、默认空；用户手动改表把值填上，再登录。
- **自动键刚需配置项**：`src/lib/xlsx-config.ts` 新增 `DEFAULT_CONFIG = { admin_password: '' }` 与 `ensureDefaultConfig()`，并在 `generateXlsx()`（自动建表/保存）与 `parseXlsx()`（加载已有表）两处调用。新建或老表缺 `admin_password` 键时自动补入空字符串默认值，且标脏以便下次保存落盘。
- **空密码拦截登录**：`src/routes/admin.ts` 的 `handleLogin` 改为读取 `admin_password`（恒存在，空即“未设置”），为空时返回 `401 {error:'密码未设置'}`，不允许登录。用户在 `.elist.xlsx` config 表把 `admin_password` 设为非空值并保存后即可正常登录。
- **验证**：`tsc --noEmit` 零错误。

### 重写：前端 UI（零构建原生 SPA）

- **动机**：原 `src/web/app.js`（手写、丑、缺控制按钮、音视频无进度条、文件操作接口未接）。目标：性能优先 + 外观精致 + 功能全。
- **方案**：零构建原生 SPA（`src/web/index.html` + `styles.css` + `app.js`），静态 CSS（深/浅双主题，无运行时 CSS-in-JS，首屏即样式），无框架运行时，首屏最快。音视频预览本地 vendored `plyr`（懒加载，仅预览时注入脚本/样式），失败自动回退原生 `<video>/<audio>`（自带进度条）。
- **功能补齐**：
  - 列表/网格双视图、排序（名称/时间/大小）、面包屑导航、搜索（复用 `/api/search`）、刷新（`fresh=1`）。
  - 目录密码：403 `password_required` 自动弹密码框，密码随 `X-Folder-Password` 头累积传递。
  - 管理员：登录（空密码明确提示“请先在 config 表设置 admin_password”）、当前目录密码/隐藏设置、保存配置。
  - 文件操作打通后端既有 `/api/file/*`：新建文件夹(mkdir)、改名/移动(move)、删除(delete)，全部带 `X-Admin-Password`（此前后端已全实现，仅前端缺失调用）。
  - 预览：图片/视频/音频/PDF/文本（内联）/其他（下载）；音视频 Plyr 播放器带进度条、音量、全屏。
- **部署**：`wrangler.toml` 的 `[assets]` 仍指向 `./src/web`，`not_found_handling = "single-page-application"` 不变；构建产物即静态文件，无需额外构建步骤。

### 修复：前端布局与交互缺陷（侧栏/图标对齐/隐藏入口/按钮常显）

- **左侧栏回归**：上一版按“侧栏按钮移入 header”把整个左侧栏删除，用户需要盘符导航。现恢复左侧栏（`src/web/app.js` 的 `renderDrives` / `bindSidebar`），内容取自根目录盘符列表 `/api/list?path=/`，点击即跳转，当前所在盘符高亮（`active`）。
- **图标与文字对齐**：`renderList` 的 `.name` 是 flex，但图标与文件名被内层 `.label` 内联包着，SVG 未与文字基线居中。改为 `.row .name` 与 `.label` 均为 `display:flex; align-items:center`，`.glyph` 改用 `inline-flex` 固定 20×20，列表/网格图标均垂直居中。
- **隐藏选项入口**：后端 `hidden` 隐藏逻辑一直存在（admin 菜单里也有复选框），但入口太深、列表无任何隐藏相关按钮，观感像“没了”。现为每条目（管理员）增加常驻“隐藏/取消隐藏”按钮（眼睛图标），直接打开 `setFolderPassword(path)` 复用密码+隐藏设置；保存后自动刷新侧栏与列表。
- **控制按钮常显**：原列表仅 hover 才显示操作按钮，用户感知“按钮不全”。现为管理员条目常显改名/移动/隐藏/删除四枚图标按钮（hover 仅加深不隐藏）；网格卡片 hover 显示。
- **视觉打磨**：左侧栏独立可滚动、盘符用驱动器图标、品牌 Logo 方块；工具栏精简（视图切换/排序/刷新/新建），主题与登录移入侧栏底部；卡片 hover 加阴影与位移；整体配色与间距收敛。性能依旧零运行时 CSS、无框架。

### 修复+增强：图标尺寸统一 / 目录设置未授权 / 全量预览恢复

- **图标大小不一与对不齐**（用户反馈“图标太大、按钮大小不匀称”）：根因是 `ICON.*` 裸 SVG 未包 `.glyph` class，而尺寸约束 `.glyph svg{20px}` 只对带 `.glyph` 的元素生效，侧栏/工具栏/列表/按钮的裸 SVG 全部用默认尺寸渲染。修复：`styles.css` 新增统一规则，`.btn svg / .drive svg / .seg button svg / .row .name .label svg / .fab-acts .btn svg / .preview-bar .btn svg` 全部强制 18×18、`display:block; flex:0 0 auto`，侧栏 20×20，卡片缩略图 44×44；配合父容器 flex 居中，图标与文字垂直对齐。
- **列表文件名截断过早**：`table-layout: fixed` + 固定大小/时间/操作列宽，名称列自动占满剩余宽度（移动端隐藏大小/时间列时自动放宽）。
- **目录设置页提交“未授权”**（用户反馈设置密码保存报 401）：根因是 `app.js` 调 `/api/admin/config`(POST) 与 `/api/admin/save` 时误用裸 `fetch`（`apiAuth`），未带 `X-Admin-Password` 头，后端管理员鉴权拒绝。修复：3 处改为 `apiSend(..., {admin:true})`（自动带管理员密码头）；读取当前目录配置也新增 `apiAdminGet` 带头获取，使编辑弹窗能预填当前密码/提示/隐藏值，避免只改提示时误清空密码。
- **全量预览恢复**（用户反馈“zip 预览之类的功能全没了”——上一版零构建重写时被过度精简砍掉）：按旧版功能全量恢复，且预览库全部改为**本地 vendored + 按需懒加载**（`src/web/vendor/`，走 CF 边缘缓存，首屏零额外加载）：
  - 图片增强：缩放/旋转/重置/全屏、复制链接、二维码（`qrcode-generator`）、管理员可见 EXIF 信息（`exifreader`）。
  - ZIP 解压预览：`fflate` 列出压缩包内容（目录/文件+大小），支持内部文件内联预览与下载。
  - Markdown：`marked` + `DOMPurify` 渲染（原始/渲染视图切换）。
  - JSON：格式化 + 折叠/展开；CSV/TSV：`papaparse` 表格（前 3000 行防卡顿）；YAML：`js-yaml` 转 JSON 展示；XML：缩进格式化。
  - 代码高亮：`prism` 核心 + 常用语言包本地化（js/ts/py/java/c/cpp/css/html/bash/sql/go/rust/php/json/yaml/markdown/markup/clike），按扩展名映射、按需加载语言包并处理依赖顺序（typescript→javascript→clike 等）。
  - Office（doc/docx/xls/xlsx/ppt/pptx）：微软在线预览 iframe；字体（ttf/otf/woff/woff2）：@font-face 示例预览；其他类型提示下载（不再自动跳转）。
  - 网格视图图片缩略图懒加载（IntersectionObserver，失败回退图标）。
- **预览交互**：预览弹窗标题栏带“信息/关闭”，底部通用“复制链接/下载”；所有按钮事件用 `addEventListener` 绑定（ES module 顶层函数不在 window，旧版内联 `onclick` 不可用）。zip 内部预览/下载用新模态框体系实现。
- **验证**：`node --check src/web/app.js` 通过；`tsc --noEmit`（后端未改动）零错误。

### 修复+增强：管理员鉴权无状态化 / 大 ZIP Range 预览 / 导航与网格交互重做

- **管理员鉴权「未授权」根治（重要）**：上一轮只改了前端带头、后端不认头，问题依旧。根因：`src/routes/admin.ts` 的 `isAuthenticated` 只认 **Session Cookie**（内存 Map），而 Cloudflare Workers isolate 无状态、会被回收，登录发的 session 下次请求常查不到 → 401。修复：`isAuthenticated` 改为 async，在 Cookie 之外新增 **`X-Admin-Password` 头验证**（== config 表 `admin_password`，与 `/api/file/*` 同一套无状态鉴权，`constantTimeCompare` 防时序攻击），三处 handler 加 await。前端已带头无需改；`init()` 增加从 `sessionStorage` 恢复登录态（刷新不再掉管理员）。
- **大 ZIP 预览（Range 中央目录扫描）**：不再全量下载+`unzipSync`（大包浏览器/服务端都会爆内存）。主路径用 `Range` 只拉末尾 64KB 定位 EOCD → 再拉中央目录（几十 KB）列全部文件清单（秒开、不下载包体）；单文件预览/下载用 `Range` 只拉该条目压缩数据再 `inflate`。无 Range 的存储：≤50MB 才允许整包下载但**仅解析中央目录不 inflate**；>50MB 放弃内容预览，只给「下载整个压缩包」并提示。服务端零改动（本来就不解压）。
- **网格卡片操作按钮出界**：4 个图标按钮在 158px 卡片上溢出。改为右上角单个 **⋯ 菜单按钮**（hover 显示），点开弹操作菜单（重命名/移动/隐藏/删除）；列表行保持 4 按钮常显。
- **图片预览**：容器改 flex 居中（原 `display:block` 顶掉 text-align）；全屏改为**纯图片全屏**（黑底、无边框无标题、contain 居中，退出自动恢复）；工具条一行重排（放大/缩小/旋转/重置 | 全屏/二维码/复制链接/下载）。
- **网格按类型区分**：新增类型图标体系（文件夹/视频/音频/图片/压缩包/文档/代码/文本，各自配色），图片仍走缩略图懒加载；排序新增「类型 ↑↓」（后端无此排序，前端本地按类别重排）。
- **向上导航**：工具栏「向上」按钮 + 列表首行/网格首卡 `..` 项（非根目录时），点击回上级。
- **左侧树形导航**：盘符/子目录可展开折叠（▸/▾），懒加载 `/api/list` 子目录，展开状态与子树内容缓存（`render()` 重建 DOM 后恢复），导航时自动展开祖先链并高亮当前路径。
- **验证**：`node --check src/web/app.js` 通过；`tsc --noEmit`（后端已改）零错误。

### 修复+增强：保存位置全部失败（补 user_id）/ 列表统一 ⋯ 菜单 / 树跟随 / 界面精致化

- **保存「所有保存位置都失败」修复**：`admin.ts` 的 `getConfigDriver` 构造驱动时 `driver.init` 漏传 `user_id`（`fs.ts` 内 3 处 `driver.init` 都传了），OneDrive app-only 必报 `requires user_id` → 4 个保存目标全抛错。补 `user_id: getMountUserId(env, targetAccount.name)`（`fs.ts:80` 的 `getMountUserId` 原为内部函数，已补 `export`）。
- **列表行统一 ⋯ 菜单**：`itemActionsHtml` 由 4 个图标按钮改为单个 ⋯ 按钮（`data-act="menu"`），点开与网格同一个 `entryMenu` 操作菜单（重命名/移动/隐藏/删除），交互全局统一。
- **树跟随当前目录**：新增 `scrollTreeToActive()`，导航后 `ensureExpanded(...).then(scrollTreeToActive)`，把树中高亮项 `scrollIntoView({block:'nearest'})` 滚动到侧栏可见位置（仅树内滚动，不动主区）。
- **loading 居中**：侧栏 `loadTreeChildren` 不再显示「加载中…/（无子目录）/（加载失败）」文字（失败静默、空目录静默），加载统一由主内容区 `.state-msg` 居中提示承担。
- **界面精致化（克制、零运行时开销）**：网格缩略图按类型着色浅底（文件夹/视频/音频/图片/压缩包/文档/代码/文本各自柔和底色）；内容切换 0.16s 淡入（纯 CSS animation）；空状态加类型图标；卡片 hover 阴影加深；预览标题栏加分隔线。
- **验证**：`node --check` 通过；`tsc --noEmit` 零错误。

### 修复+增强：管理员可见隐藏目录（带标记）/ 菜单精简 / 盘符根禁危险操作 / 徽标

- **管理员可见隐藏目录并带标记（后端）**：`fs.ts handleList` 新增 `isAdminRequest`（验证 `X-Admin-Password` 头 == admin_password）。管理员请求时**不过滤隐藏目录**，且每条目返回 `hidden`/`locked` 标记（根目录盘符分支同样处理）；普通浏览仍过滤。前端名称旁显示 👁（已隐藏）/🔒（已加密）徽标——只有管理员能看见隐藏目录、能调回来。
- **路径回退只留面包屑**：删工具栏「向上」按钮与列表/网格 `..` 项（面包屑可点返回）。
- **管理菜单精简**：删「新建文件夹」「设置当前目录密码」「保存配置」（新建在工具栏、密码/隐藏/重命名/移动/删除在条目 ⋯ 菜单，保存自动回写），只留「登出」。
- **盘符挂载根保护**：`entryMenu` 对挂载根（`state.drives` 中的顶层路径）只显示「隐藏/取消隐藏」，禁用 重命名/移动/删除（移动根=整盘改名移走，危险）。
- **树跟随修正**：`scrollTreeToActive` 改取最后一个 active（盘符与子目录可能同时高亮，取最深），滚动更准。
- **网格图标加大**：卡片缩略图 SVG 44px → 56px，与 92px 缩略图协调。
- **验证**：`node --check` + `tsc --noEmit` 零错误。

### 修复+增强：隐藏目录显示根治（前端带头）/ 导航降级为挂载盘 / 全屏加载遮罩 / 批量选择

- **隐藏目录「依然不显示」根治**：上轮后端已放行管理员（`isAdminRequest` 读 `X-Admin-Password` 头），但前端 `apiGet` 只带目录密码头、从不带管理员头，登录后 list 请求仍被当非管理员 → 隐藏继续被过滤。修复：`apiGet` 在已登录（`state.adminPw` 非空）时自动带 `X-Admin-Password` 头。
- **左侧导航降级为只显示挂载盘（用户拍板）**：树形导航横向（兄弟）目录默认不可见、且需手动展开，用户确认无免费获取横向的办法后，按兜底方案**删除整棵目录树**（`loadTreeChildren`/`bindTree`/`ensureExpanded`/`scrollTreeToActive`/展开缓存全部移除），侧栏只保留挂载盘 + 根目录按钮（点击跳转、当前盘高亮）。侧栏从此零加载文字、零跟随问题。
- **全屏加载遮罩**：主区 loading 由 content 区 60vh 提示改为**全屏居中遮罩**（fixed 半透明 + 居中「加载中…」，`#global-loading`），屏幕正中间。
- **批量选择（新功能）**：工具栏「☑ 选择」进入选择模式 → 列表/网格条目出现复选框 → 批量条：**全选 / 反选 / 复制链接 / 下载(N) / 退出**。复制链接逐个拉直链换行拼接到剪贴板；下载逐个触发（浏览器拦截时提示改用复制链接）。
- **列表垂直居中强化**：`.row td` 垂直居中 + `.label` inline-flex + line-height 固定 + `.glyph` line-height:0，图标与文字严格对齐。
- **图片默认适应窗口**：`.image-container img` 加 `object-fit: contain`（大图打开即完整显示不裁切）。
- **验证**：`node --check` + `tsc --noEmit` 零错误。

### 修复：回退全屏加载遮罩（过度设计，遮挡内容）

- 上轮把"加载中"做成**全屏 fixed 半透明遮罩**（inset:0 + rgba 黑底 + blur），过度设计，**整页被黑罩盖住、所有正常内容被遮挡**。
- "屏幕中间"=「加载文字在内容区居中显示」，不是全屏遮罩。
- 修复：删除 `.global-loading` CSS 和 renderContent 里创建/移除遮罩的代码；恢复内容区 `.state-msg` 居中文字提示（不遮挡）。

### 修复+增强：隐藏/加密逻辑重做 / 列表列布局重排 / ZIP 树形折叠

- **隐藏/加密逻辑（后端）**：
  - 未登录用户：隐藏项过滤（不显示）；可见项带 `locked`（🔒）标记——加密目录未登录直接可见标识。
  - 管理员登录：隐藏项**全部显示**且带 `hidden`/`locked` 标记；**管理员免密**（handleList/handleLink/handleDownload/handleSearch 的密码门禁在管理员请求时跳过，登录后访问隐藏/加密目录无需密码）。
- **列表列布局重排（按用户指定）**：`☐(全选) | 链接 | 下载 | 名称(自适应) | ⋯操作 | 大小 | 修改时间`——复制链接/下载做成**每行常驻按钮列**（靠左，文件行），删除表头批量条；全选仍在勾选列表头；网格模式保留底部浮动批量条。
- **ZIP 树形折叠**：压缩包内容按路径构建目录树，目录默认折叠（▸ 点击展开 ▾），避免大量文件平铺；顶层文件直接显示。zip64 大包支持上轮已加。
- **验证**：`node --check` + `tsc --noEmit` 零错误。
