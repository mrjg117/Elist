/**
 * E5 续期调度器。
 *
 * 简化自 e5rnl/worker.js，单次函数调用内按账号分配预算。
 * 续期账号：尽量跑满分配的预算。
 * 非续期账号：只跑 list 刷缓存。
 */

import { ALL_ACTIONS, REQUIRED_SCOPES, type ActionDef } from './actions';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface RenewalConfig {
  tenant_id: string;
  client_id: string;
  user_id: string;
  cert_pem?: string;
  cert_key?: string;
  app_secret?: string;
  e5rnl?: boolean; // 是否需要续期
}

export interface RenewalOptions {
  maxApiCalls?: number;
  maxRuntimeMs?: number;
  concurrency?: number;
  actionDelayMinMs?: number;
  actionDelayMaxMs?: number;
}

/** 全局共享 API 调用计数器，用于跨账号硬限制 */
export class GlobalApiCounter {
  private _count = 0;
  private _limit: number;

  constructor(limit: number) {
    this._limit = limit;
  }

  get count(): number {
    return this._count;
  }

  get remaining(): number {
    return Math.max(0, this._limit - this._count);
  }

  /** 尝试增加计数，成功返回 true，达到上限返回 false */
  tryIncrement(): boolean {
    if (this._count >= this._limit) return false;
    this._count++;
    return true;
  }
}

export interface RenewalResult {
  action: string;
  ok: boolean;
  msg?: string;
  error?: string;
  skipped?: boolean;
  readonly: boolean;
  /** 因 403 权限不足导致失败时，标注所缺 Graph 权限（便于管理员定位） */
  requiresPermission?: string;
}

/**
 * 为单个账号执行续期或刷缓存。
 * @param budget 该账号的 API 调用预算
 * @param globalCounter 全局 API 调用计数器（可选）
 */
export async function runRenewalForAccount(
  config: RenewalConfig,
  getToken: () => Promise<string>,
  budget: number,
  options: RenewalOptions = {},
  globalCounter?: GlobalApiCounter
): Promise<RenewalResult[]> {
  const maxRuntimeMs = options.maxRuntimeMs ?? 25000;
  const concurrency = options.concurrency ?? 6;
  const delayMin = options.actionDelayMinMs ?? 0;
  const delayMax = options.actionDelayMaxMs ?? 300;

  const startTime = Date.now();
  const results: RenewalResult[] = [];
  let apiCalls = 0;

  // 构建 Graph API 调用函数
  const graphCall = async (method: string, path: string, body?: any, absolute?: boolean) => {
    // 检查全局计数器（如果提供）
    if (globalCounter && !globalCounter.tryIncrement()) {
      const err = new Error('Global API call limit reached');
      (err as any).code = 'BUDGET';
      throw err;
    }
    // 检查账号级预算
    if (apiCalls >= budget) {
      const err = new Error('API call limit reached');
      (err as any).code = 'BUDGET';
      throw err;
    }
    apiCalls++;

    const token = await getToken();
    const url = absolute ? `${GRAPH}${path}` : `${GRAPH}/users/${encodeURIComponent(config.user_id)}${path}`;
    
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    let payload: string | undefined;
    if (body !== undefined) {
      if (typeof body === 'string') {
        headers['Content-Type'] = 'text/plain';
        payload = body;
      } else {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    }

    const res = await fetch(url, { method, headers, body: payload });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }

    if (method === 'DELETE' || res.status === 204) return null;
    
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  };

  // 随机抽取动作（去重，避免连续重复）
  const pickActions = (count: number): ActionDef[] => {
    const picked: ActionDef[] = [];
    const used = new Set<number>();
    const maxCount = Math.min(count, ALL_ACTIONS.length);
    
    for (let i = 0; i < maxCount; i++) {
      let idx: number;
      let attempts = 0;
      do {
        idx = Math.floor(Math.random() * ALL_ACTIONS.length);
        attempts++;
      } while (used.has(idx) && attempts < ALL_ACTIONS.length);
      
      if (!used.has(idx)) {
        used.add(idx);
        picked.push(ALL_ACTIONS[idx]);
      }
    }
    return picked;
  };

  // 执行单个动作
  const executeAction = async (action: ActionDef): Promise<RenewalResult> => {
    try {
      const msg = await action.fn(graphCall);
      if (msg === null) {
        return { action: action.name, ok: false, skipped: true, readonly: action.readonly };
      }
      return { action: action.name, ok: true, msg, readonly: action.readonly };
    } catch (err: any) {
      if (err.code === 'BUDGET') {
        return { action: action.name, ok: false, skipped: true, error: 'budget', readonly: action.readonly };
      }
      if (action.allow404 && /-> 404:/.test(err.message)) {
        return { action: action.name, ok: true, msg: '无数据(404)', readonly: action.readonly };
      }
      // 403 权限不足：归类标注所缺 Graph 权限，而非笼统失败
      if (/-> 403:/.test(err.message) || /InsufficientPrivileges/i.test(err.message) || /Access is denied/i.test(err.message)) {
        const scope = REQUIRED_SCOPES[action.name] || '（见 Microsoft Graph 应用权限文档）';
        return { action: action.name, ok: false, error: `缺少权限: ${scope}`, requiresPermission: scope, readonly: action.readonly };
      }
      return { action: action.name, ok: false, error: err.message, readonly: action.readonly };
    }
  };

  // 保证至少执行一个 list 操作（刷缓存）
  const listAction = ALL_ACTIONS.find(a => a.name === 'drive_root') || ALL_ACTIONS[0];
  const listResult = await executeAction(listAction);
  results.push(listResult);

  // 如果不需要续期，只跑 list 就结束
  if (!config.e5rnl) {
    return results;
  }

  // 续期账号：尽量跑满预算（确保至少为1，避免负数预算导致无法执行）
  const effectiveBudget = Math.max(1, budget);
  while (apiCalls < effectiveBudget && Date.now() - startTime < maxRuntimeMs) {
    const remaining = effectiveBudget - apiCalls;
    const batchSize = Math.min(concurrency, remaining);
    if (batchSize <= 0) break;

    const batch = pickActions(batchSize);
    const batchResults = await Promise.all(batch.map(executeAction));
    results.push(...batchResults);

    // 延迟
    if (delayMin > 0 || delayMax > 0) {
      const delay = delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return results;
}

/**
 * 为多个 OneDrive 账号执行续期。
 * 按续期需求分配预算：
 * - 续期账号：平均分配剩余预算
 * - 非续期账号：只分配 1-2 次调用（刷缓存）
 *
 * 所有账号并发执行，提高效率。
 */
export async function runRenewalForAccounts(
  accounts: RenewalConfig[],
  getToken: (config: RenewalConfig) => Promise<string>,
  options: RenewalOptions = {}
): Promise<Map<string, RenewalResult[]>> {
  const totalBudget = options.maxApiCalls ?? 48;
  const resultsMap = new Map<string, RenewalResult[]>();

  // 创建全局 API 计数器
  const globalCounter = new GlobalApiCounter(totalBudget);

  // 统计续期账号数
  const renewalAccounts = accounts.filter(a => a.e5rnl);
  const cacheOnlyAccounts = accounts.filter(a => !a.e5rnl);

  // 分配预算
  const cacheBudgetPerAccount = 1; // 非续期账号分配 1 次调用（list）
  const totalCacheBudget = cacheOnlyAccounts.length * cacheBudgetPerAccount;
  const renewalBudget = totalBudget - totalCacheBudget;
  const budgetPerRenewalAccount = renewalAccounts.length > 0
    ? Math.floor(renewalBudget / renewalAccounts.length)
    : 0;

  console.log(`[E5RNL] 总预算 ${totalBudget}，续期账号 ${renewalAccounts.length} 个（每个 ${budgetPerRenewalAccount}），非续期账号 ${cacheOnlyAccounts.length} 个（每个 ${cacheBudgetPerAccount}）`);

  // 并发执行所有账号
  const accountPromises = accounts.map(async (account) => {
    const key = `${account.tenant_id}:${account.user_id}`;
    const budget = account.e5rnl ? budgetPerRenewalAccount : cacheBudgetPerAccount;

    try {
      const results = await runRenewalForAccount(account, () => getToken(account), budget, options, globalCounter);

      const ok = results.filter(r => r.ok && !r.skipped).length;
      const total = results.filter(r => !r.skipped).length;
      console.log(`[E5RNL] 账号 ${key} ${account.e5rnl ? '续期' : '刷缓存'}完成：${ok}/${total} 成功，预算 ${budget}`);

      return { key, results };
    } catch (err: any) {
      console.error(`[E5RNL] 账号 ${key} 失败：`, err);
      return {
        key,
        results: [{
          action: 'renewal',
          ok: false,
          error: err.message,
          readonly: false,
        }],
      };
    }
  });

  // 等待所有账号完成
  const allResults = await Promise.all(accountPromises);

  // 收集结果
  for (const { key, results } of allResults) {
    resultsMap.set(key, results);
  }

  return resultsMap;
}
