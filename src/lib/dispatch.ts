import type { Driver, Env, Mount } from '../types';
import { getMounts, findMount } from '../config';
import { getDriver } from '../drivers/registry';

export interface Dispatched {
  driver: Driver;
  rest: string;       // 盘内相对路径
  mount: Mount;
  mountPath: string;  // 如 /s3
}

/**
 * 按路径前缀派发到具体驱动实例（多盘核心：请求 -> 匹配的挂载点 -> 对应驱动类）。
 * 每次请求新建驱动实例并 init（stateless，无副作用）。
 */
export async function dispatch(env: Env, path: string): Promise<Dispatched> {
  const mounts = getMounts(env);
  const fm = findMount(mounts, path);
  if (!fm) throw new HttpError(404, 'mount not found');
  const driver = getDriver(fm.mount.driver);
  if (!driver) throw new HttpError(500, `driver ${fm.mount.driver} not registered`);
  driver.init(fm.mount, env);
  return { driver, rest: fm.rest, mount: fm.mount, mountPath: fm.mount.mount };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
