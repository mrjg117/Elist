import { Hono } from 'hono';
import type { Env } from './types';
import { registerDriver } from './drivers/registry';
import { S3Driver } from './drivers/s3';
import { OneDriveDriver } from './drivers/onedrive';
import { handleList, handleDownload, handleSearch } from './routes/fs';
import { webdavHandler } from './routes/webdav';
import { HttpError } from './lib/dispatch';

// 注册驱动：网盘与 S3 只是表里的两项，无任何特判。
// 一个 OneDriveDriver 类同时服务 e5 / personal（靠账号 JSON 里的 type 分流）。
registerDriver('s3', S3Driver);
registerDriver('onedrive-e5', OneDriveDriver);
registerDriver('onedrive-personal', OneDriveDriver);

const app = new Hono<{ Bindings: Env }>();

// 公用配置（标题、排序等），供前端读取
app.get('/api/config', (c) => {
  return c.json({
    title: c.env.SITE_TITLE || 'edge-multidrive',
    sort: c.env.SORT || 'name_asc',
  });
});

app.get('/api/list', handleList);
app.get('/api/download', handleDownload);
app.get('/api/search', handleSearch);
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

export default app;
