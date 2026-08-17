import type { Driver } from '../types';

/**
 * 驱动注册表：网盘与 S3 只是表里的两项，无任何特判。
 * 加新盘类型 = 写一个类 + registerDriver 一下，零代码侵入。
 */

const registry = new Map<string, new () => Driver>();

export function registerDriver(name: string, ctor: new () => Driver): void {
  registry.set(name, ctor);
}

export function getDriver(name: string): Driver | null {
  const ctor = registry.get(name);
  if (!ctor) return null;
  return new ctor();
}

// 内置驱动（与 s3.ts / onedrive.ts 配套，在 index 启动时注册）
export const DRIVERS = ['s3', 'onedrive'] as const;
