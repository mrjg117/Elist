/**
 * E5 续期入口。
 *
 * 集成到 Elist 的 Cron 触发，复用 OneDrive 账号配置。
 * 每个 OneDrive 账号独立执行一轮续期，保证每个账号至少有个 list 操作（刷缓存）。
 */

import type { Env, Mount } from '../types';
import { getMounts } from '../config';
import { runRenewal, type RenewalConfig, type RenewalResult } from './scheduler';

/**
 * 从 Elist 的 Mount 配置提取 OneDrive 账号信息。
 * 去重（同一 tenant_id + user_id 只保留一个）。
 */
function extractOneDriveAccounts(mounts: Mount[]): RenewalConfig[] {
  const seen = new Set<string>();
  const accounts: RenewalConfig[] = [];

  for (const mount of mounts) {
    if (mount.driver !== 'onedrive') continue;

    const key = `${mount.addition.tenant_id}:${mount.user_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    accounts.push({
      tenant_id: mount.addition.tenant_id,
      client_id: mount.addition.client_id,
      user_id: mount.user_id || '',
      cert_pem: mount.addition.cert_pem,
      cert_key: mount.addition.cert_key,
      app_secret: mount.addition.app_secret,
    });
  }

  return accounts;
}

/**
 * 执行 E5 续期（Cron 触发时调用）。
 * 按 RUN_PROBABILITY 概率跳过（制造时间波动）。
 */
export async function handleScheduled(env: Env): Promise<void> {
  // 按概率跳过
  const rate = Number(env.E5RNL_RUN_PROBABILITY ?? 0.5);
  if (Math.random() > rate) {
    console.log(`[E5RNL] 按 RUN_PROBABILITY=${rate} 整轮跳过`);
    return;
  }

  // 解析配置
  const mounts = getMounts(env);
  const accounts = extractOneDriveAccounts(mounts);

  if (accounts.length === 0) {
    console.log('[E5RNL] 没有 OneDrive 账号，跳过续期');
    return;
  }

  console.log(`[E5RNL] 开始续期，共 ${accounts.length} 个 OneDrive 账号`);

  // 从 env 读取调度参数
  const options = {
    maxApiCalls: Number(env.E5RNL_MAX_API_CALLS ?? 48),
    maxRuntimeMs: Number(env.E5RNL_MAX_RUNTIME_MS ?? 25000),
    concurrency: Number(env.E5RNL_CONCURRENCY ?? 6),
    actionDelayMinMs: Number(env.E5RNL_ACTION_DELAY_MIN_MS ?? 0),
    actionDelayMaxMs: Number(env.E5RNL_ACTION_DELAY_MAX_MS ?? 300),
  };

  // 为每个账号执行续期
  for (const account of accounts) {
    const key = `${account.tenant_id}:${account.user_id}`;
    console.log(`[E5RNL] 开始账号 ${key}`);

    try {
      // 获取 token 的函数（复用 OneDriveDriver 的逻辑）
      const getToken = async () => {
        // 这里需要调用 OneDriveDriver 的 getToken 方法
        // 但 OneDriveDriver 是实例方法，我们需要创建一个临时实例
        // 简化方案：直接在这里实现 token 获取逻辑（和 OneDriveDriver 重复，但可接受）
        return await getOneDriveToken(account);
      };

      const results = await runRenewal(account, getToken, options);
      
      const ok = results.filter(r => r.ok && !r.skipped).length;
      const total = results.filter(r => !r.skipped).length;
      const skipped = results.filter(r => r.skipped).length;
      
      console.log(`[E5RNL] 账号 ${key} 完成：${ok}/${total} 成功，${skipped} 跳过`);
      
      if (ok < total) {
        const failed = results.filter(r => !r.ok && !r.skipped);
        console.warn(`[E5RNL] 账号 ${key} 有 ${failed.length} 个失败：`, failed.map(r => r.error));
      }
    } catch (err: any) {
      console.error(`[E5RNL] 账号 ${key} 失败：`, err);
    }
  }

  console.log('[E5RNL] 续期完成');
}

/**
 * 获取 OneDrive token（复用 OneDriveDriver 的逻辑）。
 * 这里简化实现，直接调用 Microsoft Graph API。
 */
async function getOneDriveToken(account: RenewalConfig): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(account.tenant_id)}/oauth2/v2.0/token`;
  
  const body = new URLSearchParams({
    client_id: account.client_id,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  if (account.cert_pem && account.cert_key) {
    // 证书鉴权
    const { importRsaPrivateKey, signRs256, uuid, b64urlFromString, certX5t } = await import('../lib/crypto');
    
    const thumbprint = await certX5t(account.cert_pem);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', x5t: thumbprint };
    const payload = {
      aud: tokenUrl,
      iss: account.client_id,
      sub: account.client_id,
      jti: uuid(),
      nbf: now - 30,
      exp: now + 600,
      iat: now,
    };
    
    const privKey = await importRsaPrivateKey(account.cert_key);
    const input = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(payload))}`;
    const sig = await signRs256(privKey, input);
    const jwt = `${input}.${sig}`;
    
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    body.set('client_assertion', jwt);
  } else if (account.app_secret) {
    // 客户端密码鉴权
    body.set('client_secret', account.app_secret);
  } else {
    throw new Error('缺少凭据：需设置 cert_pem+cert_key（证书）或 app_secret（客户端密码）');
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`获取 token 失败：${res.status} ${await res.text()}`);
  }

  const data = await res.json() as any;
  return data.access_token;
}
