import { sha256Hex, verifyTotp } from './crypto';

/**
 * 文件夹级 / 挂载级 访问门禁：密码 + 隐藏。
 * 标记文件随数据走（存储内），零 KV/D1/SQL：
 *   <dir>/.passwd   -> 该目录的访问门禁 verifier（见下方格式）
 *   <dir>/.hidden   -> 每行一个待隐藏条目名称
 *
 * verifier 格式（.passwd 文件内容 / 挂载级 passwd 字段 同此）：
 *   sha256:<hex>         固定密码：hex = sha256(用户所输密码)
 *   <hex>                兼容旧版：整行即 sha256(密码) hex
 *   dyn:<base>           动态(按天)：期望值 = sha256(base + YYYYMMDD)，用户输 base+YYYYMMDD
 *   dynn:<base>          动态(按小时)：期望值 = sha256(base + YYYYMMDDHH)
 *   totp:<base32>        TOTP 门禁：用户输 6 位动态码（配合固定密码做二因素）
 * readText: 由具体驱动提供（读取存储内文件文本），不存在返回 null。
 */

export type ReadText = (path: string) => Promise<string | null>;

/** 当前日期分量（服务端时区）。 */
function ymd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
function ymdh(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}`;
}

/**
 * 校验一个 verifier 与用户提供密码是否匹配。
 * verifier 为空/空白 = 无门禁（公开）。
 * provided 为空且存在门禁 = 拒绝。
 */
export async function verifyPassword(
  verifier: string | undefined,
  provided: string | undefined
): Promise<boolean> {
  if (!verifier || !verifier.trim()) return true; // 无门禁
  if (!provided) return false;
  const line = verifier.split('\n').map((l) => l.trim()).find(Boolean) || '';
  if (!line) return true;

  if (line.startsWith('sha256:')) {
    return (await sha256Hex(provided)).toLowerCase() === line.slice(7).toLowerCase();
  }
  if (line.startsWith('dyn:')) {
    const exp = (await sha256Hex(line.slice(4) + ymd())).toLowerCase();
    return (await sha256Hex(provided)).toLowerCase() === exp;
  }
  if (line.startsWith('dynn:')) {
    const exp = (await sha256Hex(line.slice(5) + ymdh())).toLowerCase();
    return (await sha256Hex(provided)).toLowerCase() === exp;
  }
  if (line.startsWith('totp:')) {
    return verifyTotp(line.slice(5), provided.trim());
  }
  // 旧版兼容：整行作为 sha256(密码) hex
  return (await sha256Hex(provided)).toLowerCase() === verifier.trim().toLowerCase();
}

/** 校验目录密码（读该目录的 .passwd）。无 .passwd 视为公开。 */
export async function checkFolderPassword(
  dirPath: string,
  providedPlain: string | undefined,
  readText: ReadText
): Promise<boolean> {
  const content = await readText(joinPath(dirPath, '.passwd'));
  return verifyPassword(content ?? undefined, providedPlain);
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

/** 标记文件本身不应出现在列表里。 */
export const MARKER_FILES = new Set(['.passwd', '.hidden', '.crypt']);
