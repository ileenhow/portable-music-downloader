import type { SourceId } from './sources';
export interface DisplayTrack {
  title: string; artist: string; cover: string; album?: string;
  duration?: string | number; key?: string; coverBlob?: Blob | null;
}
export interface Song extends DisplayTrack { source: SourceId; id: string; duration: string }
export interface Detail extends Song { playId: string; type: number; hasCloudLinks: boolean }
export interface LocalTrack extends DisplayTrack {
  key: string; folderKey: string; path: string; size: number; modified: number; sourceId?: string; source?: SourceId;
}
export interface Folder {
  key: string; name: string; handle: FileSystemDirectoryHandle;
  storage?: { name: string; capacity: number };
}
export interface QueueItem {
  source: SourceId; id: string; title: string; artist: string; folderKey: string; folderName: string;
  target?: 'local' | 'device';
  status: 'queued' | 'running' | 'paused' | 'error' | 'done'; message: string;
  progress?: number; controller?: AbortController;
}
export interface SourceResult {
  code: number; msg?: string;
  data?: { url?: string; reason?: string; img?: string; key?: string };
}
export interface SearchResult { items: Song[]; total: number; next: string; query: string }
export interface CaptchaAnswer { captchaCode: string; key: string }
export interface ProviderResponse { ok: boolean; status: number; body: string; type: string; error?: string }
export interface CaptchaTask {
  source: SourceId; id: string; key?: string; ready: boolean;
  resolve: (answer: CaptchaAnswer) => void; reject: (error: Error) => void;
}
