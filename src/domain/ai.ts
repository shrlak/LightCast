import type { PrayerTopic } from './sunday/prayer';
import type { Announcement } from './sunday/announcements';

export interface AiServiceInfo {
  date: string;
  scripture: string;
  sermonTitle: string;
  preacher: string;
  confession: string;
}
export interface AiNotice extends AiServiceInfo {
  songs: { title: string; key: string }[];
  prayerTopics: PrayerTopic[];
  announcements: Announcement[];
}
export interface AiSlides {
  title: string;
  slides: { group: string; title: string; text: string; subtext: string }[];
}

async function post<T>(name: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/ai/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('Cannot reach the LightCast server (AI needs `npm run dev` or `npm start`).');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `AI request failed (${res.status})`);
  return data as T;
}

export interface AiRetreat {
  meetings: { name: string; songs: string[] }[];
  songs: { title: string; lyrics: string }[];
}

/** One model's count for the current period, as the church Worker reports it (GET /usage). */
export interface AiUsageModel {
  provider: string;
  model: string;
  period: 'day' | 'month';
  periodKey: string;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokens: number;
  used: number;
  limit: number | null;
  updatedAt: string | null;
}
export interface AiUsage {
  generatedAt: string;
  models: AiUsageModel[];
  via: string;
  /** This computer uses its own API keys, which the Worker does not count. */
  ownKeys: boolean;
}

export const ai = {
  usage: async (): Promise<AiUsage> => {
    const r = await fetch('/api/ai/usage');
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data as { error?: string }).error ?? `AI 사용량을 불러오지 못했습니다 (${r.status})`);
    return data as AiUsage;
  },
  retreat: (pages: { page: number; data: string; text: string }[]) => post<AiRetreat>('retreat', { pages }),
  status: () => fetch('/api/ai/status').then((r) => (r.ok ? r.json() as Promise<{ model: string; configured: boolean }> : null)).catch(() => null),
  notice: (text: string) => post<AiNotice>('notice', { text }),
  translate: (title: string, slides: { id: string; text: string }[], target = 'English') =>
    post<{ lines: { id: string; text: string }[] }>('translate', { title, slides, target }),
  assist: (prompt: string) => post<AiSlides>('assist', { prompt }),
};
