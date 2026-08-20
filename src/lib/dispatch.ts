import type { Driver, Env, Mount } from '../types';
import { getMounts, findMount } from '../config';
import { getDriverClass } from '../drivers/registry';

export interface Dispatched {
  driver: Driver;
  rest: string;       // 盘内相对路径
  mount: Mount;
  mountPath: string;  // 如 /s3
}

// 驱动实例缓存：按挂载点路径缓存，避免重复创建和初始化
const driverCache = new Map<string, Driver>();

/**
 * 按路径前缀派发到具体驱动实例（多盘核心：请求 -> 匹配的挂载点 -> 对应驱动类）。
 * 使用缓存复用驱动实例，减少重复初始化开销。
 */
export async function dispatch(env: Env, path: string): Promise<Dispatched> {
  const mounts = getMounts(env);
  const fm = findMount(mounts, path);
  if (!fm) throw new HttpError(404, 'mount not found');

  const cacheKey = fm.mount.mount;
  let driver = driverCache.get(cacheKey);

  if (!driver) {
    const DriverClass = getDriverClass(fm.mount.driver);
    if (!DriverClass) throw new HttpError(500, `driver ${fm.mount.driver} not registered`);
    driver = new DriverClass();
    driver.init(fm.mount, env);
    driverCache.set(cacheKey, driver);
  }

  return { driver, rest: fm.rest, mount: fm.mount, mountPath: fm.mount.mount };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
