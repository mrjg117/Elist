/**
 * E5 续期调度器。
 *
 * 简化自 e5rnl/worker.js，去掉 Queue 分批，直接执行。
 * 支持多账号（每个 OneDrive 账号都跑一轮），保证每账号至少有个 list 操作（刷缓存）。
 */

import { ALL_ACTIONS, type ActionDef } from './actions';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface RenewalConfig {
  tenant_id: string;
  client_id: string;
  user_id: string;
  cert_pem?: string;
  cert_key?: string;
  app_secret?: string;
}

export interface RenewalOptions {
  maxApiCalls?: number;
  maxRuntimeMs?: number;
  concurrency?: number;
  actionDelayMinMs?: number;
  actionDelayMaxMs?: number;
}

export interface RenewalResult {
  action: string;
  ok: boolean;
  msg?: string;
  error?: string;
  skipped?: boolean;
  readonly: boolean;
}

/**
 * 执行一轮续期。
 * 随机抽取 API 动作，可重复抽取，直到达到预算或时间上限。
 * 保证每账号至少执行一个 list 操作（刷缓存）。
 */
export async function runRenewal(
  config: RenewalConfig,
  getToken: () => Promise<string>,
  options: RenewalOptions = {}
): Promise<RenewalResult[]> {
  const maxApiCalls = options.maxApiCalls ?? 48;
  const maxRuntimeMs = options.maxRuntimeMs ?? 25000;
  const concurrency = options.concurrency ?? 6;
  const delayMin = options.actionDelayMinMs ?? 0;
  const delayMax = options.actionDelayMaxMs ?? 300;

  const startTime = Date.now();
  const results: RenewalResult[] = [];
  let apiCalls = 0;

  // 构建 Graph API 调用函数
  const graphCall = async (method: string, path: string, body?: any, absolute?: boolean) => {
    if (apiCalls >= maxApiCalls) {
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

  // 随机抽取动作（可重复）
  const pickActions = (count: number): ActionDef[] => {
    const picked: ActionDef[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * ALL_ACTIONS.length);
      picked.push(ALL_ACTIONS[idx]);
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
      return { action: action.name, ok: false, error: err.message, readonly: action.readonly };
    }
  };

  // 保证至少执行一个 list 操作（刷缓存）
  const listAction = ALL_ACTIONS.find(a => a.name === 'drive_root') || ALL_ACTIONS[0];
  const listResult = await executeAction(listAction);
  results.push(listResult);

  // 批量执行剩余动作
  while (apiCalls < maxApiCalls && Date.now() - startTime < maxRuntimeMs) {
    const batch = pickActions(concurrency);
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
 * 每个账号独立执行一轮，保证每个账号至少有个 list 操作。
 */
export async function runRenewalForAccounts(
  accounts: RenewalConfig[],
  getToken: (config: RenewalConfig) => Promise<string>,
  options: RenewalOptions = {}
): Promise<Map<string, RenewalResult[]>> {
  const resultsMap = new Map<string, RenewalResult[]>();

  for (const account of accounts) {
    const key = `${account.tenant_id}:${account.user_id}`;
    try {
      const results = await runRenewal(account, () => getToken(account), options);
      resultsMap.set(key, results);
    } catch (err: any) {
      console.error(`[E5RNL] Account ${key} failed:`, err);
      resultsMap.set(key, [{
        action: 'renewal',
        ok: false,
        error: err.message,
        readonly: false,
      }]);
    }
  }

  return resultsMap;
}
