import type { LocalTrack } from './types';
const DB_NAME='portable-library', VERSION=1;
let dbPromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,VERSION);
    request.onupgradeneeded=()=>{request.result.createObjectStore('settings');request.result.createObjectStore('tracks',{keyPath:'key'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  return dbPromise;
}
async function request<T>(store: string,mode: IDBTransactionMode,operation: (store: IDBObjectStore)=>IDBRequest|void): Promise<T> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,mode);
    let value: T;
    tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存中断。'));
    try{const result=operation(tx.objectStore(store));if(result)result.onsuccess=()=>{value=result.result as T;};}
    catch(error){tx.abort();reject(error);}
  });
}
export const setting=<T>(key: string)=>request<T|undefined>('settings','readonly',s=>s.get(key));
export const saveSetting=(key: string,value: unknown)=>request<void>('settings','readwrite',s=>s.put(value,key));
export const allTracks=()=>request<LocalTrack[]>('tracks','readonly',s=>s.getAll());
export const saveTrack=(track: LocalTrack)=>request<void>('tracks','readwrite',s=>s.put(track));
export const removeTrack=(key: string)=>request<void>('tracks','readwrite',s=>s.delete(key));
// Enqueue every write synchronously in one transaction; an await would make it inactive.
export function updateTracks(tracks: LocalTrack[],removed: string[]=[]): Promise<void> {
  if(!tracks.length&&!removed.length)return Promise.resolve();
  return request<void>('tracks','readwrite',store=>{
    for(const track of tracks)store.put(track);
    for(const key of removed)store.delete(key);
  });
}
