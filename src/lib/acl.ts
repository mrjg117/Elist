export type ReadText = (path: string) => Promise<string | null>;

import { getAcl, setAcl } from './cache';

/**
 * 文件夹级访问门禁：仅基于存储内 .passwd 明文文件。零密码学、零 KV/D1/SQL。
 *
 *   <dir>/.passwd   -> 该目录访问密码（每行一个明文；多行=多把钥匙，便于轮换/过渡）
 *   <dir>/.hidden   -> 每行一个待隐藏条目名称
 *
 * 门禁语义：访问某路径时，其自身及所有祖先目录的 .passwd 都需满足（级联）。
 * 路径上每个存在 .passwd 的目录，都必须被"客户端已知密码集合"中至少一个命中，
 * 否则拒绝 —— 因此子文件夹若有自己的 .passwd，进入时必须重新输入该层密码（重新鉴权）。
 * 若子层 .passwd 也包含上层密码，则上层密码已满足两层，无需重复输入。
 * .passwd 不存在/为空 = 该层公开。
 *
 * readText 约定：传入"完整展示路径"（如 /s3/photos/secret），由调用方负责把
 * 完整路径换算成盘内相对路径(rest) 再交给具体驱动。
 */

/**
 * 校验完整路径的访问权限：沿路径逐级检查 .passwd（级联）。
 * provided 为客户端已知密码集合（可多个，分别来自不同层级的 .passwd 解锁）。
 * 路径上每个存在 .passwd 的目录，都必须被 provided 中至少一个密码命中，否则拒绝。
 *
 * 语义示例：
 *   /A 有 .passwd=A1，/A/B 有 .passwd=B1
 *   -> 进 /A 需 A1；进 /A/B 需 A1 且 B1（子层重新鉴权，前端会再弹窗要 B1）
 *   -> 若 /A/B 的 .passwd 也含 A1，则 A1 已满足两层，无需重复弹窗
 *
 * readText 接收完整展示路径；provided 取自 X-Folder-Password 头（可重复多个）。
 */
export async function checkPathPassword(
  fullPath: string,
  provided: string[],
  readText: ReadText,
  fresh = false
): Promise<{ ok: boolean; lockedAt?: string }> {
  const segs = fullPath.split('/').filter(Boolean);
  let acc = '';
  for (const s of segs) {
    acc += '/' + s;
    // .passwd 读取走 ACL 缓存；fresh 时强制回源重读（配合前端"刷新"按钮）
    let passwd = fresh ? undefined : getAcl(acc)?.passwd;
    if (passwd === undefined) {
      passwd = await readText(acc + '/.passwd');
      setAcl(acc, { passwd });
    }
    if (passwd === null) continue; // 无 .passwd = 该层公开
    const lines = passwd
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue; // 空文件 = 无门禁
    if (!provided.some((p) => lines.includes(p))) {
      return { ok: false, lockedAt: acc };
    }
  }
  return { ok: true };
}

/** 某条目是否应被隐藏（在父目录的 .hidden 清单中）。 */
export async function isHidden(
  parentDir: string,
  entryName: string,
  readText: ReadText,
  fresh = false
): Promise<boolean> {
  let hidden = fresh ? undefined : getAcl(parentDir)?.hidden;
  if (hidden === undefined) {
    hidden = await readText(parentDir + '/.hidden');
    setAcl(parentDir, { hidden });
  }
  if (hidden === null) return false;
  const set = new Set(
    hidden
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );
  return set.has(entryName);
}

/** 过滤掉隐藏条目，返回完整 Entry[]。 */
export async function filterHidden<T extends { name: string }>(
  parentDir: string,
  entries: T[],
  readText: ReadText,
  fresh = false
): Promise<T[]> {
  const results = await Promise.all(
    entries.map(async (e) => ({
      e,
      hidden: await isHidden(parentDir, e.name, readText, fresh),
    }))
  );
  return results.filter((r) => !r.hidden).map((r) => r.e);
}

/** 标记文件本身不应出现在列表里。 */
export const MARKER_FILES = new Set(['.passwd', '.hidden']);
