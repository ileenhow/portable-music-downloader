import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { manifestFromZip } from './release-artifact.mjs';

try {
  const path = process.argv[2];
  assert.ok(path, '请指定安装包路径。');
  const name = basename(path), match = /^portable-music-downloader-v(\d+\.\d+\.\d+)\.zip$/.exec(name);
  assert.ok(match, '安装包名称格式无效。');
  const bytes = await readFile(path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const checksum = (await readFile(`${path}.sha256`, 'utf8')).trim();
  assert.equal(checksum, `${digest}  ${name}`, '安装包 SHA-256 校验失败。');
  const manifest = manifestFromZip(bytes);
  assert.equal(manifest.manifest_version, 3, '安装包必须使用 Manifest V3。');
  assert.equal(manifest.version, match[1], '安装包名称与 manifest.json 版本不一致。');
  console.log(`已验证安装包：${name}\nSHA-256: ${digest}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `\n安装包：\`${name}\`\n\nSHA-256：\`${digest}\`\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
