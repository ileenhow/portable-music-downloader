import { SourceError } from './errors';
export interface AudioTags { title?: string; artist?: string; album?: string; coverBlob?: Blob }
export function safeFilename(title: string,artist: string){
  let value=[title,artist].filter(Boolean).join(' - ').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'');
  value=value.slice(0,150).replace(/[. ]+$/,'');
  if(!value) value='歌曲';
  if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value='_'+value;
  return value+'.mp3';
}
const syncsafe=(bytes: Uint8Array,pos: number)=>((bytes[pos]&127)<<21)|((bytes[pos+1]&127)<<14)|((bytes[pos+2]&127)<<7)|(bytes[pos+3]&127);
const uint32=(bytes: Uint8Array,pos: number)=>((bytes[pos]*16777216)+(bytes[pos+1]<<16)+(bytes[pos+2]<<8)+bytes[pos+3]);
function textFrame(bytes: Uint8Array){
  const encoding=bytes[0], body=bytes.subarray(1);
  if(encoding===3)return new TextDecoder('utf-8').decode(body).replace(/\0/g,'').trim();
  if(encoding===0)return new TextDecoder('windows-1252').decode(body).replace(/\0/g,'').trim();
  const big=encoding===2||body[0]===0xfe&&body[1]===0xff;
  return new TextDecoder(big?'utf-16be':'utf-16le').decode(body).replace(/[\0\ufeff]/g,'').trim();
}
export async function readTags(file: Blob): Promise<AudioTags>{
  const bytes=new Uint8Array(await file.slice(0,Math.min(file.size,2*1024*1024)).arrayBuffer()), tags: AudioTags={};
  if(bytes.length<10||String.fromCharCode(...bytes.subarray(0,3))!=='ID3')return tags;
  const version=bytes[3];
  if(![3,4].includes(version)||(bytes[5]&0x80))return tags;
  const end=Math.min(bytes.length,10+syncsafe(bytes,6));
  let pos=10;
  if(bytes[5]&0x40){if(pos+4>=end)return tags;pos+=version===4?syncsafe(bytes,pos):4+uint32(bytes,pos);}
  while(pos+10<=end){
    const id=String.fromCharCode(...bytes.subarray(pos,pos+4)), size=version===4?syncsafe(bytes,pos+4):uint32(bytes,pos+4);
    if(!/^[A-Z0-9]{4}$/.test(id)||size<=0||pos+10+size>end)break;
    const data=bytes.subarray(pos+10,pos+10+size), flags=bytes[pos+9];
    if(flags){pos+=10+size;continue;}
    try{
      if(id==='TIT2')tags.title=textFrame(data);
      if(id==='TPE1')tags.artist=textFrame(data);
      if(id==='TALB')tags.album=textFrame(data);
      if(id==='APIC'&&data.length>6){
        const encoding=data[0];let i=1;while(i<data.length&&data[i]!==0)i++;
        const mime=new TextDecoder().decode(data.subarray(1,i));i+=2;
        if(encoding===0||encoding===3){while(i<data.length&&data[i]!==0)i++;i++;}
        else{while(i+1<data.length&&(data[i]!==0||data[i+1]!==0))i+=2;i+=2;}
        if(/^image\/(?:jpeg|png|webp)$/.test(mime)&&i<data.length)tags.coverBlob=new Blob([new Uint8Array(data.subarray(i))],{type:mime});
      }
    }catch{/* A malformed metadata frame must not stop scanning the directory. */}
    pos+=10+size;
  }
  return tags;
}
export async function validateMP3(blob: Blob,expectedDuration=0): Promise<number>{
  if(blob.size<4096)throw new Error('音频文件过小，没有保存到目录。');
  const bytes=new Uint8Array(await blob.slice(0,4096).arrayBuffer());
  const id3=bytes[0]===73&&bytes[1]===68&&bytes[2]===51;
  const frame=bytes[0]===255&&(bytes[1]&224)===224;
  if(!id3&&!frame)throw new Error('返回内容不是有效的 MP3，没有保存到目录。');
  const objectURL=URL.createObjectURL(blob), audio=document.createElement('audio');
  try{
    const duration=await new Promise<number>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('无法校验音频时长，请重试。')),15000);
      audio.onloadedmetadata=()=>{clearTimeout(timer);resolve(audio.duration);};
      audio.onerror=()=>{clearTimeout(timer);reject(new Error('音频无法解码，没有保存到目录。'));};
      audio.preload='metadata';audio.src=objectURL;
    });
    if(!Number.isFinite(duration)||duration<=0)throw new Error('音频时长无效。');
    if(expectedDuration>40&&duration<Math.max(40,expectedDuration*0.85))throw new Error('该音源只有短试听，请选择其他版本。');
    return duration;
  }finally{audio.removeAttribute('src');audio.load();URL.revokeObjectURL(objectURL);}
}
export async function fetchMP3(url: string,onProgress: (loaded: number,total: number)=>void,signal: AbortSignal){
  const response=await fetch(url,{credentials:'omit',signal});
  if(!response.ok)throw new SourceError(response.status===403||response.status===404?'MEDIA_EXPIRED':'MEDIA_FAILED',response.status===403||response.status===404?'音源已失效，请重新解析后重试。':'下载失败，请重试。');
  const type=response.headers.get('content-type')||'';
  if(/text\/|json|html/i.test(type))throw new Error('服务器返回了网页，没有保存到目录。');
  if(response.status===206){
    const range=response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if(!range||Number(range[1])!==0||Number(range[2])+1!==Number(range[3]))throw new Error('服务器只返回了部分音频，没有保存到目录。');
  }
  const declared=Number(response.headers.get('content-length')||0);
  const cap=70*1024*1024;
  if(declared>cap)throw new Error('文件超过 70 MB，请选择其他版本。');
  if(!response.body)throw new Error('服务器没有返回音频内容。');
  const reader=response.body.getReader(),chunks: Uint8Array<ArrayBuffer>[]=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>cap)throw new Error('文件超过 70 MB，没有保存到目录。');chunks.push(new Uint8Array(value));onProgress(size,declared);}
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  if(declared&&size!==declared)throw new Error('下载未完成，请重试。');
  return new Blob(chunks,{type:'audio/mpeg'});
}
export async function uniqueName(directory: FileSystemDirectoryHandle,name: string){
  for(let i=0;i<1000;i++){
    const candidate=i?name.replace(/\.mp3$/i,` (${i+1}).mp3`):name;
    try{await directory.getFileHandle(candidate);}catch(error){if(error instanceof Error&&error.name==='NotFoundError')return candidate;throw error;}
  }
  throw new Error('同名歌曲过多，请整理目录后重试。');
}
