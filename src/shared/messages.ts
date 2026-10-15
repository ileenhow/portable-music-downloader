import type { Detail, SourceResult, CaptchaAnswer } from './types';
import type { SourceId } from './sources';

export const CHANNEL = 'portable-library';
export const BRIDGE_CHANNEL = 'portable-library-provider';
export interface Actions {
  SEARCH: { args: { source: SourceId; query: string; cursor?: string }; data: { html: string } };
  DETAIL: { args: { source: SourceId; id: string }; data: Detail };
  RESOLVE: { args: { source: SourceId; id: string; playId: string; purpose: 'play' } & Partial<CaptchaAnswer>; data: { url: string } };
  CAPTCHA: { args: { source: SourceId; id: string }; data: SourceResult };
  CONVERT: { args: { source: SourceId; url: string }; data: { url: string } };
  VERIFY: { args: { source: SourceId; id?: string; query?: string }; data: boolean };
}
export type Message = { [A in keyof Actions]: { channel: typeof CHANNEL; action: A; args: Actions[A]['args'] } }[keyof Actions];
export type Reply<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } };
