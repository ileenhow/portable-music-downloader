export class SourceError extends Error {
  constructor(public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message); this.name = 'SourceError';
  }
}
export function toError(value: unknown): SourceError {
  if (value instanceof SourceError) return value;
  const error = new SourceError('UNKNOWN', value instanceof Error ? value.message : '操作失败，请重试。');
  if (value instanceof Error) error.name = value.name;
  return error;
}
export function fileSystemMessage(value: unknown): string|undefined {
  const messages: Record<string,string>={
    NoModificationAllowedError:'当前目录无法写入。请确认设备的音乐存储区可在访达或文件管理器中正常传歌，再重新选择音乐目录；也可先下载到本地。',
    NotReadableError:'暂时无法读取文件或目录，请确认设备仍然连接，再重新选择音乐目录。',
    NotFoundError:'文件或目录已不可用，请重新连接设备并选择音乐目录。',
    NotAllowedError:'目录访问未获授权，请重新选择目录并允许本次操作。'
  };
  return messages[toError(value).name];
}
