import { Hono } from 'hono';
import type { Env } from './types';
import { registerDriver } from './drivers/registry';
import { S3Driver } from './drivers/s3';
import { OneDriveDriver } from './drivers/onedrive';
import { handleList, handleDownload, handleSearch, handleLink, handleConfigSave, handleConfigClear } from './routes/fs';
import { handleLogin, handleLogout, handleGetConfig, handleSetConfig, handleSaveConfig } from './routes/admin';
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
app.get('/api/link', handleLink);
app.get('/api/download', handleDownload);
app.get('/api/search', handleSearch);
app.post('/api/config/save', async (c) => {
  // 需要管理员鉴权
  const adminPassword = c.req.header('X-Admin-Password');
  if (!adminPassword) {
    return c.json({ error: '需要管理员密码' }, 401);
  }
  const expectedPassword = (await import('./lib/xlsx-config')).getConfig('admin_password');
  if (!expectedPassword || expectedPassword !== adminPassword) {
    return c.json({ error: '管理员密码错误' }, 403);
  }
  return handleConfigSave(c);
});
app.post('/api/config/clear', async (c) => {
  // 需要管理员鉴权
  const adminPassword = c.req.header('X-Admin-Password');
  if (!adminPassword) {
    return c.json({ error: '需要管理员密码' }, 401);
  }
  const expectedPassword = (await import('./lib/xlsx-config')).getConfig('admin_password');
  if (!expectedPassword || expectedPassword !== adminPassword) {
    return c.json({ error: '管理员密码错误' }, 403);
  }
  return handleConfigClear(c);
});

// 管理员API
app.post('/api/admin/login', handleLogin);
app.post('/api/admin/logout', handleLogout);
app.get('/api/admin/config', handleGetConfig);
app.post('/api/admin/config', handleSetConfig);
app.post('/api/admin/save', handleSaveConfig);

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

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(handleScheduled(env));
  },
};
