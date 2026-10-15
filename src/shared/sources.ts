import { SourceError } from './errors';

export const SOURCES = [
  {id:'gequbao',name:'歌曲宝',origin:'https://www.gequbao.com'},
  {id:'gequhai',name:'歌曲海',origin:'https://www.gequhai.com'}
] as const;
export type SourceId = typeof SOURCES[number]['id'];
export const DEFAULT_SOURCE: SourceId = 'gequbao';
export function sourceId(value: unknown): SourceId {
  if(value===undefined)return DEFAULT_SOURCE; // Records made by 0.1.0 have no source.
  const source=SOURCES.find(source=>source.id===value);
  if(!source)throw new SourceError('BAD_SOURCE','此音乐来源暂不支持，请重新选择。');
  return source.id;
}
export function sourceInfo(value: unknown){return SOURCES.find(source=>source.id===sourceId(value))!;}
export function sourceKey(track: {source?: SourceId; id: string}){return sourceId(track.source)+':'+track.id;}
