# Elist

边缘函数部署的**只读多盘网盘聚合工具**。把对象存储（S3 兼容：S3 / R2 / OSS / COS / MinIO）与 OneDrive（组织租户证书鉴权）两类"盘"聚合成一个统一的浏览界面，下载走 **302 直链**（浏览器原生多线程、不耗边缘 CPU）。

同时集成 **E5 订阅续期**功能，通过 Cron 触发器定期调用 Microsoft Graph API，保持 E5 账号活跃。

---

## 功能特性

- **多盘聚合**：一个账号可挂 N 个目录，多个账号并行。盘 = 配置数据，不是代码。
- **两类存储后端**：
  - `onedrive`：组织租户 Azure 证书凭据（RS256 JWT 自签），无 refresh_token、免 2 年失效。
  - `s3`：S3 / R2 / OSS / COS / MinIO，手写 AWS SigV4，不引 aws-sdk。
- **302 直链下载**：浏览器直接从源站拉文件，边缘不搬字节、天然支持 Range 多线程。
- **只读 WebDAV**：`/dav` 路径下提供 `OPTIONS / PROPFIND / GET / HEAD`，可对接播放器或只读挂载工具。
- **配置集中化（.elist.xlsx）**：密码、隐藏目录等配置统一存放在存储根目录的 `.elist.xlsx` 文件中，支持在线编辑、可加密。
- **管理员登录**：网页端登录后可通过界面配置各目录的密码和显隐，无需手动编辑文件。
- **文件夹密码门禁**：支持级联鉴权，密码经请求头传递、不进 URL。
- **隐藏目录**：通过配置或 `.hidden` 文件隐藏目录（仅界面隐藏，硬路径仍可访问）。
- **URL 路由**：支持直接访问 `/path/to/file`，SPA 路由无缝跳转。
- **左侧导航树**：可折叠的目录树，快速跳转。
- **视图切换**：列表视图 / 网格视图，支持图片缩略图懒加载。
- **文件预览增强**：
  - 图片：缩放、旋转、EXIF 信息（登录后显示）、二维码分享
  - 视频/音频：直接播放、全屏
  - PDF / Office 文档：iframe 预览
  - Markdown：渲染 + 原始文本切换
  - 代码文件：语法高亮（20+ 语言）
  - JSON / YAML / XML：格式化 + 折叠
  - CSV/TSV：表格展示（虚拟滚动）
  - ZIP 压缩包：目录浏览 + 单文件预览/下载
  - 字体文件：字形预览
- **文件分享**：复制链接、二维码分享。
- **被动缓存搜索**：只在用户已浏览过的目录里匹配，绝不主动全量扫描。
- **E5 订阅续期**：Cron 触发，随机抽取 API 动作执行，多账号预算分配。
- **存储 0 依赖**：不使用 KV / D1 / SQL；状态 = env(secret) + 存储内 `.elist.xlsx`。

---

## 架构

```
请求 /s3/photos/2024/a.jpg
   -> Workers 边缘调度（findMount 最长前缀匹配）
   -> 对应驱动实例（S3 / OneDrive）
   -> list / link(302)
   -> 目录列表惰性缓存进 per-isolate 内存 Map（TTL，零 KV）
   -> 前端 SPA（Workers Assets 边缘托管）

Cron 触发（每 10 分钟）
   -> 提取 OneDrive 账号
   -> 按预算分配 API 调用
   -> 续期账号跑满预算，非续期账号只刷缓存
```

---

## 快速部署

```bash
# 1. 安装依赖
npm install

# 2. 注入账号配置（变量拆分方案）
wrangler secret put AUTH_OD1      # 账号机密
wrangler secret put MOUNT_OD1     # 挂载配置

# 3. 部署
npm run deploy
```

---

## 配置说明（v4，变量拆分）

### 变量拆分原则

- `AUTH_<NAME>`：账号机密（type、凭据等敏感信息）
- `MOUNT_<NAME>`：挂载配置（users 数组，非敏感）
- 变量名后缀自动关联：`MOUNT_ZHU` 自动关联 `AUTH_ZHU`

### AUTH_<NAME> - 账号机密

**OneDrive 示例：**

```json
{
  "type": "onedrive",
  "tenant_id": "<租户GUID>",
  "client_id": "<应用ID>",
  "cert_pem": "-----BEGIN CERTIFICATE-----\n<公钥证书 PEM>\n-----END CERTIFICATE-----",
  "cert_key": "-----BEGIN PRIVATE KEY-----\n<私钥 PEM>\n-----END PRIVATE KEY-----"
}
```

**S3 示例：**

```json
{
  "type": "s3",
  "endpoint": "https://<id>.r2.cloudflarestorage.com",
  "region": "auto",
  "bucket": "<bucket>",
  "access_key_id": "<ak>",
  "secret_access_key": "<sk>"
}
```

### MOUNT_<NAME> - 挂载配置

```json
{
  "users": [
    {
      "user_id": "user@org.com",
      "mounts": [
        { "path": "/od1", "root": "/", "title": "我的网盘", "sort": "time_desc" },
        { "path": "/od1/photos", "root": "/Photos", "title": "照片", "hide": false, "e5rnl": true }
      ]
    }
  ]
}
```

**挂载项字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | string | URL 前缀，如 `/od1` |
| `root` | string | 账号内相对路径，`/` 表示账号根 |
| `title` | string | 展示名（可选） |
| `cache` | string | 覆盖全局 CACHE_CONTROL（可选） |
| `hide` | boolean | 仅界面隐藏，硬路径仍可访问（可选） |
| `sort` | string | 本盘列表排序，覆盖全局 SORT（可选） |
| `e5rnl` | boolean | 是否启用 E5 续期（可选，默认 false） |

### 公用变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SITE_TITLE` | 站点标题 | `Elist` |
| `CACHE_CONTROL` | 下载 302 的 Cache-Control | `public, max-age=300` |
| `SORT` | 默认列表排序 | `name_asc` |
| `MOUNT_ORDER` | 根目录盘顺序，逗号分隔（如 `/od1,/s3`） | 配置顺序 |
| `S3_LINK_TTL` | S3 下载直链有效期（秒） | `3600` |
| `ADMIN_PASSWORD` | 管理员登录密码 | 无（必填才能使用管理功能） |

### 排序取值

`name_asc` | `name_desc` | `time_asc` | `time_desc` | `size_asc` | `size_desc` | `type_asc` | `type_desc`

优先级：`?sort=` 查询 > 挂载 `sort` > `SORT` > `name_asc`。文件夹永远排前。

---

## 配置文件（.elist.xlsx）

密码和隐藏配置集中存放在 `.elist.xlsx` 文件中，支持在线编辑。

### 存放位置

通过环境变量控制：

| 变量 | 说明 | 示例 |
|------|------|------|
| `CONFIG_AUTH` | 指定存储账号 | `OD1` / `:first-onedrive` / `:first-s3` |
| `CONFIG_PATH` | 存储内路径 | `/config`（默认 `/`） |

**特殊值：**
- `:first-onedrive`：自动选择第一个 OneDrive 存储
- `:first-s3`：自动选择第一个 S3 存储
- 不配置：使用第一个存储账号

**加载逻辑：** 首次访问时遍历所有存储账号，在 `CONFIG_PATH` 路径下查找 `.elist.xlsx`，找到第一个即加载。

**保存逻辑：** 根据 `CONFIG_AUTH` 写入指定位置。

### xlsx 结构

| Sheet | 列 | 说明 |
|-------|-----|------|
| passwords | path, password, hint | 目录密码配置 |
| hidden | path | 隐藏目录列表 |
| config | key, value | 全局配置（如登录密码） |

---

## 管理员功能

### 登录

设置 `ADMIN_PASSWORD` 环境变量后，网页端右上角出现登录按钮。登录后可以：

- 配置各目录的密码和提示
- 设置目录隐藏状态
- 保存配置到 `.elist.xlsx`

### 图片 EXIF

登录后预览图片时，自动显示 EXIF 信息（相机、时间、GPS 等）。

---

## E5 订阅续期

### 启用方式

在挂载配置中设置 `e5rnl: true`：

```json
{
  "path": "/od1",
  "root": "/",
  "e5rnl": true
}
```

### 工作原理

- Cron 触发器每 10 分钟执行一次
- 按 `E5RNL_RUN_PROBABILITY` 概率决定是否执行（制造时间波动）
- 提取所有 OneDrive 账号，去重
- 预算分配：
  - 续期账号（`e5rnl: true`）：平均分配剩余预算，尽量跑满
  - 非续期账号：只分配 2 次调用（list 刷缓存）
- 随机抽取 API 动作（可重复），包括读写操作

### 续期配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `E5RNL_RUN_PROBABILITY` | 每次触发执行续期的概率（0-1） | `0.5` |
| `E5RNL_MAX_API_CALLS` | 每轮最多 API 调用次数 | `48` |
| `E5RNL_MAX_RUNTIME_MS` | 每轮最大运行时间（毫秒） | `25000` |
| `E5RNL_CONCURRENCY` | 并发批次大小 | `6` |
| `E5RNL_ACTION_DELAY_MIN_MS` | 动作间最小延迟（毫秒） | `0` |
| `E5RNL_ACTION_DELAY_MAX_MS` | 动作间最大延迟（毫秒） | `300` |

---

## 文件预览

所有预览库按需加载（CDN），首次访问时才下载，首屏 0KB。

| 类型 | 支持格式 | 功能 |
|------|----------|------|
| 图片 | png/jpg/gif/webp/avif/bmp/svg | 缩放、旋转、全屏、EXIF（登录后）、二维码分享 |
| 视频 | mp4/webm/mov/mkv/m4v | 播放、全屏、复制链接 |
| 音频 | mp3/wav/ogg/m4a | 播放、复制链接 |
| PDF | pdf | iframe 预览、全屏 |
| Office | docx/xlsx/pptx/doc/xls/ppt | 微软 Office Online Viewer |
| Markdown | md | 渲染 + 原始文本切换 |
| 代码 | js/ts/py/java/c/cpp/css/html/sql/go/rs/rb/php/sh 等 | 语法高亮 |
| JSON | json | 格式化 + 折叠 |
| CSV/TSV | csv/tsv | 表格展示（虚拟滚动，前 100 行） |
| YAML | yaml/yml | 解析显示 |
| XML | xml | 格式化 |
| ZIP | zip | 目录浏览 + 单文件预览/下载 |
| 字体 | ttf/otf/woff/woff2 | 字形预览 |

---

## WebDAV

只读 WebDAV 挂在 `/dav` 下（`OPTIONS / PROPFIND / GET / HEAD`），可对接支持 WebDAV 的播放器或只读挂载。写操作返回 `405`。

门禁与网页端一致：受 `.passwd` 保护的路径同样要求密码，密码经 `X-Folder-Password` 请求头传递。

> 多数 WebDAV 客户端不支持自定义请求头。需用支持自定义 Header 的客户端，例如 `rclone`：
> `rclone lsf remote:/secret --header "X-Folder-Password: 你的密码"`

---

## 平台支持

- **Cloudflare Workers**：原生支持，是本项目最贴合的平台。
- **阿里云 ESA**：支持前端托管与 Git 集成，但边缘函数层没有用户自定义 env vars，迁移成本较高。

---

## 已知限制

- 只读：不支持上传/删除。
- 文件夹密码是访问门禁，不是文件字节加密。
- OneDrive 仅支持组织租户证书鉴权（app-only），个人消费版 Microsoft 账户不适用。
- S3 当前为 path-style 寻址。
- 缓存是 per-isolate 内存，不跨实例。冷启动的实例缓存为空，前几次访问仍需回源。

---

## 开发

```bash
npm install
npm run dev          # 本地开发（wrangler dev）
npm run build        # tsc 类型检查
npm run deploy       # 部署
```

### 目录结构

```
src/
  index.ts            Hono 入口（路由 + 驱动注册 + scheduled handler）
  types.ts            类型定义
  config.ts           AUTH_*/MOUNT_* 解析 + 根目录盘列表
  drivers/            s3 / onedrive / registry
  lib/                acl / cache / crypto / dispatch / xlsx-config / xml
  routes/             fs(列表/下载/搜索/直链) / admin(登录/配置) / webdav
  e5rnl/              actions(40个API动作) / scheduler(调度器) / index(入口)
  web/                前端 SPA（index.html + app.js）
```
