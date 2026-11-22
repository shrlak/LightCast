// Fonts a presentation uses that this computer does not have, found on the internet (server/fontFinder.mjs: Google
// Fonts, Fontsource, Pretendard) and kept like an imported font file. They are stored under the name the deck uses, so
// the deck draws in them at once, in every window (editor, audience / output, stage), and — synced like a font the
// person imported — on every computer signed in to the church server. Nothing here throws.
import { parseFontFile, type ParsedFont } from './fontFile';
import { keepParsedFonts, type ImportedFont } from './importedFonts';

/** The `source` of a font downloaded from the internet ("web:Google Fonts"). */
export const WEB_SOURCE_PREFIX = 'web:';
export const isWebSource = (source: string): boolean => source.startsWith(WEB_SOURCE_PREFIX);

export interface WebFontMatch {
  family: string;
  source: string;
  license: string;
  category: string;
  faces: { weight: number; italic: boolean }[];
}

export interface WebFontResult {
  /** The name the deck uses. */
  name: string;
  /** The family found on the internet (may differ: "나눔명조" → "Nanum Myeongjo"). */
  family?: string;
  source?: string;
  license?: string;
  added: ImportedFont[];
  /** Why nothing (or not every face) was kept. */
  reason?: string;
}

const AUTO_KEY = 'lightcast.webFonts.auto';
/** Find and download missing fonts by itself when a presentation opens (default on). */
export function loadAutoWebFonts(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; }
}
export function saveAutoWebFonts(on: boolean): void {
  try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* this window only */ }
}

const NO_SERVER = 'LightCast 서버에 연결할 수 없습니다 — 데스크톱 앱(또는 npm start)에서 사용해 주세요';

async function errorOf(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error ?? `HTTP ${res.status}`;
}

/** What the internet has for this font name (null match with a reason when nothing). */
export async function findWebFont(name: string): Promise<{ match: WebFontMatch | null; reason?: string }> {
  let res: Response;
  try { res = await fetch(`/api/fonts/find?family=${encodeURIComponent(name)}`); } catch { return { match: null, reason: NO_SERVER }; }
  if (!res.ok) return { match: null, reason: await errorOf(res) };
  const data = (await res.json().catch(() => null)) as { match?: WebFontMatch | null; reason?: string } | null;
  return { match: data?.match ?? null, reason: data?.reason ?? (data ? undefined : '응답을 읽지 못했습니다') };
}

/** A downloaded face, named as the deck names it (the file keeps its own name otherwise). */
export function asDeckFace(face: ParsedFont, deckName: string): ParsedFont {
  const name = deckName.trim();
  return name && face.family !== name ? { ...face, family: name } : face;
}

/** Find `name` on the internet, download its faces and keep them (registered in every window, synced to the church server). */
export async function fetchWebFont(name: string): Promise<WebFontResult> {
  const found = await findWebFont(name);
  if (!found.match) return { name, added: [], reason: found.reason ?? '인터넷에서 찾지 못했습니다.' };
  const m = found.match;
  const parsed: { face: ParsedFont; fileName: string }[] = [];
  const problems: string[] = [];
  for (const f of m.faces) {
    try {
      const res = await fetch(`/api/fonts/file?family=${encodeURIComponent(name)}&weight=${f.weight}&italic=${f.italic ? 1 : 0}`);
      if (!res.ok) { problems.push(await errorOf(res)); continue; }
      const ext = res.headers.get('x-font-format') === 'otf' ? 'otf' : 'ttf';
      const fileName = `${m.family}-${f.weight}${f.italic ? 'i' : ''}.${ext}`;
      const r = await parseFontFile(new Uint8Array(await res.arrayBuffer()), fileName);
      const face = r.faces[0];
      if (!face) { problems.push(r.error ?? '파일을 읽지 못했습니다'); continue; }
      parsed.push({ face: asDeckFace(face, name), fileName });
    } catch { problems.push(NO_SERVER); }
  }
  const base = { name, family: m.family, source: m.source, license: m.license };
  if (!parsed.length) return { ...base, added: [], reason: problems[0] ?? '내려받지 못했습니다.' };
  const report = await keepParsedFonts(parsed, `${WEB_SOURCE_PREFIX}${m.source}`);
  const reason = report.skipped[0]?.reason ?? problems[0];
  return { ...base, added: report.added, ...(reason ? { reason } : {}) };
}

/** Names already looked up in this window, so a font the internet does not have is not asked for on every edit. */
const tried = new Map<string, WebFontResult>();
const lower = (s: string) => s.trim().toLowerCase();
export const webFontTried = (name: string): WebFontResult | undefined => tried.get(lower(name));

/**
 * Fetch several missing fonts one after another. A name tried before in this window is skipped unless `again`.
 * `onProgress(done, total, name)` is called before each.
 */
export async function fetchMissingWebFonts(names: string[], opts: { again?: boolean; onProgress?: (done: number, total: number, name: string) => void } = {}): Promise<WebFontResult[]> {
  const todo = [...new Set(names.map((n) => n.trim()).filter(Boolean))].filter((n) => opts.again || !tried.has(lower(n)));
  const out: WebFontResult[] = [];
  for (const [i, name] of todo.entries()) {
    opts.onProgress?.(i, todo.length, name);
    const r = await fetchWebFont(name);
    tried.set(lower(name), r);
    out.push(r);
  }
  return out;
}

/** A one-line Korean summary for a notice. */
export function webFontSummary(results: WebFontResult[]): string {
  const got = results.filter((r) => r.added.length);
  const miss = results.filter((r) => !r.added.length);
  const label = (r: WebFontResult) => (r.family && lower(r.family) !== lower(r.name) ? `${r.name}(${r.family})` : r.name);
  const parts: string[] = [];
  if (got.length) {
    const sources = [...new Set(got.map((r) => r.source).filter(Boolean))].join(', ');
    parts.push(`인터넷에서 글꼴을 받아 추가했습니다: ${got.map(label).join(', ')}${sources ? ` — ${sources}` : ''}. 교회 서버에 로그인한 모든 컴퓨터에서도 쓸 수 있습니다.`);
  }
  if (miss.length) parts.push(`찾지 못함: ${miss.slice(0, 3).map((r) => `${r.name}${r.reason ? `(${r.reason})` : ''}`).join(', ')}${miss.length > 3 ? ` 외 ${miss.length - 3}개` : ''}`);
  return parts.join(' ') || '받을 글꼴이 없습니다.';
}
