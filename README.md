# Elist

边缘函数部署的**只读多盘网盘聚合工具**。把对象存储（S3 / R2 / OSS / COS / MinIO）、OneDrive（E5 证书 / 个人版）等多个"盘"聚合成一个统一的浏览界面，下载走 **302 直链**（浏览器原生多线程、不耗边缘 CPU）。

> 仓库内部代码名为 `edge-multidrive`（Cloudflare Worker 名），产品名叫 **Elist**，一个东西。

---

## 功能特性

- **多盘聚合**：一个账号可挂 N 个目录，多个账号并行。盘 = 配置数据，不是代码。
- **多种存储后端**：
  - `onedrive-e5`：Azure **证书凭据**（RS256 JWT 自签 `client_assertion`），无 refresh_token、免 2 年失效。
  - `onedrive-personal`：delegated `refresh_token`（会过期，技术限制）。
  - `s3`：S3 / R2 / OSS / COS / MinIO，手写 AWS SigV4（头签名 + 预签名 URL），不引 aws-sdk。
- **302 直链下载**：浏览器直接从源站拉文件，边端不搬字节、天然支持 Range 多线程。
- **只读 WebDAV 服务端**：`OPTIONS / PROPFIND / GET / HEAD`，配合支持 WebDAV 的播放器/挂载工具只读浏览。
- **文件夹密码门禁**（随数据走，零 KV/D1/SQL）：
  - 固定密码（`sha256:`）、动态密码（按天 `dyn:` / 按小时 `dynn:`）、TOTP 动态码（`totp:`，建议做二因素）。
  - 挂载级 `passwd` 与文件夹级 `.passwd` 可叠加。
- **隐藏**：
  - 文件夹级：同目录放 `.hidden`，每行一个条目名，从列表消失（路径仍可硬进）。
  - 挂载级：`hide: true` 让该盘不显示在根目录（仅界面隐藏，硬路径仍可访问）。
- **列表排序**：全局 `SORT` + 单盘 `sort` 覆盖 + 前端实时切换；文件夹永远排前。
- **文件搜索**：现搜 + per-isolate 内存索引（S3 flat 扫描 / OneDrive 递归），零 KV。
- **预览**：图片 / 视频 / 音频 / PDF 经 302 直链前端直接预览。
- **存储 0 依赖**：不使用 KV / D1 / SQL；状态 = env(secret) + 存储内标记文件。构建/运行可用 Hono + Vite 等依赖。
- **证书鉴权**：E5 证书模式免失效；管理端可用私钥签名 + 公钥验签（应用层，非 mTLS）。
- **离线下载（可选扩展）**：通过 webhook → GitHub Actions → `rclone copyurl` 把文件推入网盘，绕开边缘时长限制。

---

## 架构

```
请求 /s3/photos/2024/a.jpg
   -> Workers 边缘调度（findMount 最长前缀匹配）
   -> 对应驱动实例（S3 / OneDrive）
   -> list / link(302) / walk(搜索)
   -> 列表/索引缓存进 per-isolate 内存 Map（TTL，零 KV）
   -> 前端 SPA（Workers Assets 边缘托管）
```

- **驱动抽象**：所有后端实现同一 `Driver` 接口（`list` / `link` / `readText` / `walk`）。加新后端 = 注册一个新驱动类，无特判。
- **配置即数据**：多盘完全由配置决定，代码不变。
- **轻量**：Hono + Web Standard API（WinterCG），Cloudflare Workers 与阿里云 ESA 通用。

---

## 快速部署（Cloudflare Workers）

```bash
# 1. 安装
npm install

# 2. 注入每账号配置（每个 AUTH_<NAME> 一个变量，JSON）
wrangler secret put AUTH_ONEDRIVE_ZHU
wrangler secret put AUTH_R2_BACKUP
# ...按下方配置 schema 填

# 3. 公用变量（非敏感，可放 wrangler.toml [vars]）
#    SITE_TITLE / CACHE_CONTROL / SORT / MOUNT_ORDER

# 4. 部署
wrangler deploy
```

Cloudflare 还支持「连接 GitHub 仓库」做 Git 集成：push 即部署（本项目仓库已就绪）。

---

## 配置 Schema（v3）

### 每账号一个变量 `AUTH_<NAME>`

凭据只写一次，其下 `mounts[]` 列出该账号要挂的 N 个目录。

```json
{
  "type": "onedrive-e5",
  "tenant_id": "<租户GUID>",
  "client_id": "<应用ID>",
  "cert_thumbprint": "<证书SHA1指纹>",
  "cert_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "mounts": [
    { "path": "/od", "root": "/", "title": "我的网盘", "sort": "time_desc" },
    { "path": "/od-photos", "root": "/Photos", "title": "照片", "hide": false }
  ]
}
```

各 `type` 必填字段：

| type | 必填 |
|------|------|
| `onedrive-e5` | `tenant_id`, `client_id`, `cert_thumbprint`, `cert_key` |
| `onedrive-personal` | `tenant_id`(填 `common`), `client_id`, `refresh_token`(可选 `client_secret`) |
| `s3` | `endpoint`, `bucket`, `access_key_id`, `secret_access_key`(可选 `region`) |

挂载项可选字段：`title` / `cache`(覆盖 CACHE_CONTROL) / `hide` / `passwd`(挂载级门禁) / `sort`。

### 公用变量（`wrangler.toml` `[vars]` 或 secret）

| 变量 | 作用 | 默认 |
|------|------|------|
| `SITE_TITLE` | 站点标题 | `edge-multidrive` |
| `CACHE_CONTROL` | 下载 302 的 Cache-Control | `public, max-age=300` |
| `SORT` | 默认列表排序 | `name_asc` |
| `MOUNT_ORDER` | 根目录盘顺序，逗号分隔（如 `/od,/s3`） | 配置顺序 |

### 排序取值

`name_asc|name_desc|time_asc|time_desc|size_asc|size_desc|type_asc|type_desc`。优先级：`?sort=` 查询 > 挂载 `sort` > `SORT` > `name_asc`。文件夹永远排前。

---

## 密码与隐藏（随数据走）

在**目标文件夹**内放置标记文件即可，无需改配置：

**`.passwd`**（该文件夹访问门禁）内容（一行）：

```
sha256:abc123...            # 固定密码：hex = sha256(用户所输)
# 或兼容旧版：整行即 sha256(密码) hex
dyn:MyBase                  # 动态(按天)：期望值 = sha256(MyBase + YYYYMMDD)，用户输 MyBase+YYYYMMDD
dynn:MyBase                 # 动态(按小时)：期望值 = sha256(MyBase + YYYYMMDDHH)
totp:JBSWY3DPEHPK3PXP       # TOTP 门禁：用户输 6 位动态码（建议配合固定密码做二因素）
```

**`.hidden`**（该文件夹内要隐藏的条目，每行一个名称）：

```
secret-folder
private-notes.txt
```

- 前端用 `?pw=xxxx` 传密码，并沿路径级联（进入子目录沿用父门禁密码）。
- `hide`（挂载级）仅隐藏根目录入口，硬路径仍可访问。

---

## WebDAV

只读 WebDAV 挂在 `/dav` 下（`OPTIONS` / `PROPFIND` / `GET` / `HEAD`），可对接支持 WebDAV 的播放器或只读挂载。写操作返回 `405`。

---

## 离线下载（可选：GitHub Actions + rclone）

边缘函数不适合做长耗时下载。用 webhook 触发 GitHub Actions，在 runner 上跑 `rclone copyurl` 把文件推入网盘，边缘照常列出：

```
边缘收请求 -> 调 GitHub API 触发 workflow_dispatch
  -> runner 跑 rclone copyurl <源> <onedrive/s3:/path>
  -> 文件入盘，边缘正常列出
```

注意：触发端点必须鉴权；rclone 凭据存 Actions secrets，别进仓库。

---

## 平台支持

- **Cloudflare Workers**：原生支持 `AUTH_*` vars/secrets + Workers Assets + Git 集成，是本项目最贴合的平台。
- **阿里云 ESA**：支持「导入 GitHub 仓库」做前端托管与 Git 集成；但边缘函数层目前**没有** Workers 那种用户自定义 env vars（`EnvConf` 仅指计算规格），配置注入需改走边缘 KV 或内嵌，迁移成本较高。

---

## 已知限制

- 只读：不支持上传/删除（边缘函数做读写受 CPU/时长限制，且违背"302 直链、边缘薄壳"定位）。
- 文件夹密码是**访问门禁**，不是文件字节加密（资源开销仅为一个短字符串哈希/校验，几乎为零）。
- 个人版 OneDrive 的 `refresh_token` 会过期，需重新授权。
- S3 当前为 path-style 寻址；virtual-hosted 后续补。

---

## 开发

```bash
npm install
npm run dev          # 本地开发（wrangler dev）
npm run check        # tsc 类型检查
npm run deploy       # 部署
```

目录结构：

```
src/
  index.ts            Hono 入口（路由 + 驱动注册）
  types.ts            类型定义
  config.ts           AUTH_* 解析 + 根目录盘列表
  drivers/            s3 / onedrive / base / registry
  lib/                acl(门禁/隐藏) / cache(内存) / crypto / dispatch / xml
  routes/             fs(列表/下载/搜索) / webdav
  web/                前端 SPA（index.html + app.js）
```
