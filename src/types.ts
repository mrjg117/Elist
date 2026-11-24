/**
 * 全局类型定义。
 *
 * 配置架构（v4，变量拆分）：
 *   - AUTH_<NAME>：账号机密（type、凭据等）
 *   - MOUNT_<NAME>：挂载配置（单对象 / 数组 / {users:[...]} 三种写法等价）
 *   - 配置表 .elist.xlsx 为明文（便于 Excel/WPS 编辑后稳定读回）
 *   - 变量名后缀匹配：MOUNT_ZHU 自动关联 AUTH_ZHU
 *   - 一份 AUTH 可挂多个 user：MOUNT 里写数组，每个 user 一个 user_id + mounts
 *   - 配置文件身份：多 user 时取第一个非 sharepoint 的 user
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
  locked?: boolean;   // 该目录是否设了访问密码（加密文件夹）
  hidden?: boolean;   // 该条目是否被配置为隐藏（仅管理员可见）
}

/** 挂载点（目录）。 */
export interface MountPoint {
  path: string;       // URL 前缀，如 /photos
  root: string;       // 账号内相对路径，如 /Photos；'/' 表示账号根
  title?: string;     // 展示名（可选）
  cache?: string;     // 覆盖全局 CACHE_CONTROL（可选）
}

/** 账号机密（AUTH_<NAME> 的值）：type + 凭据字段。 */
export interface AuthAccount {
  type: string;       // onedrive | s3 | (未来扩展)
  // —— 各类型鉴权字段（宽松，避免每加一种就改类型）——
  tenant_id?: string;
  client_id?: string;
  cert_thumbprint?: string;  // 必填：x5t（证书指纹的 base64url），原样填入 JWT header
  cert_key?: string;            // 证书私钥 PEM
  endpoint?: string;          // S3
  region?: string;            // S3
  bucket?: string;            // S3
  access_key_id?: string;     // S3
  secret_access_key?: string; // S3
}

/** 单个用户的挂载配置。 */
export interface UserMount {
  user_id?: string;   // OneDrive 用户 UPN/objectId；'sharepoint' = 挂 SP 根站点；S3 可省
  mounts: MountPoint[];
}

/**
 * 挂载配置（MOUNT_<NAME> 的值）。三种写法等价，config.ts 统一归一为数组：
 *   1. 单用户对象：{ user_id, mounts }
 *   2. 用户数组：[{ user_id, mounts }, { user_id, mounts }]   ← 多用户推荐，无需 users 包装
 *   3. users 包装：{ users: [{ user_id, mounts }, ...] }      ← 兼容旧格式
 */
export type MountConfig = UserMount | UserMount[] | { users: UserMount[] };

/**
 * dispatch 用的展开挂载项（配置解析阶段由 AUTH_XXX + MOUNT_XXX 配对展开得到）。
 * 每个目录 = 一个 Mount，内含其所属账号的全部鉴权字段（addition）。
 */
export interface Mount {
  mount: string;      // URL 前缀（已规范化，带前导 /）
  root: string;       // 账号内路径（已规范化）
  driver: string;     // = account.type（驱动注册名）
  title?: string;
  cache?: string;     // 覆盖全局缓存
  user_id?: string;   // OneDrive UPN/objectId；'sharepoint' = SP 哨兵
  tenant?: string;    // AUTH_<NAME> 后缀名，同一租户共用一种侧栏图标颜色
  addition: Record<string, any>; // 该账号鉴权字段
}

export interface Driver {
  /** 初始化（注入 mount 配置与 env）。可异步。 */
  init(mount: Mount, env: Env): Promise<void> | void;
  /** 列出某路径下一层（单目录，不递归）。rest = 盘内相对路径（带前导 /）。 */
  list(path: string): Promise<Entry[]>;
  /** 取下载直链（302 目标）。 */
  link(path: string): Promise<string>;
  /** 读取文件文本内容。不存在返回 null。 */
  readText(path: string): Promise<string | null>;
  /** 读取文件二进制内容（用于 .elist.xlsx 配置）。不存在返回 null。 */
  readBinary(path: string): Promise<ArrayBuffer | null>;
  /** 写入文件二进制内容（用于保存 .elist.xlsx 配置）。 */
  writeBinary(path: string, content: ArrayBuffer): Promise<void>;
  
  // 文件管理方法（可选，部分存储可能不支持）
  /** 写入文本文件（用于编辑文本文件）。 */
  writeText?(path: string, content: string): Promise<void>;
  /** 移动/重命名文件或目录（源路径 -> 目标路径）。 */
  move?(sourcePath: string, targetPath: string): Promise<void>;
  /** 删除文件或目录。 */
  delete?(path: string): Promise<void>;
  /** 创建目录。 */
  mkdir?(path: string): Promise<void>;
}

export interface Env {
  SITE_TITLE?: string;     // 公用：站点标题
  CACHE_CONTROL?: string;  // 公用：下载缓存控制
  MOUNT_ORDER?: string;    // 公用：根目录盘顺序，逗号分隔（如 /od,/s3）
  S3_LINK_TTL?: string;    // 公用：S3 下载直链有效期（秒）
  CONFIG_AUTH?: string;    // 配置文件存储账号名（对应 AUTH_<NAME>）
  CONFIG_PATH?: string;    // 配置文件存储路径（存储内相对路径，如 / 或 /config）
  CONF_PW?: string;        // 旧加密 .elist.xlsx 的读取密码（新表为明文，仅用于兼容旧表）
  [key: string]: any;      // 其余为 AUTH_<NAME> 等凭据（经 secret 注入）
}
