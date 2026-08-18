# OneDrive 账号变量模板（AUTH_*）

> 用途：复制下面 JSON → 只改内容 → 粘进 Cloudflare 变量（Secret）→ 部署即挂载。
> 变量名任意：`AUTH_<随便写>`，例如 `AUTH_ONEDRIVE`、`AUTH_MAIN`。一个变量 = 一个 OneDrive 账号（可挂多个目录）。

---

## 1. 复制即用的模板

```json
{
  "type": "onedrive",
  "tenant_id": "AAAA0000-1111-2222-3333-444455556666",
  "client_id": "BBBB1111-2222-3333-4444-555566667777",
  "cert_thumbprint": "Xl4sR1pQl3mQx2vY8nZaBcDeFgHiJkLmNoPqRsTuVw",
  "cert_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n...（整段私钥，换行写成 \n）...\n-----END PRIVATE KEY-----",
  "user_id": "zhangsan@yourorg.onmicrosoft.com",
  "mounts": [
    { "path": "/od", "root": "/", "title": "我的网盘" }
  ]
}
```

> 注意：`cert_key` 里每一行结尾要写成 JSON 转义的 `\n`（反斜杠+n），不要真的换行粘贴多行私钥，否则 JSON 解析会挂。

---

## 2. 字段说明

| 字段 | 必填 | 含义 | 去哪拿 |
|------|:---:|------|--------|
| `type` | ✅ | 固定 `"onedrive"` | — |
| `tenant_id` | ✅ | 组织租户 ID（GUID） | Entra ID → Overview → **Tenant ID** |
| `client_id` | ✅ | 应用注册的 Application (client) ID | Entra ID → App registrations → 你的应用 → **Application (client) ID** |
| `cert_thumbprint` | ✅ | 证书指纹的 **base64url** 形式（JWT `x5t` 头直用） | 见下方"⚠️ 指纹格式" |
| `cert_key` | ✅ | **私钥** PEM（不是公钥证书） | 生成证书时保留的私钥文件 |
| `user_id` | ✅ | 访问**哪个用户**的盘：UPN 全串（`xxx@租户.onmicrosoft.com`）或 objectId GUID | 租户用户列表 / Graph `GET /users` |
| `mounts` | ✅ | 挂载点数组（可多个） | — |

### mounts[] 每项

| 字段 | 必填 | 含义 |
|------|:---:|------|
| `path` | ✅ | URL 前缀，如 `/od`、`/photos`（访问入口） |
| `root` | 否 | 盘内起始目录，默认 `/`（账号根） |
| `title` | 否 | 界面上显示的盘名 |
| `cache` | 否 | 覆盖全局 CACHE_CONTROL（如 `"public, max-age=600"`） |
| `hide` | 否 | `true` = 根目录列表隐藏（硬路径仍可访问） |
| `sort` | 否 | 本盘默认排序（如 `"time_desc"`） |

### 一个应用挂多目录 / 多用户
- **多目录**：`mounts` 数组里加一项即可（凭据不重复写）。
- **多用户**（同一租户）：复制整份变量，改 `user_id` + `mounts` 的 `path`，另起一个 `AUTH_xxx` 名字。一个应用注册 + 管理员授予的 `Files.Read.All`（Application 权限）覆盖整个租户所有用户，所以凭据可复用，只换 `user_id`。

---

## 3. 怎么加进 Cloudflare

方式一（推荐，Git 集成场景）：
1. Dashboard → Workers → 你的 `Elist` → **Settings → Variables and Secrets**
2. **Add → Secret**：名称 `AUTH_ONEDRIVE`，值 = 上面改好的整段 JSON
3. 部署会自动带上；无 Git 集成就手动 `wrangler deploy` 一次

方式二（命令行）：
```bash
echo '{"type":"onedrive",...}' | wrangler secret put AUTH_ONEDRIVE
```

---

## 4. ⚠️ 指纹格式（最容易填错）

`cert_thumbprint` 直接进 JWT 的 `x5t` 头，必须是 **证书 SHA-1 指纹字节的 base64url 编码**，不是门户里常见的十六进制（如 `AB:CD:EF:...`）。

手里只有十六进制指纹时，在 WSL/Linux 转换：

```bash
openssl x509 -in yourcert.pem -outform der | openssl dgst -sha1 -binary | base64 | tr '+/' '-_' | tr -d '='
```

输出即 `cert_thumbprint` 的值。

---

## 5. 其他坑

- **解析失败静默跳过**：变量 JSON 写错（含私钥真换行）时，该账号**不报错、盘直接不出现**。改了变量后记得点「刷新」或重开页面验证。
- **个人版不支持**：outlook.com 等个人 Microsoft 账户不能走证书 app-only，必须组织/教育/开发者租户。
- **权限没授权**：应用需被管理员授予 Graph **Application 权限** `Files.Read.All`（或 `Files.ReadWrite.All`）并 **Grant admin consent**，否则 Graph 403。
- **证书 ≠ token**：证书 10 年内可随时换 access token（client_credentials 无 refresh_token、无续期操作）；到期只需在 Azure 换新证书并更新 `cert_thumbprint` + `cert_key`。
