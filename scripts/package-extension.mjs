import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'dist');
const pkg=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const manifest=JSON.parse(await readFile(resolve(dist,'manifest.json'),'utf8'));
if(manifest.version!==pkg.version)throw new Error('package.json 与 manifest.json 版本不一致。');

// A small standards-compliant STORE zip writer keeps packaging identical on Windows/Linux.
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
async function collect(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('打包目录不能包含符号链接。');const path=resolve(dir,entry.name);if(entry.isDirectory())out.push(...await collect(path));else if(!entry.name.endsWith('.map'))out.push(path);}return out;}
const local=[],central=[];let offset=0;
for(const path of (await collect(dist)).sort()){
  const name=Buffer.from(relative(dist,path).replaceAll('\\','/'),'utf8'),data=await readFile(path),crc=crc32(data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(33,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
  local.push(header,name,data);central.push(directory,name);offset+=header.length+name.length+data.length;
}
const body=Buffer.concat(local),index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(body.length,16);
const zip=Buffer.concat([body,index,end]),output=resolve(root,'release');await mkdir(output,{recursive:true});
const name=`${pkg.name}-v${pkg.version}.zip`,path=resolve(output,name);await writeFile(path,zip);
await writeFile(path+'.sha256',createHash('sha256').update(zip).digest('hex')+'  '+name+'\n');console.log(path);
