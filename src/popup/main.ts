import {setting,saveSetting,allTracks,saveTrack,removeTrack,updateTracks} from '../shared/storage';
import {readTags,validateMP3,fetchMP3} from '../shared/audio';
import {commitMP3} from '../shared/library-file';
import {DeviceDiscovery,type DeviceSnapshot,type RemovableDevice} from './devices';

import './styles.css';
import './theme.css';
import * as P from '../shared/source';
import { DEFAULT_SOURCE,SOURCES,sourceId,sourceInfo,sourceKey,type SourceId } from '../shared/sources';
import { musicSource } from '../shared/providers';
import { toError, fileSystemMessage } from '../shared/errors';
import type { Actions, Reply } from '../shared/messages';
import type { Folder, LocalTrack, QueueItem, Song, Detail, DisplayTrack, CaptchaTask, CaptchaAnswer } from '../shared/types';
type Elements = Record<string, HTMLElement> & {
  'search-input': HTMLInputElement; 'library-filter': HTMLInputElement; 'captcha-input': HTMLInputElement;
  'search-button': HTMLButtonElement; 'refresh-devices': HTMLButtonElement;
  'load-more': HTMLButtonElement; 'captcha-refresh': HTMLButtonElement; 'captcha-image': HTMLImageElement;
  'player': HTMLAudioElement; 'detail-dialog': HTMLDialogElement; 'add-device-dialog': HTMLDialogElement;
  'captcha-dialog': HTMLDialogElement; 'permission-dialog': HTMLDialogElement; 'device-dialog': HTMLDialogElement;
  'device-name': HTMLInputElement; 'change-local-folder': HTMLButtonElement;
  'choose-directory': HTMLButtonElement; 'reselect-device': HTMLButtonElement;
  'open-device': HTMLButtonElement; 'rename-device': HTMLButtonElement; 'scan-device': HTMLButtonElement;
  'device-storage-usage': HTMLMeterElement;
  'source-select': HTMLSelectElement;
};
const $=<K extends keyof Elements>(id: K)=>document.getElementById(String(id)) as Elements[K];
const extension=!!globalThis.chrome?.runtime?.id;
type DirectoryStatus = 'checking' | 'ready' | 'readonly' | 'permission' | 'unavailable';
interface State { source: SourceId; folders: Folder[]; localFolder: Folder|null; ready: boolean; selecting: boolean; folder: Folder|null; tracks: LocalTrack[]; queue: QueueItem[]; running: boolean; scanning: boolean; searchSeq: number; query: string; next: string; results: Song[]; history: string[]; context: Actions['VERIFY']['args']; haltedSources: Set<SourceId>; previewBusy: boolean }
const state: State={source:DEFAULT_SOURCE,folders:[],localFolder:null,ready:false,selecting:false,folder:null,tracks:[],queue:[],running:false,scanning:false,searchSeq:0,query:'',next:'',results:[],history:[],context:{source:DEFAULT_SOURCE},haltedSources:new Set(),previewBusy:false};
const coverURLs=new Map<string,{blob: Blob;url: string}>();
const playbackCache=new Map<string,{track: Detail;url: string;at: number}>();
const directoryStatus=new Map<string,DirectoryStatus>();
const directoryChecks=new Map<string,number>(),deviceLinks=new Map<string,string>();
let devices: DeviceSnapshot={devices:[],status:'loading'};
let refreshingDevices=false;
const discovery=new DeviceDiscovery(devicesChanged);
let toastTimer: ReturnType<typeof setTimeout>, playerURL='', playingKey: string|undefined, playingSource: string|undefined;
let managedDeviceKey: string|undefined;
let playbackSeq=0,queueFrame=0;
let queueView: {item: QueueItem;message: HTMLElement;progress: HTMLProgressElement}|undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K,className?: string,text?: string): HTMLElementTagNameMap[K]{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function button(text: string,className: string,handler: ()=>unknown){const node=el('button',className,text);node.type='button';node.addEventListener('click',handler);return node;}
type ActionIcon = 'download'|'device'|'play'|'stop'|'scan'|'settings'|'search'|'headphones'|'music'|'plus'|'close'|'chevron'|'edit';
function actionIcon(name: ActionIcon){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','action-icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  use.setAttribute('href','/assets/song-actions.svg#'+name);svg.append(use);return svg;
}
function iconButton(name: ActionIcon,label: string,className: string,handler: ()=>unknown){
  const control=button('','icon-button '+className,handler);control.title=label;control.setAttribute('aria-label',label);control.append(actionIcon(name));return control;
}
function iconSpan(name: ActionIcon,className: string){const node=el('span',className);node.setAttribute('aria-hidden','true');node.append(actionIcon(name));return node;}
function toast(text: string){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function notice(error: Error & {code?: string},context=state.context){if(error.code==='VERIFY')state.context={...context};$('notice').hidden=false;$('notice-text').textContent=error.message||String(error);$('verify-button').hidden=!['VERIFY'].includes(error.code||'');}
function hideNotice(){$('notice').hidden=true;$('verify-button').hidden=true;}
function errorMessage(value: unknown){const error=toError(value);return error.name==='AbortError'?'已取消。':fileSystemMessage(error)||error.message||'操作失败，请重试。';}
async function rpc<A extends keyof Actions>(action: A,args: Actions[A]['args']): Promise<Actions[A]['data']>{
  if(!extension)throw new P.SourceError('PREVIEW','请先在 Chrome 或 Edge 中加载扩展。');
  let result: Reply<Actions[A]['data']>;
  try{result=await chrome.runtime.sendMessage({channel:'portable-library',action,args});}catch{throw new P.SourceError('NETWORK','扩展连接中断，请刷新页面后重试。');}
  if(!result?.ok)throw new P.SourceError(result?.error?.code||'NETWORK',result?.error?.message||'连接中断，请重试。',result?.error?.details);
  return result.data;
}
function persistQueue(){return saveSetting('queue',state.queue.map(({source,id,title,artist,status,message,folderKey,folderName,target})=>({source,id,title,artist,status,message,folderKey,folderName,target}))).catch(()=>toast('队列记录无法保存；请保持页面打开。'));}
function isAppleDoublePath(path: string){return path.split('/').some(name=>name.startsWith('._'));}
function currentTracks(){return state.tracks.filter(t=>t.folderKey===state.folder?.key);}
function formatSize(n: number){return n<1024*1024?(n/1024).toFixed(0)+' KB':(n/1024/1024).toFixed(1)+' MB';}
function queueFolder(item: QueueItem){
  return item.target==='local' ? (state.localFolder?.key===item.folderKey?state.localFolder:undefined) : state.folders.find(folder=>folder.key===item.folderKey);
}
function normalizeDeviceName(name: string){return name.trim().normalize('NFC').toLocaleLowerCase();}
function deviceForFolder(folder: Folder){
  const linked=devices.devices.find(device=>device.id===deviceLinks.get(folder.key));
  if(linked)return linked;
  if(devices.status!=='ready')return;
  const matches=(device: RemovableDevice)=>folder.storage
    ?device.name===folder.storage.name&&device.capacity===folder.storage.capacity
    :normalizeDeviceName(device.name)===normalizeDeviceName(folder.handle.name);
  const candidates=devices.devices.filter(matches);
  const similar=state.folders.filter(other=>folder.storage
    ?other.storage?.name===folder.storage.name&&other.storage?.capacity===folder.storage.capacity
    :!other.storage&&normalizeDeviceName(other.handle.name)===normalizeDeviceName(folder.handle.name));
  // IDs are transient. Never choose between indistinguishable devices or directories.
  if(candidates.length!==1||similar.length!==1)return;
  if(!folder.storage&&!['ready','readonly'].includes(directoryStatus.get(folder.key)||''))return;
  deviceLinks.set(folder.key,candidates[0].id);return candidates[0];
}
function deviceCapacity(capacity: number){return capacity>=1e9?(capacity/1e9).toFixed(1)+' GB':(capacity/1e6).toFixed(0)+' MB';}
function folderDisconnected(folder: Folder){
  return !!folder.storage&&devices.status==='ready'&&!deviceForFolder(folder)&&!devices.devices.some(device=>device.name===folder.storage!.name&&device.capacity===folder.storage!.capacity);
}
function openDevicePicker(){
  if(!state.ready||state.running||state.scanning||state.selecting)return;
  renderDevicePicker();$('add-device-dialog').showModal();void refreshDevices();
}
function renderDevices(){
  const list=$('device-list'),busy=!state.ready||state.running||state.scanning||state.selecting;
  // Keep the invoker node so closing the dialog can restore keyboard focus.
  const add=list.querySelector<HTMLButtonElement>('.add-device-card')||button('','device-card add-device-card',openDevicePicker);
  list.replaceChildren();
  const labels={checking:'正在检查…',ready:'已连接',readonly:'暂不可写',permission:'需要授权',unavailable:'目录不可访问'};
  for(const folder of state.folders){
    const device=deviceForFolder(folder),status=directoryStatus.get(folder.key)||'checking',selected=folder.key===state.folder?.key;
    const offline=folderDisconnected(folder),reconnect=status==='unavailable'&&!!device;
    const card=el('article','device-card'),select=button('','device-select',()=>reconnect?chooseFolder(device):selectDevice(folder));
    card.classList.toggle('selected',selected);card.dataset.key=folder.key;card.setAttribute('aria-label',folder.name);
    select.setAttribute('aria-pressed',String(selected));select.disabled=busy;
    select.title=offline?'查看 '+folder.name+' 的曲库缓存':reconnect?'重新选择 '+folder.name+' 的音乐目录':status==='permission'?'授权读取 '+folder.name+' 的音乐目录':'打开 '+folder.name+' 的曲库';
    const text=el('span','device-card-text'),statusLabel=el('small','device-status',offline?'未连接':labels[status]);statusLabel.dataset.status=offline?'offline':status;
    const title=el('strong','',folder.name);title.title=folder.name;
    const capacity=device?.capacity??folder.storage?.capacity,count=state.tracks.filter(t=>t.folderKey===folder.key).length;
    text.append(title,el('small','',capacity?deviceCapacity(capacity)+' · '+count+' 首':count+' 首'),statusLabel);
    const icon=iconSpan('headphones','device-glyph');select.append(icon,text);
    const actions=el('div','device-card-actions'),scan=iconButton('scan','重新扫描','scan-device',()=>scanDevice(folder)),manage=iconButton('settings','管理设备','manage-device',()=>manageDevice(folder));
    scan.setAttribute('aria-label','重新扫描 '+folder.name);manage.setAttribute('aria-label','管理设备 '+folder.name);
    scan.disabled=busy||offline||status==='checking'||status==='unavailable';manage.disabled=busy;
    actions.append(scan,manage);card.append(select,actions);list.append(card);
  }
  if(!add.childElementCount){add.append(iconSpan('plus','add-device-icon'),el('span','','添加设备'));add.setAttribute('aria-haspopup','dialog');}
  // Single-device v1 hides the entry; keep the addition flow for future versions.
  add.hidden=state.folders.length>0;add.disabled=busy;list.append(add);
  renderDevicePicker();
}
function renderDevicePicker(){
  const list=$('available-devices'),busy=!state.ready||state.running||state.scanning||state.selecting;
  list.replaceChildren();list.setAttribute('aria-busy',String(refreshingDevices||devices.status==='loading'));
  $('refresh-devices').disabled=refreshingDevices;$('refresh-devices').textContent=refreshingDevices?'刷新中…':'刷新';
  $('choose-directory').disabled=busy;
  if(devices.status==='ready')for(const device of devices.devices){
    const folder=state.folders.find(folder=>deviceForFolder(folder)?.id===device.id);
    const reconnect=folder&&directoryStatus.get(folder.key)==='unavailable';
    const card=button('','device-card discovered',()=>{
      $('add-device-dialog').close();
      return folder&&!reconnect?selectDevice(folder):chooseFolder(device);
    }),text=el('span','device-card-text'),icon=iconSpan('headphones','device-glyph');
    card.disabled=busy||refreshingDevices;card.dataset.deviceId=device.id;card.title=folder&&!reconnect?'打开 '+folder.name+' 的曲库':'选择 '+device.name+' 的音乐目录';icon.setAttribute('aria-hidden','true');
    const title=el('strong','',device.name);title.title=device.name;
    text.append(title,el('small','',deviceCapacity(device.capacity)),el('small','device-status',folder?'已添加':'待添加'));
    card.append(icon,text,el('span','device-card-action',reconnect?'选择':folder?'打开':'连接'));list.append(card);
  }
  if(!list.childElementCount){
    const empty=el('div','device-picker-empty'),loading=refreshingDevices||devices.status==='loading';
    empty.append(el('strong','',loading?'正在查找设备…':devices.status==='unavailable'?'暂时无法扫描设备':'未发现 USB 设备'),el('p','',loading?'':devices.status==='unavailable'?'可手动选择音乐目录。':'连接设备并进入 U 盘模式后，点击刷新。'));list.append(empty);
  }
}
function updateFolderUI(){
  const busy=!state.ready||state.running||state.scanning||state.selecting;
  updateDeviceBar();
  $('reselect-device').disabled=busy;
  $('local-destination').textContent=state.localFolder?'本地保存至：'+state.localFolder.name:'本地下载时选择电脑文件夹';
  $('local-destination').title=$('local-destination').textContent||'';
  $('change-local-folder').hidden=!state.localFolder;$('change-local-folder').disabled=busy;
  renderDevices();if(state.results.length)renderSearch();
}
function compactCapacity(bytes: number){
  const divisor=bytes>=1e9?1e9:1e6,unit=bytes>=1e9?'G':'M';
  return Number((bytes/divisor).toFixed(1))+unit;
}
function updateDeviceBar(){
  const folder=state.folder,busy=!state.ready||state.running||state.scanning||state.selecting;
  $('devices-section').hidden=!!folder&&state.folders.length===1;
  $('device-library-toolbar').hidden=!folder;
  if(!folder)return;
  const tracks=currentTracks(),device=deviceForFolder(folder),status=directoryStatus.get(folder.key)||'checking';
  const total=device?.capacity??folder.storage?.capacity,libraryBytes=tracks.reduce((sum,track)=>sum+track.size,0);
  // Whole-volume free space is a Dev-channel API. Stable browsers report the scanned library size instead.
  const wholeVolume=device?.availableCapacity!==undefined;
  const used=wholeVolume?Math.max(0,device.capacity-device.availableCapacity!):libraryBytes;
  const label=(wholeVolume?'已使用':'曲库')+' '+compactCapacity(used)+' / '+(total?compactCapacity(total):'容量未知');
  $('library-title').textContent=folder.name;$('library-title').title=folder.name;
  $('library-count').textContent=tracks.length+' 首歌曲';
  $('device-capacity').textContent=label;
  $('device-storage').title=wholeVolume?'设备已使用容量 / 总容量':'曲库占用仅包含本次扫描到的 MP3 文件；总容量为整个设备容量。';
  const meter=$('device-storage-usage');meter.hidden=!total;meter.max=total||1;meter.value=Math.min(used,total||1);meter.setAttribute('aria-label',wholeVolume?'设备已使用容量':'曲库文件占用');meter.setAttribute('aria-valuetext',label);
  const offline=folderDisconnected(folder),connected=!offline&&(!!device||['ready','readonly'].includes(status));
  const connection=$('device-status');connection.textContent=connected?'已连接':status==='checking'?'正在检查…':'未连接';connection.dataset.status=connected?'ready':'offline';
  const messages={checking:'正在检查音乐目录',ready:'音乐目录可读取',readonly:'音乐目录暂不可写',permission:'需要授权读取音乐目录',unavailable:'音乐目录不可访问，请重新选择目录'};
  connection.title=offline?'设备已断开，当前显示缓存曲库':messages[status];
  $('rename-device').disabled=busy;$('scan-device').disabled=busy||offline||status==='checking'||status==='unavailable';
  $('open-device').disabled=busy;$('open-device').title=offline?'查看缓存曲库':status==='unavailable'?'重新选择音乐目录':status==='permission'?'授权读取音乐目录':'打开设备音乐目录';$('open-device').setAttribute('aria-label',$('open-device').title);
}
function devicesChanged(snapshot: DeviceSnapshot){
  const removed=snapshot.status==='ready'?state.folders.filter(folder=>{
    const id=deviceLinks.get(folder.key);return id&&!snapshot.devices.some(device=>device.id===id);
  }):[];
  devices=snapshot;
  for(const folder of removed){
    deviceLinks.delete(folder.key);directoryChecks.set(folder.key,(directoryChecks.get(folder.key)||0)+1);directoryStatus.set(folder.key,'unavailable');
    if(state.tracks.some(track=>track.folderKey===folder.key&&track.key===playingKey))stopPlayer();
    for(const item of state.queue)if(item.folderKey===folder.key){
      if(item.status==='running')item.controller?.abort();
      else if(item.status==='queued'){item.status='paused';item.message='设备已断开，请重新连接后继续。';}
    }
  }
  if(removed.length){renderQueue();void persistQueue();}
  if(state.ready){updateFolderUI();void restoreDevices();}
}
async function restoreDevices(){
  const previous=state.folder?directoryStatus.get(state.folder.key):undefined;
  await Promise.all(state.folders.map(checkFolder));
  updateFolderUI();
  if(state.running||state.scanning||state.selecting)return;
  const available=state.folders.filter(folder=>['ready','readonly'].includes(directoryStatus.get(folder.key)||''));
  if((!state.folder||directoryStatus.get(state.folder.key)==='unavailable')&&available.length===1){await selectDevice(available[0],false);}
  else if(state.folder&&available.includes(state.folder)&&!['ready','readonly'].includes(previous||''))await scanFolder(false);
}
async function refreshDevices(){
  if(!state.ready||refreshingDevices)return;
  refreshingDevices=true;renderDevicePicker();
  try{await discovery.refresh();}finally{refreshingDevices=false;renderDevicePicker();}
}
async function folderAllowed(handle: FileSystemDirectoryHandle,prompt=false,mode: 'read'|'readwrite'='readwrite'){
  if(await handle.queryPermission({mode})==='granted')return true;
  return prompt && await handle.requestPermission({mode})==='granted';
}
function recordDirectoryError(folder: Folder,value: unknown,writing=false){
  directoryChecks.set(folder.key,(directoryChecks.get(folder.key)||0)+1);
  const error=toError(value);
  if(writing&&error.name==='NoModificationAllowedError')directoryStatus.set(folder.key,'readonly');
  else if(!writing&&error.name==='NotAllowedError')directoryStatus.set(folder.key,'permission');
  else if(['NotFoundError','NotReadableError','InvalidStateError','NoModificationAllowedError'].includes(error.name))directoryStatus.set(folder.key,'unavailable');
}
async function checkFolder(folder: Folder){
  const revision=(directoryChecks.get(folder.key)||0)+1;directoryChecks.set(folder.key,revision);
  let status: DirectoryStatus;
  try{
    if(folderDisconnected(folder))status='unavailable';
    else if(!await folderAllowed(folder.handle,false,'read'))status='permission';
    else{
      const entries=folder.handle.entries();try{await entries.next();}finally{await entries.return?.();}
      status=directoryStatus.get(folder.key)==='readonly'?'readonly':'ready';
    }
  }catch{status='unavailable';}
  if(directoryChecks.get(folder.key)===revision&&state.folders.some(current=>current.key===folder.key&&current.handle===folder.handle))directoryStatus.set(folder.key,status);
}
async function chooseFolder(device?: RemovableDevice){
  if(!state.ready||state.running||state.scanning||state.selecting)return;
  state.selecting=true;updateFolderUI();
  try{
    if(!globalThis.showDirectoryPicker)throw new Error('请使用桌面版 Chrome 或 Edge 选择设备音乐目录。');
    const remembered=device&&state.folders.find(folder=>deviceForFolder(folder)?.id===device.id);
    if(device)toast('选择“'+device.name+'”的音乐目录。');
    const handle=await showDirectoryPicker({mode:'read',id:'portable-library',startIn:remembered?.handle||'music'});
    let previous: Folder|undefined;
    for(const folder of state.folders){try{if(await handle.isSameEntry(folder.handle)){previous=folder;break;}}catch{}}
    if(!previous&&state.localFolder&&await handle.isSameEntry(state.localFolder.handle))previous=state.localFolder;
    const folder: Folder={handle,key:previous?.key||crypto.randomUUID(),name:previous?.name||device?.name||handle.name,storage:device?{name:device.name,capacity:device.capacity}:previous?.storage};
    if(device)deviceLinks.set(folder.key,device.id);
    state.folders=state.folders.filter(f=>f.key!==folder.key).concat(folder);state.folder=folder;
    stopPlayer();$('library-filter').value='';
    await saveSetting('folders',state.folders);await saveSetting('folder',folder);
    directoryStatus.set(folder.key,'checking');renderLibrary();await scanFolder();
  }catch(caught){const error=toError(caught);if(error.name!=='AbortError')toast(errorMessage(error));}
  finally{state.selecting=false;updateFolderUI();void runQueue();}
}
async function selectDevice(folder: Folder,prompt=true){
  if(!state.ready||state.running||state.scanning||state.selecting)return;
  state.folder=folder;stopPlayer();$('library-filter').value='';renderLibrary();
  if(directoryStatus.get(folder.key)==='unavailable'||folderDisconnected(folder)){
    try{await saveSetting('folder',folder);updateFolderUI();toast('设备目录暂不可访问，请连接设备或在管理设备中重新选择目录。');}catch(caught){toast(errorMessage(caught));}return;
  }
  // Request directory access while handling the click, before IndexedDB work.
  const scan=scanFolder(prompt);
  try{await saveSetting('folder',folder);await scan;}catch(caught){toast(errorMessage(caught));}
}
async function chooseLocalFolder(): Promise<Folder|undefined>{
  if(!state.ready||state.running||state.scanning||state.selecting)return;
  if(state.localFolder&&state.queue.some(q=>q.target==='local'&&q.folderKey===state.localFolder!.key&&q.status!=='done')){toast('请先完成或移除本地目录的未完成任务，再更换目录。');return;}
  state.selecting=true;updateFolderUI();
  try{
    if(!globalThis.showDirectoryPicker)throw new Error('请使用桌面版 Chrome 或 Edge 选择电脑文件夹。');
    const handle=await showDirectoryPicker({mode:'readwrite',id:'portable-local',startIn:'music'});
    let key: string=crypto.randomUUID();
    if(state.localFolder&&await handle.isSameEntry(state.localFolder.handle))key=state.localFolder.key;
    // One physical directory must have one library identity, even if selected for both destinations.
    for(const folder of state.folders){try{if(await handle.isSameEntry(folder.handle)){key=folder.key;break;}}catch{}}
    const folder={handle,key,name:handle.name};state.localFolder=folder;await saveSetting('localFolder',folder);return folder;
  }catch(caught){const error=toError(caught);if(error.name!=='AbortError')toast(errorMessage(error));}
  finally{state.selecting=false;updateFolderUI();void runQueue();}
}
function scanDevice(folder: Folder){
  if(!state.ready||state.running||state.scanning||state.selecting)return;
  return folder.key===state.folder?.key?scanFolder():selectDevice(folder);
}
function manageDevice(folder: Folder){
  if(!state.ready||state.running||state.scanning||state.selecting)return;
  managedDeviceKey=folder.key;$('device-dialog-title').textContent=folder.name;$('device-name').value=folder.name;
  $('device-directory').textContent='音乐目录：'+folder.handle.name;$('device-dialog').showModal();
}
async function renameDevice(){
  const folder=state.folders.find(f=>f.key===managedDeviceKey),name=P.clean($('device-name').value).slice(0,60);
  if(!folder||!name||state.running||state.scanning||state.selecting)return;
  try{
    const renamed={...folder,name},folders=state.folders.map(f=>f.key===folder.key?renamed:f);
    await saveSetting('folders',folders);if(state.folder?.key===folder.key)await saveSetting('folder',renamed);
    state.folders=folders;if(state.folder?.key===folder.key)state.folder=renamed;
    for(const item of state.queue)if(item.folderKey===folder.key&&item.target!=='local')item.folderName=name;
    await persistQueue();updateFolderUI();renderQueue();$('device-dialog').close();toast('设备名称已更新。');
  }catch(caught){toast(errorMessage(caught));}
}
async function forgetDevice(){
  const folder=state.folders.find(f=>f.key===managedDeviceKey);if(!folder||state.running||state.scanning||state.selecting)return;
  if(!confirm('移除“'+folder.name+'”的设备记录及未完成下载任务？设备内的音乐文件会保留。'))return;
  try{
    const folders=state.folders.filter(f=>f.key!==folder.key),wasSelected=state.folder?.key===folder.key,selected=wasSelected?(folders[0]||null):state.folder;
    await saveSetting('folders',folders);await saveSetting('folder',selected);state.folders=folders;state.folder=selected;
    state.queue=state.queue.filter(item=>item.folderKey!==folder.key||item.target==='local'||item.status==='done');
    if(wasSelected)stopPlayer();directoryStatus.delete(folder.key);deviceLinks.delete(folder.key);directoryChecks.delete(folder.key);await persistQueue();updateFolderUI();renderLibrary();renderQueue();$('device-dialog').close();toast('设备记录已移除，音乐文件已保留。');
  }catch(caught){toast(errorMessage(caught));}
}
async function getParent(path: string,folder=state.folder){
  if(!folder)throw new Error('请先选择音乐目录。');
  let directory=folder.handle;const parts=path.split('/'),name=parts.pop();
  if(!name||parts.some(p=>!p||p==='.'||p==='..'))throw new Error('文件路径无效。');
  for(const part of parts)directory=await directory.getDirectoryHandle(part);
  return {directory,name};
}
async function scanFolder(prompt=true){
  if(!state.folder||state.running||state.scanning)return;
  const root=state.folder,key=root.key;
  state.scanning=true;updateFolderUI();$('library-results').setAttribute('aria-busy','true');
  try{
    if(!await folderAllowed(root.handle,prompt,'read')){directoryStatus.set(key,'permission');throw new Error('需要允许读取所选音乐目录。');}
    const old=new Map(state.tracks.filter(t=>t.folderKey===key).map(t=>[t.path,t])),found: LocalTrack[]=[],changed: LocalTrack[]=[];
    async function walk(directory: FileSystemDirectoryHandle,prefix='',depth=0): Promise<void>{
      if(depth>8)throw new Error('目录层级超过 8 层，请选择更具体的音乐文件夹。');
      for await(const [name,handle] of directory.entries()){
        // macOS metadata sidecars retain the original extension but contain no audio.
        if(isAppleDoublePath(name))continue;
        if(handle.kind==='directory'){
          if(/^(?:System Volume Information|\$RECYCLE\.BIN|\.Spotlight-V100|\.Trashes|\.fseventsd)$/i.test(name))continue;
          await walk(handle,prefix+name+'/',depth+1);continue;
        }
        if(!/\.mp3$/i.test(name))continue;
        if(found.length>=5000)throw new Error('歌曲超过 5000 首，请选择较小的音乐文件夹。');
        const path=prefix+name,file=await handle.getFile(),previous=old.get(path);old.delete(path);
        let track: LocalTrack;
        if(previous&&previous.size===file.size&&previous.modified===file.lastModified)track=previous;
        else{
          const tags=await readTags(file);
          track={key:key+'/'+path,folderKey:key,path,title:tags.title||name.replace(/\.mp3$/i,''),artist:tags.artist||'',album:tags.album||'',coverBlob:tags.coverBlob||null,cover:'',size:file.size,modified:file.lastModified};
          changed.push(track);
        }
        found.push(track);
      }
    }
    await walk(root.handle);
    await updateTracks(changed,[...old.values()].map(track=>track.key));
    state.tracks=state.tracks.filter(t=>t.folderKey!==key).concat(found);
    if(directoryStatus.get(key)!=='readonly')directoryStatus.set(key,'ready');renderLibrary();toast('已扫描 '+found.length+' 首歌曲。');
  }catch(caught){const error=toError(caught);toast(errorMessage(error));recordDirectoryError(root,error);}
  finally{state.scanning=false;$('library-results').setAttribute('aria-busy','false');updateFolderUI();void runQueue();}
}
function releaseCover(key: string){
  const cached=coverURLs.get(key);if(!cached)return;
  URL.revokeObjectURL(cached.url);coverURLs.delete(key);
}
function artwork(container: HTMLElement,track: DisplayTrack){
  const placeholder=iconSpan('music','cover-placeholder');container.replaceChildren(placeholder);
  let url: string|undefined=track.cover;
  if(track.coverBlob){
    const key=track.key||track.cover;let cached=coverURLs.get(key);
    if(cached&&cached.blob!==track.coverBlob){releaseCover(key);cached=undefined;}
    if(!cached){cached={blob:track.coverBlob,url:URL.createObjectURL(track.coverBlob)};coverURLs.set(key,cached);}url=cached.url;
  }
  if(!url)return;
  const img=el('img');img.alt=(track.title||'歌曲')+'封面';img.loading='lazy';img.referrerPolicy='no-referrer';
  img.addEventListener('error',()=>{img.remove();placeholder.hidden=false;},{once:true});img.addEventListener('load',()=>placeholder.hidden=true,{once:true});img.src=url;container.append(img);
}
function renderLibrary(){
  const tracks=currentTracks(),filter=P.clean($('library-filter').value).toLocaleLowerCase(),visible=tracks.filter(t=>[t.title,t.artist,t.album].join(' ').toLocaleLowerCase().includes(filter));
  const covers=new Map(tracks.map(track=>[track.key,track.coverBlob]));
  for(const [key,cached] of coverURLs)if(covers.get(key)!==cached.blob)releaseCover(key);
  updateDeviceBar();
  const list=$('library-results');list.replaceChildren();
  if(!tracks.length){const empty=el('div','empty empty-library');empty.append(iconSpan('music','empty-device-icon'),el('h3','',state.folder?'设备曲库，从一首歌开始':'连接设备，让音乐随行'),el('p','',state.folder?'在左侧找到喜欢的版本，下载到当前设备。已有 MP3 可点“重新扫描”。':'在上方连接设备并授权音乐目录，在这里浏览和整理歌曲。'));list.append(empty);return;}
  if(!visible.length){list.append(el('p','empty-library muted','没有找到匹配的本地歌曲。'));return;}
  for(const track of visible){
    const tile=el('article','album-tile'),cover=button('','cover-button',()=>playLocal(track));cover.setAttribute('aria-label',(playingKey===track.key?'停止播放 ':'播放 ')+track.title);artwork(cover,track);cover.append(iconSpan(playingKey===track.key?'stop':'play','cover-play-indicator'));
    const title=el('h3','',track.title);title.title=track.title;const artist=el('p','',track.artist||'未知歌手');
    const actions=el('div','tile-actions');actions.append(button('查看','',()=>localDetails(track)),button('删除','',()=>deleteLocal(track)));
    tile.dataset.key=track.key;tile.classList.toggle('playing',playingKey===track.key);cover.setAttribute('aria-pressed',String(playingKey===track.key));
    tile.append(cover,title,artist);if(track.album)tile.append(el('p','album-label',track.album));tile.append(actions);list.append(tile);
  }
}
function detailCard(track: Detail|LocalTrack){
  const hero=el('div','detail-hero'),cover=el('div','detail-art'),text=el('div');artwork(cover,track);text.append(el('h2','',track.title),el('p','',track.artist||'未知歌手'));hero.append(cover,text);
  const properties=el('div','detail-properties');
  if(track.album)properties.append(el('div','', '专辑：'+track.album));
  if(track.duration)properties.append(el('div','', '时长：'+(typeof track.duration==='number'?Math.floor(track.duration/60)+':'+String(Math.floor(track.duration%60)).padStart(2,'0'):track.duration)));
  if('path' in track){properties.append(el('div','', '文件：'+track.path),el('div','', '大小：'+formatSize(track.size)));}
  else properties.append(el('div','',track.type===1?'此版本受限，仅支持在服务页面处理。':'普通 MP3 播放源 · 保存前校验完整时长'));
  const actions=el('div','dialog-actions');actions.append(button('播放','secondary',()=>('path' in track)?playLocal(track):preview(track)));
  $('detail-content').replaceChildren(hero,properties,actions);
}
function localDetails(track: LocalTrack){detailCard(track);$('detail-dialog').showModal();}
const getDetail=(song: {source: SourceId; id: string})=>rpc('DETAIL',{source:song.source,id:song.id});
function updatePlaybackUI(){
  for(const control of document.querySelectorAll<HTMLButtonElement>('.play-button')){
    const active=control.dataset.id===playingSource,label=active?'停止播放':'播放';control.replaceChildren(actionIcon(active?'stop':'play'));control.title=label;control.setAttribute('aria-label',label);control.setAttribute('aria-pressed',String(active));
  }
  for(const tile of document.querySelectorAll<HTMLElement>('.album-tile')){
    const active=tile.dataset.key===playingKey;tile.classList.toggle('playing',active);const cover=tile.querySelector('button');cover?.setAttribute('aria-pressed',String(active));cover?.setAttribute('aria-label',(active?'停止播放 ':'播放 ')+(tile.querySelector('h3')?.textContent||''));cover?.querySelector('.cover-play-indicator')?.replaceChildren(actionIcon(active?'stop':'play'));
  }
}
async function setPlayer(track: DisplayTrack,url: string,localURL=false,sourceId?: string){
  stopPlayer();if(localURL){playerURL=url;playingKey=track.key;}else playingSource=sourceId;
  const seq=playbackSeq;
  $('player').src=url;updatePlaybackUI();
  try{await $('player').play();}catch{if(seq===playbackSeq){stopPlayer();toast('无法开始播放，请再点一次歌曲上的播放按钮。');}}
}
function stopPlayer(){playbackSeq++;const player=$('player');player.pause();player.removeAttribute('src');player.load();if(playerURL){URL.revokeObjectURL(playerURL);playerURL='';}playingKey=undefined;playingSource=undefined;updatePlaybackUI();}
async function playLocal(track: LocalTrack){
  if(playingKey===track.key){stopPlayer();return;}
  const folder=state.folder;if(!folder||folder.key!==track.folderKey)return;
  stopPlayer();const seq=playbackSeq;
  try{if(!await folderAllowed(folder.handle,true,'read'))throw new Error('请重新授权读取音乐目录。');const {directory,name}=await getParent(track.path,folder);const file=await(await directory.getFileHandle(name)).getFile();if(seq!==playbackSeq||state.folder?.key!==folder.key)return;await setPlayer(track,URL.createObjectURL(file),true);}catch(caught){if(seq!==playbackSeq)return;const error=toError(caught);recordDirectoryError(folder,error);updateFolderUI();toast(errorMessage(error));}
}
async function deleteLocal(track: LocalTrack){
  if(state.running||state.scanning){toast('请等下载或扫描完成后再整理曲库。');return;}
  const folder=state.folder;if(!folder||folder.key!==track.folderKey)return;
  try{
    if(!await folderAllowed(folder.handle,true))throw new Error('删除歌曲需要允许写入音乐目录。');
    if(!confirm('从所选音乐目录删除“'+track.title+'”？\n文件将从设备或电脑目录中移除。'))return;
    if(playingKey===track.key)stopPlayer();
    const {directory,name}=await getParent(track.path,folder);await directory.removeEntry(name);await removeTrack(track.key);state.tracks=state.tracks.filter(t=>t.key!==track.key);directoryStatus.set(folder.key,'ready');
    releaseCover(track.key);renderLibrary();updateFolderUI();toast('已删除歌曲。');
  }catch(caught){const error=toError(caught);recordDirectoryError(folder,error,true);updateFolderUI();toast(errorMessage(error));}
}
function renderHistory(){const node=$('search-history');node.replaceChildren();for(const query of state.history)node.append(button(query,'history-chip',()=>{$('search-input').value=query;search(query);}));}
function renderSearch(){
  const list=$('search-results');list.replaceChildren();
  if(!state.results.length){const empty=el('div','empty');empty.append(el('h3','','没有找到这首歌'),el('p','','试试只输入歌名，或更换歌手关键词。'));list.append(empty);return;}
  state.results.forEach(song=>{
    const row=el('article','result-row'),main=el('div','result-main'),title=el('strong','',song.title),artist=el('small','',song.artist||'未知歌手');title.title=song.title;artist.title=artist.textContent||'';main.append(title,artist);
    const actions=el('div','result-actions'),local=iconButton('download','下载到本地','local-download',()=>enqueue(song,'local')),device=iconButton('device','发送到设备','device-download',()=>enqueue(song,'device')),play=iconButton('play','播放','play-button',()=>preview(song));
    const status=state.folder?directoryStatus.get(state.folder.key):undefined;
    local.disabled=!state.ready||state.selecting||((state.running||state.scanning)&&!state.localFolder);device.disabled=!state.ready||state.selecting||!state.folder||!['ready','readonly'].includes(status||'');
    device.title=status==='readonly'?'发送到设备（目录暂不可写，请先确认设备可正常传歌）':!device.disabled&&state.folder?'发送到设备：'+state.folder.name:'发送到设备（请先连接并授权读取目录）';play.dataset.id=sourceKey(song);play.setAttribute('aria-pressed','false');
    actions.append(local,device,play);row.append(main,actions);list.append(row);
  });updatePlaybackUI();
}
async function search(query: string,more=false){
  if(!extension){notice(new P.SourceError('PREVIEW','请先在 Chrome 或 Edge 中加载扩展，再搜索歌曲。'));return;}
  const seq=++state.searchSeq,source=state.source;query=P.clean(query);hideNotice();
  $('search-button').disabled=true;$('search-button').textContent='搜索中…';$('load-more').disabled=true;
  if(!more){state.results=[];$('search-results').replaceChildren(el('p','busy-indicator','正在寻找歌曲与不同版本…'));$('results-title').textContent='正在搜索';$('results-count').textContent='';$('load-more').hidden=true;}
  try{
    const result=await rpc('SEARCH',{source,query,cursor:more?state.next:undefined});
    if(seq!==state.searchSeq)return;
    const parsed=musicSource(source).parseSearch(new DOMParser().parseFromString(result.html,'text/html'));
    if(seq!==state.searchSeq)return;
    state.query=query;state.results=more?state.results.concat(parsed.items.filter(s=>!state.results.some(old=>sourceKey(old)===sourceKey(s)))):parsed.items;state.next=parsed.next;
    $('results-title').textContent='“'+query+'”的搜索结果';$('results-count').textContent=parsed.total+' 首';$('load-more').hidden=!parsed.next;renderSearch();
    state.history=[query,...state.history.filter(q=>q!==query)].slice(0,8);await saveSetting('history',state.history);renderHistory();
  }catch(caught){const error=toError(caught);if(seq!==state.searchSeq)return;notice(error,{source,query});if(!more){$('search-results').replaceChildren(el('p','busy-indicator','搜索未完成。可以稍后重试。'));$('results-title').textContent='等待重新搜索';}}
  finally{if(seq===state.searchSeq){$('search-button').disabled=false;$('search-button').textContent='搜索';$('load-more').disabled=false;}}
}
function switchSource(){
  const source=sourceId($('source-select').value);if(source===state.source)return;
  state.source=source;state.searchSeq++;state.results=[];state.next='';
  if(playingSource)stopPlayer();hideNotice();
  $('search-button').disabled=false;$('search-button').textContent='搜索';$('load-more').hidden=true;$('results-count').textContent='';$('results-title').textContent='歌曲搜索';
  $('search-results').replaceChildren(el('p','busy-indicator','搜索歌名或歌手，找到喜欢的版本。'));
  void saveSetting('musicSource',source).catch(()=>toast('音源选择未保存，请保持页面打开。'));
  const query=P.clean($('search-input').value);if(query&&extension)void search(query);
}
async function allowMedia(value: string){
  const url=P.mediaURL(value),origin=url.origin+'/*';
  if(await chrome.permissions.contains({origins:[origin]}))return url.href;
  return new Promise<string>((resolve,reject)=>{
    const dialog=$('permission-dialog');$('permission-origin').textContent=url.origin;
    function finish(allowed: boolean){dialog.removeEventListener('close',closed);dialog.close();$('permission-allow').onclick=null;$('permission-cancel').onclick=null;allowed?resolve(url.href):reject(new P.SourceError('CANCELLED','未授权此音频服务器。'));}
    function closed(){finish(false);}dialog.addEventListener('close',closed,{once:true});
    $('permission-allow').onclick=async()=>{try{finish(await chrome.permissions.request({origins:[origin]}));}catch{finish(false);}};$('permission-cancel').onclick=()=>finish(false);dialog.showModal();
  });
}
let captchaTask: CaptchaTask|null=null;
async function loadCaptcha(task: CaptchaTask){
  $('captcha-input').value='';$('captcha-error').textContent='正在加载…';$('captcha-refresh').disabled=true;task.ready=false;
  try{
    const result=await rpc('CAPTCHA',{source:task.source,id:task.id}),data=result.data;if(captchaTask!==task)return;
    if(result.code!==1||!data?.key||typeof data.img!=='string')throw new Error('验证码加载失败，请重试。');
    const src=data.img.startsWith('data:image/')?data.img:/^(?:iVBOR|\/9j\/)/.test(data.img)?'data:image/png;base64,'+data.img:P.safeHttp(data.img);
    if(!src||!/^data:image\/(?:png|jpeg|webp);base64,|^https?:\/\//.test(src))throw new Error('验证码图片格式不支持。');
    task.key=String(data.key);task.ready=true;$('captcha-image').src=src;$('captcha-error').textContent='';$('captcha-input').focus();
  }catch(caught){if(captchaTask===task)$('captcha-error').textContent=errorMessage(caught);}
  finally{if(captchaTask===task)$('captcha-refresh').disabled=false;}
}
function askCaptcha(source: SourceId,id: string,message: string): Promise<CaptchaAnswer>{
  if(captchaTask)throw new P.SourceError('BUSY','请先完成当前验证码。');
  return new Promise((resolve,reject)=>{captchaTask={source,id,resolve,reject,ready:false};$('captcha-error').textContent=message;$('captcha-dialog').showModal();void loadCaptcha(captchaTask);});
}
function endCaptcha(answer?: CaptchaAnswer){const task=captchaTask;if(!task)return;captchaTask=null;$('captcha-dialog').close();answer?task.resolve(answer):task.reject(new P.SourceError('CANCELLED','已取消验证码。'));}
async function resolveTrack(track: Detail,wanted=()=>true){
  const fields={source:track.source,id:track.id,playId:track.playId,purpose:'play' as const};let answer: Partial<CaptchaAnswer>={},refreshed=false;
  for(let attempts=0;attempts<4;attempts++){
    try{let {url}=await rpc('RESOLVE',{...fields,...answer});if(!wanted())throw new P.SourceError('CANCELLED','已切换搜索来源。');if(new URL(url).hostname==='antiserver.kuwo.cn')url=(await rpc('CONVERT',{source:track.source,url})).url;return url;}
    catch(caught){
      const error=toError(caught);if(!wanted())throw new P.SourceError('CANCELLED','已切换搜索来源。');
      if(error.code==='PLAY_EXPIRED'&&!refreshed){
        const fresh=await getDetail(track);if(!wanted())throw new P.SourceError('CANCELLED','已切换搜索来源。');
        if(fresh.type===1)throw new P.SourceError('RESTRICTED','此版本受限，请选择其他版本。');
        fields.playId=fresh.playId;answer={};refreshed=true;attempts--;continue;
      }
      if(error.code!=='CAPTCHA'||attempts===3)throw error;answer=await askCaptcha(track.source,track.id,error.message);
    }
  }
  throw new P.SourceError('CAPTCHA','验证码多次未通过，请稍后重试。');
}
async function preview(song: Song){
  const key=sourceKey(song),searchSeq=state.searchSeq;if(playingSource===key){stopPlayer();return;}
  if(state.previewBusy||state.running){toast('请等当前下载或播放解析完成。');return;}
  stopPlayer();const seq=playbackSeq,wanted=()=>seq===playbackSeq&&searchSeq===state.searchSeq;
  state.previewBusy=true;toast('正在获取播放源…');
  try{const track=await getDetail(song);if(!wanted())return;if(track.type===1)throw new P.SourceError('RESTRICTED','此版本受限，请选择其他版本。');const resolved=await resolveTrack(track,wanted);if(!wanted())return;const url=await allowMedia(resolved);if(!wanted())return;playbackCache.set(key,{track,url,at:Date.now()});await setPlayer(track,url,false,key);}
  catch(caught){if(!wanted())return;const error=toError(caught);notice(error,{source:song.source,id:song.id});toast(errorMessage(error));}
  finally{state.previewBusy=false;void runQueue();}
}
async function enqueue(song: Song,target: 'local'|'device'){
  if(!extension){notice(new P.SourceError('PREVIEW','请先加载浏览器扩展。'));return;}
  if(!state.ready||state.selecting)return;
  let folder: Folder|null|undefined;
  try{
    // Capture the destination before asynchronous work; local downloads never switch the selected device.
    folder=target==='local'?(state.localFolder||await chooseLocalFolder()):state.folder;
    if(!folder){if(target==='device')toast('请先连接右侧设备，选择设备的音乐目录。');return;}
    const folderKey=folder.key;
    if(!await folderAllowed(folder.handle,true))throw new Error('需要允许读写保存目录。');
    if(state.queue.some(q=>sourceKey(q)===sourceKey(song)&&q.folderKey===folderKey&&['queued','running','paused'].includes(q.status))){toast('这首歌已经在该目录的队列中。');return;}
    const existing=state.tracks.find(t=>t.folderKey===folderKey&&t.sourceId&&sourceKey({source:t.source,id:t.sourceId})===sourceKey(song));
    if(existing){try{const {directory,name}=await getParent(existing.path,folder);await directory.getFileHandle(name);toast('这个版本已在所选目录中。');return;}catch(caught){const error=toError(caught);if(error.name!=='NotFoundError')throw error;}}
    const paused=state.haltedSources.has(song.source);
    const item: QueueItem={source:song.source,id:song.id,title:song.title,artist:song.artist,status:paused?'paused':'queued',message:paused?'该音源已暂停，点继续后重试':'等待下载',folderKey:folder.key,folderName:folder.name,target};
    state.queue.push(item);renderQueue();await persistQueue();toast('已加入队列：'+song.title);void runQueue();
  }catch(caught){const error=toError(caught);if(folder&&target==='device'){recordDirectoryError(folder,error,true);updateFolderUI();}if(error.name!=='AbortError')toast(errorMessage(error));}
}
function renderQueue(){
  cancelAnimationFrame(queueFrame);queueFrame=0;queueView=undefined;
  const list=$('queue-list');list.replaceChildren();$('queue-count').textContent=String(state.queue.length);$('queue-empty').hidden=!!state.queue.length;$('clear-finished').hidden=!state.queue.some(q=>q.status==='done');
  for(const item of state.queue){
    const row=el('article','queue-item'),message=el('small','queue-state',item.message);
    row.dataset.state=item.status;row.append(el('strong','',item.title),el('small','',sourceInfo(item.source).name+' · '+(item.target==='local'?'本地':'设备')+' · '+item.folderName),message);
    if(item.status==='running'){const progress=el('progress');progress.max=1;if(item.progress!==undefined)progress.value=item.progress;queueView={item,message,progress};row.append(progress);row.append(button('取消','',()=>item.controller?.abort()));}
    else if(['paused','error'].includes(item.status))row.append(button('重试 / 继续','',()=>resumeItem(item)));
    if(item.status!=='running')row.append(button('移除','',()=>{state.queue=state.queue.filter(q=>q!==item);persistQueue();renderQueue();}));list.append(row);
  }
}
function queueStatus(item: QueueItem,text: string,progress?: number){
  item.message=text;item.progress=progress;
  if(queueFrame)return;
  queueFrame=requestAnimationFrame(()=>{
    queueFrame=0;const view=queueView;if(view?.item!==item)return;
    view.message.textContent=item.message;
    if(item.progress===undefined)view.progress.removeAttribute('value');else view.progress.value=item.progress;
  });
}
async function saveDownload(track: Detail,blob: Blob,duration: number,item: QueueItem){
  item.controller!.signal.throwIfAborted();
  const folder=queueFolder(item);if(!folder)throw new Error('保存目录已移除，请重新选择原目录。');
    const {name,file}=await commitMP3(folder.handle,blob,track.title,track.artist,item.controller!.signal),tags=await readTags(file);
    const entry={key:folder.key+'/'+name,folderKey:folder.key,path:name,source:track.source,sourceId:track.id,title:tags.title||track.title,artist:tags.artist||track.artist,album:tags.album||track.album||'',coverBlob:tags.coverBlob||null,cover:track.cover,size:file.size,modified:file.lastModified,duration};
    // A metadata failure must never erase an audio file that was already committed.
    state.tracks.push(entry);directoryStatus.set(folder.key,'ready');try{await saveTrack(entry);}catch{toast('歌曲已保存；曲库记录未保存，可重新扫描。');}renderLibrary();renderDevices();return name;
}
async function runQueue(){
  if(!state.ready||state.running||state.previewBusy||state.scanning||state.selecting)return;
  const item=state.queue.find(q=>q.status==='queued'&&!state.haltedSources.has(q.source));if(!item)return;
  const folder=queueFolder(item);
  if(!folder){item.status='paused';item.message='请重新选择目录：'+item.folderName;renderQueue();await persistQueue();return runQueue();}
  state.running=true;item.status='running';item.controller=new AbortController();updateFolderUI();renderQueue();await persistQueue();
  try{
    if(!await folderAllowed(folder.handle))throw new P.SourceError('FOLDER_PERMISSION','请点任务的“重试 / 继续”重新授权保存目录。');
    const signal=item.controller!.signal;queueStatus(item,'正在获取普通音质 MP3 播放源');
    const key=sourceKey(item),cached=playbackCache.get(key);let track: Detail,url: string;
    if(cached&&Date.now()-cached.at<120000){track=cached.track;url=cached.url;}
    else{
      track=await getDetail(item);signal.throwIfAborted();
      if(track.type===1)throw new P.SourceError('RESTRICTED','此版本受限，未下载。请选择其他版本。');
      try{url=await resolveTrack(track);}catch(caught){const error=toError(caught);if(error.code!=='PARSE_FAILED')throw error;track=await getDetail(item);if(track.type===1)throw error;url=await resolveTrack(track);}
      playbackCache.set(key,{track,url,at:Date.now()});
    }
    signal.throwIfAborted();url=await allowMedia(url);signal.throwIfAborted();queueStatus(item,'正在下载 MP3',0);
    const downloadProgress=(loaded: number,total: number)=>queueStatus(item,'已下载 '+formatSize(loaded)+(total?' / '+formatSize(total):''),total?loaded/total:undefined);
    let blob: Blob;
    try{blob=await fetchMP3(url,downloadProgress,signal);}catch(caught){const error=toError(caught);if(error.code!=='MEDIA_EXPIRED')throw error;playbackCache.delete(key);track=await getDetail(item);if(track.type===1)throw error;url=await allowMedia(await resolveTrack(track));blob=await fetchMP3(url,downloadProgress,signal);}
    signal.throwIfAborted();queueStatus(item,'正在校验音频');const duration=await validateMP3(blob,P.seconds(track.duration));signal.throwIfAborted();queueStatus(item,'正在保存到目录');
    const name=await saveDownload(track,blob,duration,item);item.status='done';item.message='已保存：'+name;delete item.progress;

  }catch(caught){const error=toError(caught);
    item.status=['AbortError','NoModificationAllowedError'].includes(error.name)||['FOLDER_PERMISSION','CANCELLED'].includes(error.code)?'paused':'error';item.message=error.name==='AbortError'&&directoryStatus.get(folder.key)==='unavailable'?'设备已断开，请重新连接后继续。':errorMessage(error);
    if(error.name==='NoModificationAllowedError')for(const next of state.queue)if(next.folderKey===folder.key&&next.status==='queued'){next.status='paused';next.message='保存目录暂不可写，请确认设备可正常传歌后再继续。';}
    if(item.target!=='local'){
      recordDirectoryError(folder,error,true);
      if(['NotFoundError','NotReadableError','InvalidStateError'].includes(error.name))await checkFolder(folder);
    }
    if(['QUOTA','RATE_LIMIT','VERIFY','BUSY'].includes(error.code)){state.haltedSources.add(item.source);for(const next of state.queue)if(next.source===item.source&&next.status==='queued'){next.status='paused';next.message='该音源队列已暂停，点继续后重试';}notice(error,{source:item.source,id:item.id});}
  }finally{delete item.controller;state.running=false;renderQueue();updateFolderUI();await persistQueue();void runQueue();}
}
async function resumeItem(item: QueueItem){
  if(state.running||state.previewBusy)return;
  const folder=queueFolder(item);if(!folder){toast('先重新选择原来的保存目录：'+item.folderName);return;}
  try{if(!await folderAllowed(folder.handle,true))throw new Error('需要允许读写音乐目录。');state.haltedSources.delete(item.source);item.status='queued';item.message='等待重新解析';hideNotice();renderQueue();await persistQueue();runQueue();}catch(caught){const error=toError(caught);toast(errorMessage(error));}
}

$('refresh-devices').addEventListener('click',()=>void refreshDevices());
$('rename-device').addEventListener('click',()=>{if(state.folder)manageDevice(state.folder);});
$('scan-device').addEventListener('click',async()=>{if(state.folder){await scanDevice(state.folder);await discovery.refresh();}});
$('open-device').addEventListener('click',()=>{const folder=state.folder;if(!folder)return;const device=deviceForFolder(folder);if(directoryStatus.get(folder.key)==='unavailable'&&device)void chooseFolder(device);else void selectDevice(folder);});
$('choose-directory').addEventListener('click',()=>{$('add-device-dialog').close();void chooseFolder();});
$('reselect-device').addEventListener('click',()=>{const folder=state.folders.find(folder=>folder.key===managedDeviceKey);$('device-dialog').close();void chooseFolder(folder?deviceForFolder(folder):undefined);});
$('change-local-folder').addEventListener('click',()=>void chooseLocalFolder());
$('device-form').addEventListener('submit',event=>{event.preventDefault();void renameDevice();});$('forget-device').addEventListener('click',()=>void forgetDevice());
$('library-filter').addEventListener('input',renderLibrary);
$('source-select').addEventListener('change',switchSource);
$('search-form').addEventListener('submit',event=>{event.preventDefault();search($('search-input').value);});$('load-more').addEventListener('click',()=>search(state.query,true));
$('player').addEventListener('ended',stopPlayer);$('player').addEventListener('error',()=>{if($('player').getAttribute('src')){stopPlayer();toast('音频播放失败，请重新播放或重新扫描目录。');}});
$('clear-finished').addEventListener('click',()=>{state.queue=state.queue.filter(q=>q.status!=='done');persistQueue();renderQueue();});
$('verify-button').addEventListener('click',()=>rpc('VERIFY',state.context).catch(error=>toast(errorMessage(error))));
$('captcha-refresh').addEventListener('click',()=>{if(captchaTask)void loadCaptcha(captchaTask);});$('captcha-cancel').addEventListener('click',()=>endCaptcha());$('captcha-dialog').addEventListener('cancel',event=>{event.preventDefault();endCaptcha();});
$('captcha-form').addEventListener('submit',event=>{event.preventDefault();if(captchaTask?.ready&&captchaTask.key&&P.clean($('captcha-input').value))endCaptcha({captchaCode:P.clean($('captcha-input').value),key:captchaTask.key});});
window.addEventListener('pagehide',()=>{discovery.stop();stopPlayer();cancelAnimationFrame(queueFrame);for(const key of coverURLs.keys())releaseCover(key);});

async function init(){
  try{
    const [folder,folders,localFolder,tracks,queue,history,selectedSource]=await Promise.all([setting<Folder>('folder'),setting<Folder[]>('folders'),setting<Folder>('localFolder'),allTracks(),setting<QueueItem[]>('queue'),setting<string[]>('history'),setting<SourceId>('musicSource')]);
    try{state.source=sourceId(selectedSource);}catch{state.source=DEFAULT_SOURCE;}
    const select=$('source-select');select.replaceChildren(...SOURCES.map(source=>{const option=el('option','',source.name);option.value=source.id;return option;}));select.value=state.source;state.context={source:state.source};
    state.folders=folders||[];if(folder&&!state.folders.some(f=>f.key===folder.key))state.folders.push(folder);
    state.folder=folder?state.folders.find(f=>f.key===folder.key)||null:state.folders[0]||null;state.localFolder=localFolder||null;
    const cachedTracks=tracks||[];
    state.tracks=cachedTracks.filter(track=>!isAppleDoublePath(track.path)).map(track=>track.sourceId?{...track,source:sourceId(track.source)}:track);
    // Remove previously indexed sidecars from IndexedDB only; leave device files intact.
    await updateTracks([],cachedTracks.filter(track=>isAppleDoublePath(track.path)).map(track=>track.key));
    state.history=history||[];state.queue=(queue||[]).map(q=>({...q,source:sourceId(q.source),status:q.status==='done'?'done':'paused',message:q.status==='done'?q.message:'页面已重新打开，点继续后重新解析'}));
    state.ready=true;select.disabled=false;updateFolderUI();renderLibrary();renderQueue();renderHistory();
    discovery.start();
  }catch(caught){const error=toError(caught);notice(new Error('本地曲库记录无法读取：'+errorMessage(error)));}
}
init();
