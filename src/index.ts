import { Hono } from 'hono';
import type { Env } from './types';
import { registerDriver } from './drivers/registry';
import { S3Driver } from './drivers/s3';
import { OneDriveDriver } from './drivers/onedrive';
import { handleList, handleSearch, handleRaw, handleConfigSave, handleConfigClear } from './routes/fs';
import { handleLogin, handleLogout, handleGetConfig, handleSetConfig, handleSaveConfig, handleConfigStatus, handleE5rnlTest } from './routes/admin';
import { webdavHandler } from './routes/webdav';
import { HttpError } from './lib/dispatch';
import { handleScheduled } from './e5rnl';
import fileManagementApp from './routes/file-management';

// 注册驱动：网盘与 S3 只是表里的两项，无任何特判。
// onedrive = 组织租户证书 app-only（全球版）；s3 = S3 兼容（R2/OSS/COS/MinIO 靠 endpoint 区分）。
registerDriver('s3', S3Driver);
registerDriver('onedrive', OneDriveDriver);

const app = new Hono<{ Bindings: Env }>();

// 公用配置（标题、排序等），供前端读取
app.get('/api/config', (c) => {
  return c.json({
    title: c.env.SITE_TITLE || 'Elist',
  });
});

app.get('/api/list', handleList);
app.get('/api/raw', handleRaw);
app.get('/api/raw/:name', handleRaw);
app.get('/api/search', handleSearch);
app.post('/api/config/save', async (c) => {
  // 需要管理员鉴权
  const { requireAdmin } = await import('./lib/auth');
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  return handleConfigSave(c);
});
app.post('/api/config/clear', async (c) => {
  // 需要管理员鉴权
  const { requireAdmin } = await import('./lib/auth');
  const adminError = await requireAdmin(c);
  if (adminError) return adminError;
  return handleConfigClear(c);
});

// 管理员API
app.post('/api/admin/login', handleLogin);
app.post('/api/admin/logout', handleLogout);
app.get('/api/admin/config', handleGetConfig);
app.post('/api/admin/config', handleSetConfig);
app.post('/api/admin/save', handleSaveConfig);
app.get('/api/admin/status', handleConfigStatus);
app.post('/api/admin/e5rnl-test', handleE5rnlTest);

// 文件管理API（需要管理员权限）
app.route('/api/file', fileManagementApp);

app.all('/dav', webdavHandler);
app.all('/dav/', webdavHandler);
app.all('/dav/*', webdavHandler);

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status as any);
  }
  console.error('[error]', err);
  return c.json({ error: 'internal_error' }, 500);
});

// SPA 兜底：未命中任何 API/DAV 路由时，由 Workers Assets 提供静态前端（含 index.html 与 SPA 回落）。
// 配合 wrangler.toml 的 run_worker_first = true，保证 /api/raw/<文件名> 这类带扩展名路径也先经 Worker，
// 不会被静态资源层误判为静态文件而返回 index.html（点击复制链接跳主页的根因）。
// 健壮性增强：ASSETS 绑定异常/未注入时不再抛 500 导致整站崩溃，降级返回内联首页（index_html text_blobs），
// 保证"起不来"的最坏情况变为"可显示首页"而非白屏 500。线上 ASSETS 正常时始终走 ASSETS，零影响。
app.get('*', async (c) => {
  const assets = (c.env as any).ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    try {
      const r = await assets.fetch(c.req.raw);
      if (r) return r;
    } catch { /* 落入下方兜底 */ }
  }
  const html = (c.env as any).index_html;
  return c.html(
    html ?? '<!doctype html><meta charset="utf-8"><title>Elist</title><h1>站点资源暂不可用</h1><p>静态资源加载异常，请检查部署或稍后重试。</p>',
    200,
  );
});

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(handleScheduled(env));
  },
};
