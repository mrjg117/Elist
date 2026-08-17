/**
 * 全局类型定义。
 *
 * 配置架构（v3，用户方案）：
 *   - 每个账号 = 一个环境变量 AUTH_<NAME>，值为 JSON：
 *       { type, ...凭据字段..., mounts: [ {path, root, title?, cache?}, ... ] }
 *   - 凭据只在账号 JSON 里写一次；一个账号可挂 N 个目录（mounts）。
 *   - 公用变量（SITE_TITLE / CACHE_CONTROL）单独全局，不走账号变量。
 *
 * 设计要点：所有存储后端（S3 / OneDrive / 未来 GDrive）实现同一 Driver 接口，
 * 对上层完全等价 -> 多盘 = 数据（配置）不是代码。
 */

export interface Entry {
  name: string;       // 文件名或目录名
  path: string;       // 挂载内绝对路径，如 /photos/2024/a.jpg
  isDir: boolean;
  size?: number;
  modified?: string; // ISO 时间字符串
  mime?: string;
}

/** 账号 JSON 内的单个挂载点（目录）。 */
export interface MountPoint {
  path: string;       // URL 前缀，如 /photos
  root: string;       // 账号内相对路径，如 /Photos；'/' 表示账号根
  title?: string;     // 展示名（可选）
  cache?: string;     // 覆盖全局 CACHE_CONTROL（可选）
}

/** 一个账号的环境变量 JSON（AUTH_<NAME> 的值）。 */
export interface AuthAccount {
  type: string;       // onedrive-e5 | onedrive-personal | s3 | (未来扩展)
  // —— 各类型鉴权字段（宽松，避免每加一种就改类型）——
  tenant_id?: string;
  client_id?: string;
  cert_thumbprint?: string;
  cert_key?: string;          // E5 证书私钥 PEM
  refresh_token?: string;     // 个人版
  client_secret?: string;     // 个人版可选
  endpoint?: string;          // S3
  region?: string;            // S3
  bucket?: string;            // S3
  access_key_id?: string;     // S3
  secret_access_key?: string; // S3
  mounts: MountPoint[];
}

/**
 * dispatch 用的展开挂载项（配置解析阶段由 AuthAccount.mounts 展开得到）。
 * 每个目录 = 一个 Mount，内含其所属账号的全部鉴权字段（addition）。
 */
export interface Mount {
  mount: string;      // URL 前缀（已规范化，带前导 /）
  root: string;       // 账号内路径（已规范化）
  driver: string;     // = account.type（驱动注册名）
  title?: string;
  cache?: string;     // 覆盖全局缓存
  addition: Record<string, any>; // 该账号鉴权字段（不含 mounts）
}

export interface Driver {
  /** 初始化（注入 mount 配置与 env）。可异步。 */
  init(mount: Mount, env: Env): Promise<void> | void;
  /** 列出某路径下一层（单目录，不递归）。rest = 盘内相对路径（带前导 /）。 */
  list(path: string): Promise<Entry[]>;
  /** 取下载直链（302 目标）。 */
  link(path: string): Promise<string>;
  /** 读取文件文本内容（用于 .passwd/.hidden 标记文件解析）。不存在返回 null。 */
  readText(path: string): Promise<string | null>;
  /** 递归收集某路径下全部条目（供搜索建索引用）。 */
  walk(path: string): Promise<Entry[]>;
}

export interface Env {
  ADMIN_PUBKEY?: string;   // 管理端验签公钥
  SITE_TITLE?: string;     // 公用：站点标题
  CACHE_CONTROL?: string;  // 公用：下载缓存控制
  [key: string]: any;      // 其余为 AUTH_<NAME> 等凭据（经 secret 注入）
}
