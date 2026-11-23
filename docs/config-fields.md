# 配置字段速查

三类变量，均为 `env` 上的字符串：

- `AUTH_<NAME>`：账号凭据（JSON 字符串）
- `MOUNT_<NAME>`：挂载配置（JSON 字符串）
- 公用变量：明文字符串

`AUTH_OD1` 与 `MOUNT_OD1` 后缀必须一致才能配对。示例中 `//` 注释仅作说明，实际填写时删掉（JSON 不支持注释）。

---

## `AUTH_<NAME>`

`type` 选驱动：`onedrive` / `s3`。缺失则账号被跳过。

### onedrive

```jsonc
{
  "type": "onedrive",
  "tenant_id": "<GUID>",        // 必填。Azure 租户 ID
  "client_id": "<应用ID>",       // 必填。Azure 应用 ID
  "cert_thumbprint": "<x5t>",   // 必填。证书指纹的 base64url，原样填入 JWT header
  "cert_key": "-----BEGIN..."   // 必填。证书私钥 PEM
}
```

**指纹格式**：Azure 门户显示的是 40 位 HEX（`84E0...5534`），JWT 要的是它的 base64url（`hOBc...TQ`）。照抄 HEX 会报 `AADSTS700027`。转换：HEX 每两位转一字节 → base64url → 去尾部 `=`。代码不做任何转换，填什么用什么。

同一份 AUTH 可供 OneDrive 和 SharePoint 挂载共用（SP 不额外读任何凭据字段）。

### s3

```jsonc
{
  "type": "s3",
  "endpoint": "https://<id>.r2.cloudflarestorage.com", // 必填。S3 兼容端点
  "region": "auto",            // 必填。区域，R2 填 auto
  "bucket": "<bucket>",        // 必填。桶名
  "access_key_id": "<ak>",     // 必填。AK
  "secret_access_key": "<sk>"  // 必填。SK
}
```

---

## `MOUNT_<NAME>`

```jsonc
{
  "user_id": "alice@org.com",  // OneDrive 必填（UPN 或 objectId）；S3 可省；填 "sharepoint" = 挂 SP 根站点
  "mounts": [                  // 必填
    {
      "path": "/alice",        // 实质必填。URL 前缀，决定外网路径；不写会撞根
      "root": "/",             // 可省，默认 /。盘内起始目录
      "title": "Alice 的网盘",  // 可省，默认显示 path
      "cache": "public, max-age=3600" // 可省。覆盖全局 CACHE_CONTROL
    }
  ]
}
```

SharePoint 只挂根站点 + 默认文档库，`user_id` 写 `"sharepoint"` 即可，无需站点 ID / 库 ID / host：

```jsonc
{
  "user_id": "sharepoint",
  "mounts": [{ "path": "/sp", "title": "SharePoint" }]
}
```

---

## 公用变量

写在 `wrangler.toml [vars]` 或 Dashboard。

| 变量 | 作用 |
|---|---|
| `SITE_TITLE` | 站点标题 |
| `CACHE_CONTROL` | 全局下载缓存头；被 `mounts[].cache` 按盘覆盖 |
| `MOUNT_ORDER` | 根目录盘顺序，逗号分隔，如 `/od,/s3` |
| `S3_LINK_TTL` | S3 下载直链有效期（秒） |
| `CONFIG_AUTH` | 存 `.elist.xlsx` 用哪个账号（对应后缀，支持 `:first-onedrive`/`:first-s3`）|
| `CONFIG_PATH` | 配置文件路径（盘内相对路径，如 `/` 或 `/config`）|
| `CONF_PW` | `.elist.xlsx` 加密密码 |

---

## 易错点

1. `AUTH_XXX` 和 `MOUNT_XXX` 后缀必须一致，否则配对失败、盘全部消失。
2. `cert_thumbprint` 填 base64url，不是门户的 HEX。
3. OneDrive 挂载缺 `user_id` 会鉴权失败；SP 挂载填 `"sharepoint"` 即可。
