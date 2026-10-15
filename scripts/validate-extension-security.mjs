import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist');
const manifest=JSON.parse(await readFile(resolve(dist,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);assert.equal(manifest.background.type,'module');
assert.match(manifest.content_security_policy.extension_pages,/script-src 'self';/);
assert.ok(!manifest.permissions.includes('debugger')&&!manifest.permissions.includes('nativeMessaging'));
assert.ok(!manifest.host_permissions.some(origin=>origin.includes('*/*')&&!origin.includes('kuwo.cn')));
for(const path of [manifest.background.service_worker,'assets/content.js','popup.html',...Object.values(manifest.icons)])await access(resolve(dist,path));
const content=await readFile(resolve(dist,'assets/content.js'),'utf8');
assert.doesNotMatch(content,/(?:^|[;}])\s*(?:import|export)\b/);
for(const name of ['background','content','source','popup']){
  const code=await readFile(resolve(dist,`assets/${name}.js`),'utf8');assert.doesNotMatch(code,/\beval\s*\(|\bnew\s+Function\s*\(/);
}
console.log('Manifest、运行文件、单文件注入脚本与代码执行限制检查通过。');
