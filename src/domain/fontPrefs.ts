// Font-sync settings that follow the account: the global switches and each font's own switch, as one small
// object in the library (`Library.fontPrefs`). Each entry carries the time it was changed; the later change
// wins (last writer wins), so two computers that flip the same switch end up with the same value. Pure logic.

export interface FontPrefs {
  global?: { enabled: boolean; includeDeckFonts: boolean; at: number };
  /** Per font file (the SHA-256 hash): `sync` true / false, or null = back to automatic. */
  fonts?: Record<string, { sync: boolean | null; at: number }>;
}

/** At most this many per-font entries are kept (the newest). */
export const MAX_FONT_PREFS = 400;

/** What this computer holds: the global settings (with the time of the last change; 0 = never changed) and each font's own switch. */
export interface LocalPrefs {
  global: { enabled: boolean; includeDeckFonts: boolean; at?: number };
  fonts: { hash?: string; sync?: boolean; syncAt?: number }[];
}

export interface PrefsResult {
  /** The settings object for the library (undefined = nothing to keep). */
  prefs: FontPrefs | undefined;
  /** The global settings to use from now on, and whether they came from the account (then save them here). */
  global: { enabled: boolean; includeDeckFonts: boolean; at: number };
  globalFromAccount: boolean;
  /** Per-font switches the account decided that this computer must take over. */
  apply: { hash: string; sync: boolean | undefined; at: number }[];
  /** This computer's newer switches went into the object (push it). */
  changed: boolean;
}

function trim(fonts: NonNullable<FontPrefs['fonts']>): NonNullable<FontPrefs['fonts']> {
  const keys = Object.keys(fonts);
  if (keys.length <= MAX_FONT_PREFS) return fonts;
  const keep = keys.sort((a, b) => fonts[b].at - fonts[a].at).slice(0, MAX_FONT_PREFS);
  return Object.fromEntries(keep.map((k) => [k, fonts[k]]));
}

/** Two copies of the settings object into one: for every switch the later change wins (ties keep `a`). */
export function mergePrefs(a: FontPrefs | undefined, b: FontPrefs | undefined): FontPrefs | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: FontPrefs = {};
  const g = a.global && b.global ? (b.global.at > a.global.at ? b.global : a.global) : a.global ?? b.global;
  if (g) out.global = g;
  const fonts: NonNullable<FontPrefs['fonts']> = { ...(a.fonts ?? {}) };
  for (const [k, v] of Object.entries(b.fonts ?? {})) if (!fonts[k] || v.at > fonts[k].at) fonts[k] = v;
  if (Object.keys(fonts).length) out.fonts = trim(fonts);
  return out.global || out.fonts ? out : undefined;
}

/** Compare this computer's switches with the account's and decide, switch by switch, who is newer. */
export function reconcilePrefs(local: LocalPrefs, account: FontPrefs | undefined): PrefsResult {
  const prefs: FontPrefs = { ...(account?.global ? { global: account.global } : {}), ...(account?.fonts ? { fonts: { ...account.fonts } } : {}) };
  let changed = false;
  const lg = { enabled: local.global.enabled, includeDeckFonts: local.global.includeDeckFonts, at: local.global.at ?? 0 };
  let global = lg;
  let globalFromAccount = false;
  const ag = account?.global;
  if (ag && ag.at > lg.at) { global = { ...ag }; globalFromAccount = true; }
  else if (lg.at > (ag?.at ?? 0)) { prefs.global = lg; changed = true; }
  const apply: PrefsResult['apply'] = [];
  const seen = new Set<string>();
  for (const f of local.fonts) {
    if (!f.hash || seen.has(f.hash)) continue;
    seen.add(f.hash);
    const lf = f.syncAt ?? 0;
    const af = account?.fonts?.[f.hash];
    if (af && af.at > lf) {
      const v = af.sync === null ? undefined : af.sync;
      apply.push({ hash: f.hash, sync: v, at: af.at });
    } else if (lf > (af?.at ?? 0)) {
      prefs.fonts = { ...(prefs.fonts ?? {}), [f.hash]: { sync: typeof f.sync === 'boolean' ? f.sync : null, at: lf } };
      changed = true;
    }
  }
  if (prefs.fonts) prefs.fonts = trim(prefs.fonts);
  const out = prefs.global || (prefs.fonts && Object.keys(prefs.fonts).length) ? prefs : undefined;
  return { prefs: out, global, globalFromAccount, apply, changed };
}
