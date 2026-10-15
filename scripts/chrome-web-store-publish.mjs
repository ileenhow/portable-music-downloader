import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { manifestFromZip } from './release-artifact.mjs';

export async function run({ args = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch,
  sleep = ms => new Promise(done => setTimeout(done, ms)), logger = console, pollLimit = 60 } = {}) {
  const required = ['CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error('缺少 Chrome Web Store 发布配置：' + missing.join(', '));
  if (!/^[A-Za-z0-9_-]+$/.test(env.CWS_PUBLISHER_ID) || !/^[a-p]{32}$/.test(env.CWS_EXTENSION_ID)) throw new Error('Chrome 商店条目 ID 格式无效。');
  const check = args.includes('--check'), noPublish = args.includes('--no-publish');
  const zipPath = args.find(arg => !arg.startsWith('--'));
  if (!check && !zipPath) throw new Error('请明确指定已验证的 ZIP 路径。');
  const bytes = check ? undefined : await readFile(resolve(zipPath));
  const version = bytes ? manifestFromZip(bytes).version : undefined;
  async function request(url, options = {}) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(60000), ...options });
    let data;
    try { data = await response.json(); } catch { throw new Error(`商店返回非 JSON 响应：HTTP ${response.status}`); }
    if (!response.ok || data.error) throw new Error(`Chrome API 请求失败：${data.error?.message || data.error_description || 'HTTP ' + response.status}`);
    return data;
  }
  const tokenData = await request('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.CWS_CLIENT_ID, client_secret: env.CWS_CLIENT_SECRET,
      refresh_token: env.CWS_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) throw new Error('Chrome OAuth 未返回 access token。');
  const headers = { Authorization: 'Bearer ' + tokenData.access_token };
  const item = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;
  const base = 'https://chromewebstore.googleapis.com/v2/' + item;
  if (check) { await request(base + ':fetchStatus', { headers }); logger.log('Chrome Web Store API 凭证验证成功。'); return; }
  const upload = await request('https://chromewebstore.googleapis.com/upload/v2/' + item + ':upload', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: bytes });
  if (upload.crxVersion && upload.crxVersion !== version) throw new Error('Chrome 返回的上传版本与测试包不一致。');
  let state = upload.uploadState;
  for (let poll = 0; ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(state) && poll < pollLimit; poll++) {
    await sleep(5000);
    state = (await request(base + ':fetchStatus', { headers })).lastAsyncUploadState;
  }
  if (!['SUCCEEDED', 'UPLOAD_SUCCEEDED'].includes(state)) throw new Error('Chrome 包上传未成功：' + String(state));
  if (noPublish) { logger.log('已上传 Chrome 扩展包，未提交审核。'); return; }
  await request(base + ':publish', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true }) });
  logger.log(`已提交 Chrome Web Store 审核：${version}。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
