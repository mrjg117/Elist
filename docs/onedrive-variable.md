# OneDrive 账号配置指南（v4 变量拆分方案）

> 用途：配置 OneDrive 账号挂载到 Elist。v4 方案将凭据和挂载配置分离到两个变量中。

---

## 1. 变量结构

v4 方案需要配置两个变量：

- `AUTH_<NAME>`：账号凭据（Secret）
- `MOUNT_<NAME>`：挂载配置（Variables）

变量名后缀必须匹配，例如 `AUTH_ZHU` 对应 `MOUNT_ZHU`。

---

## 2. AUTH_<NAME> 配置

### 示例

```json
{
  "type": "onedrive",
  "tenant_id": "AAAA0000-1111-2222-3333-444455556666",
  "client_id": "BBBB1111-2222-3333-4444-555566667777",
  "cert_pem": "-----BEGIN CERTIFICATE-----\nMIIE...（整段证书，换行用 \n）...\n-----END CERTIFICATE-----",
  "cert_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----"
}
```

### 字段说明

| 字段 | 必填 | 含义 | 获取方式 |
|------|:---:|------|--------|
| `type` | ✅ | 固定 `"onedrive"` | — |
| `tenant_id` | ✅ | 组织租户 ID（GUID） | Entra ID → Overview → Tenant ID |
| `client_id` | ✅ | 应用 ID | Entra ID → App registrations → Application (client) ID |
| `cert_pem` | ✅ | 公钥证书 PEM | 生成证书时保留 |
| `cert_key` | ✅ | 私钥 PEM | 生成证书时保留 |

> 注意：证书内容中的换行需要用 `\n` 转义，不能直接换行。

---

## 3. MOUNT_<NAME> 配置

### 示例

```json
{
  "users": [
    {
      "user_id": "zhangsan@yourorg.onmicrosoft.com",
      "mounts": [
        {
          "path": "/od",
          "root": "/",
          "title": "我的网盘",
          "e5rnl": true
        }
      ]
    }
  ]
}
```

### users[] 字段

| 字段 | 必填 | 含义 |
|------|:---:|------|
| `user_id` | ✅ | 用户 UPN（如 `user@org.com`）或 objectId |

### mounts[] 字段

| 字段 | 必填 | 含义 |
|------|:---:|------|
| `path` | ✅ | URL 前缀，如 `/od`、`/photos` |
| `root` | 否 | 盘内起始目录，默认 `/` |
| `title` | 否 | 界面显示的盘名 |
| `cache` | 否 | 覆盖全局 CACHE_CONTROL |
| `e5rnl` | 否 | 是否启用 E5 续期（默认 false） |

---

## 4. 多用户配置

同一应用可以挂载多个用户的 OneDrive：

```json
{
  "users": [
    {
      "user_id": "user1@org.com",
      "mounts": [
        { "path": "/od1", "root": "/", "title": "用户1的网盘" }
      ]
    },
    {
      "user_id": "user2@org.com",
      "mounts": [
        { "path": "/od2", "root": "/", "title": "用户2的网盘" }
      ]
    }
  ]
}
```

---

## 5. 配置步骤

### 方式一：Cloudflare Dashboard

1. 进入 Workers & Pages → 你的 Elist 服务
2. Settings → Variables
3. 添加变量：
   - `AUTH_ZHU`：类型 Secret，值为凭据 JSON
   - `MOUNT_ZHU`：类型 Plaintext，值为挂载配置 JSON

### 方式二：Wrangler CLI

```bash
# 配置凭据（Secret）
wrangler secret put AUTH_ZHU
# 粘贴 JSON

# 配置挂载（Variables，在 wrangler.toml 或 Dashboard 设置）
```

---

## 6. 权限配置

应用需要以下 Microsoft Graph 权限：

- `Files.Read.All`（读取文件）
- `Files.ReadWrite.All`（读写文件，如需上传/编辑功能）
- `User.Read.All`（读取用户信息）

配置步骤：
1. Entra ID → App registrations → 你的应用
2. API permissions → Add a permission → Microsoft Graph
3. 选择 Application permissions（不是 Delegated）
4. 添加上述权限
5. 点击 "Grant admin consent"

---

## 7. 证书指纹

Azure 门户显示的证书指纹（如 `7D0EB3709B555837A7C533D87B74EA47A9277524`）仅供查看，**不需要手动配置**。

系统会自动从 `cert_pem` 计算 SHA-1 指纹并转换为 base64url 格式，用于 JWT 的 `x5t` 头。

---

## 8. 常见问题

### 盘不显示

- 检查变量名后缀是否匹配（`AUTH_ZHU` 对应 `MOUNT_ZHU`）
- 检查 JSON 格式是否正确（特别是证书中的 `\n` 转义）
- 查看 Worker 日志是否有解析错误

### 403 权限错误

- 确认已添加 Graph API 权限
- 确认已点击 "Grant admin consent"
- 等待几分钟让权限生效

### 证书过期

证书有效期通常为 1-2 年，过期后：
1. 在 Azure 生成新证书
2. 更新 `AUTH_<NAME>` 中的 `cert_pem` 和 `cert_key`
3. 重新部署

### 点进目录弹“请输入密码”框（实则不是密码问题）

现象：首页能看到盘（如 `/zh33`、`/admin`），但点进去后前端弹出密码输入框，输入任何密码都无效。

根因：`.elist.xlsx` 配置文件加载失败，程序按“加载失败即拒绝一切访问”的安全策略返回 403，前端把这个 403 误当成“目录需要密码”来弹窗。**这不是你设了密码，而是配置没加载成功。**

最常见诱因：`MOUNT_<NAME>` 变量里缺少 `users[].user_id`，或加载配置时没把 `user_id` 传给驱动。OneDrive app-only 鉴权强制要求 `user_id`（UPN 或 objectId），缺失时驱动初始化直接抛 `onedrive app-only requires user_id (UPN or objectId)`，导致加载中断。

排查：用 `wrangler tail` 看 Worker 日志，若出现 `Failed to load config from account: <NAME> Error: onedrive app-only requires user_id ...` 即命中本问题。确认 `MOUNT_<NAME>` 的 `users[]` 里已填 `user_id`。

---

## 9. 密码和隐藏配置

目录密码和隐藏配置不再通过变量设置，而是通过 `.elist.xlsx` 配置文件管理：

1. 首次加载时，若存储根目录（默认 `/`，可由 `CONFIG_PATH` 覆盖）不存在 `.elist.xlsx`，系统**会自动创建**一个空白配置文件（已配置 `CONF_PW` 则自动加密），无需手动创建。手动创建时则为：在存储根目录创建 `.elist.xlsx`
2. 配置 `CONF_PW` 环境变量（可选，用于加密配置文件）
3. 通过管理界面或直接编辑 xlsx 文件配置密码和隐藏

详见 [README 配置说明](../README.md#配置文件elistxlsx)。
