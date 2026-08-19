import type { Driver, Mount, Env, Entry } from '../types';

/**
 * 驱动基类：提供 挂载路径 <-> 账号内路径 的换算，以及 readText 的骨架。
 * 具体驱动只需实现 list/link 与 readText 的取数细节。
 *
 * 关键换算（v3）：
 *   rest（盘内相对路径，如 /2024/a.jpg）
 *     -> toAccountPath -> 账号内绝对路径（含 root，如 /Photos/2024/a.jpg）
 *     -> toPath -> 挂载内展示路径（如 /photos/2024/a.jpg）
 */

export abstract class BaseDriver implements Driver {
  protected mountPath = '';   // URL 前缀，如 /photos
  protected root = '/';       // 账号内基准路径，如 /Photos
  protected addition: Record<string, any> = {};

  init(mount: Mount, _env?: Env): void {
    this.mountPath = mount.mount;
    this.root = mount.root || '/';
    this.addition = mount.addition || {};
  }

  /** 盘内相对路径(rest) -> 账号内绝对路径（含 root）。 */
  protected toAccountPath(rest: string): string {
    const r = (this.root === '/' ? '' : this.root) + (rest || '/');
    return r.replace(/\/{2,}/g, '/');
  }

  /** 账号内绝对路径 -> 挂载内展示路径。 */
  protected toPath(accountPath: string): string {
    let rest = accountPath;
    if (this.root !== '/') {
      if (accountPath === this.root) rest = '/';
      else if (accountPath.startsWith(this.root + '/')) rest = accountPath.slice(this.root.length);
      else rest = accountPath; // 兜底：不在 root 下，原样
    }
    const p = (this.mountPath === '/' ? '' : this.mountPath) + (rest || '/');
    return p.replace(/\/{2,}/g, '/');
  }

  abstract list(path: string): Promise<Entry[]>;
  abstract link(path: string): Promise<string>;
  abstract readText(path: string): Promise<string | null>;
  abstract readBinary(path: string): Promise<ArrayBuffer | null>;
  abstract writeBinary(path: string, content: ArrayBuffer): Promise<void>;
}
