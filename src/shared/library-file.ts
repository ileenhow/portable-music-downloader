import { safeFilename, uniqueName } from './audio';

/** Call after validating the complete audio; never commit a partial transfer. */
export async function commitMP3(directory: FileSystemDirectoryHandle,blob: Blob,title: string,artist: string,signal: AbortSignal): Promise<{name: string;file: File}> {
  signal.throwIfAborted();const name=await uniqueName(directory,safeFilename(title,artist));
  signal.throwIfAborted();const handle=await directory.getFileHandle(name,{create:true});
  // Another app may create a same-name file between enumeration and creation.
  if((await handle.getFile()).size!==0)throw new Error('同名文件刚被其他程序创建，请重试。');
  let writer: FileSystemWritableFileStream|undefined,committed=false;
  try{
    writer=await handle.createWritable();await writer.write(blob);signal.throwIfAborted();await writer.close();committed=true;
    return {name,file:await handle.getFile()};
  }catch(error){
    if(!committed){if(writer)await writer.abort().catch(()=>{});await directory.removeEntry(name).catch(()=>{});}
    throw error;
  }
}
