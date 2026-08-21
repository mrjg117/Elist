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

> 注：上述 webdav.ts 类型修复、fs.ts user_id 修复、fs.ts 自动创建 .elist.xlsx 修复，均已随本轮一并 commit 并 `git push` 至 `origin/master`；CF 侧已重新 `wrangler deploy` 上线。
