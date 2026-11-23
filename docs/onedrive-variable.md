# OneDrive / SharePoint 账号配置（v4 变量拆分）

凭据和挂载分离到两个变量，后缀必须匹配：`AUTH_ZHU` ↔ `MOUNT_ZHU`。

- `AUTH_<NAME>`：凭据 JSON（建议 Secret）
- `MOUNT_<NAME>`：挂载 JSON（明文即可）

---

## AUTH_<NAME>

OneDrive 和 SharePoint 共用同一份凭据（同一租户的应用）：

```json
{
  "type": "onedrive",
  "tenant_id": "AAAA0000-1111-2222-3333-444455556666",
  "client_id": "BBBB1111-2222-3333-4444-555566667777",
  "cert_thumbprint": "hOBcHZi846VCHSJbFAs26Go9VTQ",
  "cert_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----"
}
```

| 字段 | 必填 | 含义 | 获取方式 |
|------|:---:|------|--------|
| `type` | 是 | 固定 `"onedrive"`（SP 也用这个值） | — |
| `tenant_id` | 是 | 租户 ID（GUID） | Entra ID → Overview → Tenant ID |
| `client_id` | 是 | 应用 ID | Entra ID → App registrations |
| `cert_thumbprint` | 是 | 证书指纹的 base64url（x5t） | 见下方「证书指纹」|
| `cert_key` | 是 | 证书私钥 PEM | 生成证书时保留 |

> 私钥换行用 `\n` 转义，不能直接换行。

### 证书指纹

Azure 门户显示 40 位 HEX（如 `7D0E...7524`），JWT 的 `x5t` 要 base64url（如 `e07...WVI`）。**代码不转换，填什么用什么，必须自己转成 base64url**：HEX 每两位转一字节 → base64url → 去尾部 `=`。照抄 HEX 会报 `AADSTS700027 key was not found`。

---

## MOUNT_<NAME>

OneDrive（挂某用户的盘）：

```json
{
  "user_id": "zhangsan@yourorg.onmicrosoft.com",
  "mounts": [
    { "path": "/od", "root": "/", "title": "我的网盘" }
  ]
}
```

SharePoint（挂根站点 + 默认文档库，`user_id` 写 `"sharepoint"`）：

```json
{
  "user_id": "sharepoint",
  "mounts": [
    { "path": "/sp", "root": "/", "title": "SharePoint" }
  ]
}
```

| 字段 | 必填 | 含义 |
|------|:---:|------|
| `user_id` | OD 必填 | 用户 UPN 或 objectId；SP 填 `"sharepoint"`；S3 可省 |
| `mounts` | 是 | 挂载点数组 |
| `mounts[].path` | 是 | URL 前缀，如 `/od`、`/sp` |
| `mounts[].root` | 否 | 盘内起始目录，默认 `/` |
| `mounts[].title` | 否 | 界面显示的盘名 |
| `mounts[].cache` | 否 | 覆盖全局 CACHE_CONTROL |

同一应用可挂多个用户：`MOUNT_<NAME>` 直接写数组，多个 user 共用一份 AUTH，无需 `users` 包装：

```json
[
  { "user_id": "zhangsan@yourorg.onmicrosoft.com", "mounts": [{ "path": "/od", "root": "/", "title": "我的网盘" }] },
  { "user_id": "lisi@yourorg.onmicrosoft.com",     "mounts": [{ "path": "/sp", "root": "/", "title": "SharePoint" }] }
]
```

第二个用户 `user_id` 填 `"sharepoint"` 就是挂根站点默认库，可与 OD 用户共存同一数组。也兼容旧写法 `{"users":[...]}` 和单用户对象。配置表 `.elist.xlsx` 存到第一个非 sharepoint 用户的盘里。

---

## 配置步骤

**Dashboard**：Workers & Pages → 服务 → Settings → Variables。添加 `AUTH_ZHU`（Secret）和 `MOUNT_ZHU`（Plaintext）。

**CLI**：

```bash
wrangler secret put AUTH_ZHU   # 粘贴凭据 JSON
# MOUNT_ZHU 写在 wrangler.toml [vars] 或 Dashboard
```

---

## 权限配置

Entra ID → App registrations → 你的应用 → API permissions → Add a permission → Microsoft Graph → **Application permissions**：

- `Files.ReadWrite.All`（OneDrive 读写）
- `Sites.ReadWrite.All`（SharePoint，如需挂 SP）
- `User.Read.All`（读取用户信息）

添加后点 "Grant admin consent"。

---

## 常见问题

**盘不显示**：检查 `AUTH_*`/`MOUNT_*` 后缀是否匹配、JSON 格式（尤其 `\n` 转义）、Worker 日志解析错误。

**403 权限错误**：确认权限已加、已 Grant admin consent、等待几分钟生效。

**证书过期**：Azure 生成新证书 → 更新 `AUTH_<NAME>` 的 `cert_thumbprint` 和 `cert_key` → 重新部署。

**点进目录弹"请输入密码"（实为配置加载失败）**：`MOUNT_<NAME>` 缺 `user_id` 时，OneDrive app-only 鉴权抛 `requires user_id`，`.elist.xlsx` 加载中断，前端把 403 误判为密码门禁。用 `wrangler tail` 看日志确认，补上 `user_id`。

---

## 密码和隐藏配置

通过存储根目录的 `.elist.xlsx` 管理（首次加载自动创建空白文件），`CONF_PW` 可选用于加密。详见 [README](../README.md#配置文件elistxlsx)。
