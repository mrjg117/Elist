import { sha256Hex } from './crypto';

/**
 * 文件夹级访问控制：密码 + 隐藏。
 * 标记文件随数据走（存储内），零 KV/D1/SQL：
 *   <dir>/.passwd   -> 该目录的访问密码 SHA-256（hex 小写）
 *   <dir>/.hidden   -> 每行一个待隐藏条目的名称
 *
 * readText: 由具体驱动提供（读取存储内文件文本），不存在返回 null。
 */

export type ReadText = (path: string) => Promise<string | null>;

/** 校验目录密码：输入明文，与 .passwd 中 sha256(明文) 比较。 */
export async function checkFolderPassword(
  dirPath: string,
  providedPlain: string | undefined,
  readText: ReadText
): Promise<boolean> {
  const content = await readText(joinPath(dirPath, '.passwd'));
  if (content === null) return true; // 无密码文件 = 公开
  if (!providedPlain) return false;
  const hash = await sha256Hex(providedPlain);
  return hash.toLowerCase() === content.trim().toLowerCase();
}

/** 某条目是否应被隐藏（在父目录的 .hidden 清单中）。 */
export async function isHidden(
  parentDir: string,
  entryName: string,
  readText: ReadText
): Promise<boolean> {
  const content = await readText(joinPath(parentDir, '.hidden'));
  if (content === null) return false;
  const set = new Set(
    content
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
  readText: ReadText
): Promise<T[]> {
  const results = await Promise.all(
    entries.map(async (e) => ({
      e,
      hidden: await isHidden(parentDir, e.name, readText),
    }))
  );
  return results.filter((r) => !r.hidden).map((r) => r.e);
}

function joinPath(dir: string, file: string): string {
  if (dir.endsWith('/')) return dir + file;
  return dir + '/' + file;
}
