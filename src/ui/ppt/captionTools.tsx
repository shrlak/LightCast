// Slide Show › 자막: the presenter's window listens (one app-wide speech service, see ../speechService) and sends the text;
// the audience window draws it as a band at the bottom.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { applyCaption, captionExpired, captionMessage, captionOffMessage, captionText, CAPTION_FADE_MS, CAPTION_LANGS, CAPTION_LINE_WIDTH, CAPTION_SIZES, emptyCaption, parseCaptionMessage, wrapCaption, type CaptionLang, type CaptionMessage, type CaptionSize, type CaptionState } from '../../domain/captions';
import { openLiveChannel } from '../../domain/sync';
import { CaptionTranslator, isTranslateLang, sameLanguage, bandLines, translatedText, translateStatusText, type TranslateLang, type TranslateStatus } from '../../domain/captionTranslate';
import { translateCaptionApi } from '../captionTranslateApi';
import { TranslateMenu } from './captionTranslateMenu';
import { PROVIDER_CHOICES, speechErrorMessage, speechStatusText } from '../../domain/speech/settings';
import { currentProvider, getCloudInfo, getSpeechSettings, refreshCloudInfo, setSpeechSettings, speechUnavailableReason, useCloudInfo, useSpeechSettings, useSpeechStatus } from '../speechService';
import { useSpeechRefs } from '../useSpeechRefs';
import { DropButton, Group, MenuItem, MenuSep } from './ribbonParts';

// ── Settings (shared by the ribbon, the presenter bar and the host) ──────────────────────────────
interface Settings { on: boolean; lang: CaptionLang; size: CaptionSize; lines: 1 | 2; trLang: TranslateLang | null; trOnly: boolean; trStatus: TranslateStatus }
const KEY = 'lightcast.captions';
const load = (): Settings => {
  const base: Settings = { on: false, lang: 'ko-KR', size: 'md', lines: 2, trLang: null, trOnly: false, trStatus: { state: 'off' } };
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...base, lang: getSpeechSettings().lang, size: o.size === 'sm' || o.size === 'lg' ? o.size : base.size, lines: o.lines === 1 ? 1 : base.lines, trLang: isTranslateLang(o.trLang) ? o.trLang : null, trOnly: o.trOnly === true };
  } catch { return base; }
};
let settings = load();
const subs = new Set<() => void>();
const update = (patch: Partial<Settings>) => {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify({ lang: settings.lang, size: settings.size, lines: settings.lines, trLang: settings.trLang, trOnly: settings.trOnly })); } catch { /* not saved */ }
  subs.forEach((f) => f());
};
export const useCaptionSettings = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => settings);

/** Turn captions on or off. When speech recognition is missing it says why instead of switching on. */
export function toggleCaptions(notify: (msg: string) => void) {
  if (settings.on) { update({ on: false }); return; }
  // Whether the cloud provider is configured is asked of the server once; the answer decides what can run.
  if (getCloudInfo() === null) { void refreshCloudInfo().then(() => toggleCaptions(notify)); return; }
  const reason = speechUnavailableReason();
  if (reason) { notify(reason); return; }
  update({ on: true });
}

let channel: ReturnType<typeof openLiveChannel> | null = null;
const send = (m: CaptionMessage) => { try { (channel ??= openLiveChannel(() => undefined)).post(m); } catch { /* no audience window */ } };

// ── Presenter: listen and send ───────────────────────────────────────────────────────────────────
/** Mounted once in the presenter view. Restarts itself when the browser stops listening (the hook does it). */
export function CaptionHost() {
  return <CaptionListener />;
}

function CaptionListener() {
  const s = useCaptionSettings();
  const state = useRef<CaptionState>(emptyCaption());
  const sentOff = useRef(true);
  const cfg = useRef(s);
  cfg.current = s;
  const lastFinal = useRef(false);
  const resend = useRef<() => void>(() => undefined);
  // The translated second line (see ../../domain/captionTranslate): finals in order, interim throttled.
  const translator = useRef<CaptionTranslator | null>(null);
  translator.current ??= new CaptionTranslator({ translate: translateCaptionApi, onChange: (_t, st) => { update({ trStatus: st }); resend.current(); } });
  const push = (final: boolean) => {
    const text = captionText(state.current);
    if (!text) return;
    lastFinal.current = final;
    sentOff.current = false;
    const c = cfg.current;
    send(captionMessage(text, final, c.size, c.lines, c.trLang ? translatedText(translator.current!.current) : undefined, c.trOnly));
  };
  resend.current = () => { if (cfg.current.on && !sentOff.current) push(lastFinal.current); };
  const target = s.on && s.trLang && !sameLanguage(s.lang, s.trLang) ? s.trLang : null;
  useEffect(() => { translator.current?.setTarget(target); if (!target) update({ trStatus: { state: 'off' } }); }, [target]);
  useEffect(() => () => translator.current?.dispose(), []);
  const speech = useSpeechRefs(() => undefined, undefined, (text, final) => {
    const now = Date.now();
    if (captionExpired(state.current, now)) translator.current?.reset();
    state.current = applyCaption(state.current, text, final, now);
    if (final) translator.current?.pushFinal(text); else translator.current?.pushInterim(text);
    push(final);
  });
  const { start, stop } = speech;
  useEffect(() => {
    if (s.on) start(); else { stop(); state.current = emptyCaption(); if (!sentOff.current) { sentOff.current = true; send(captionOffMessage()); } }
  }, [s.on, start, stop]);
  // The recognizer gave up (microphone blocked…): the switch goes back off so it shows the truth.
  useEffect(() => { if (s.on && speech.error && !speech.listening) update({ on: false }); }, [s.on, speech.error, speech.listening]);
  // After a pause the band fades on the audience screen.
  useEffect(() => {
    if (!s.on) return undefined;
    const t = setInterval(() => {
      if (!sentOff.current && captionExpired(state.current, Date.now())) { sentOff.current = true; state.current = emptyCaption(); translator.current?.reset(); send(captionOffMessage()); }
    }, 500);
    return () => clearInterval(t);
  }, [s.on]);
  useEffect(() => () => send(captionOffMessage()), []);
  const status = useSpeechStatus();
  const shown = s.on && status.state === 'error' && status.error ? speechErrorMessage(status.error) : speech.error;
  const trError = s.on && s.trStatus.state === 'error' ? translateStatusText(s.trStatus) : null;
  return <>
    {shown && <span className="caption-error" role="alert">{shown}</span>}
    {trError && <span className="caption-error" role="status">{trError}</span>}
  </>;
}

// ── Controls ─────────────────────────────────────────────────────────────────────────────────────
const mark = (on: boolean, label: string) => `${on ? '✓ ' : '  '}${label}`;

function CaptionMenu({ close }: { close: () => void }) {
  const s = useCaptionSettings();
  const sp = useSpeechSettings();
  const status = useSpeechStatus();
  useCloudInfo();
  return (
    <>
      <MenuItem label={`상태: ${speechStatusText(status, currentProvider())}`} onClick={close} />
      {PROVIDER_CHOICES.map((p) => <MenuItem key={p.id} label={mark(sp.provider === p.id, `음성 인식: ${p.label}`)} onClick={() => { setSpeechSettings({ provider: p.id }); close(); }} />)}
      <MenuSep />
      {CAPTION_LANGS.map((l) => <MenuItem key={l.id} label={mark(sp.lang === l.id, `언어: ${l.label}`)} onClick={() => { update({ lang: l.id }); setSpeechSettings({ lang: l.id }); close(); }} />)}
      <MenuSep />
      <TranslateMenu lang={s.trLang} only={s.trOnly} status={s.trStatus} set={update} close={close} />
      {CAPTION_SIZES.map((z) => <MenuItem key={z.id} label={mark(s.size === z.id, `글자 크기: ${z.label}`)} onClick={() => { update({ size: z.id }); close(); }} />)}
      <MenuSep />
      <MenuItem label={mark(s.lines === 1, '한 줄만 표시')} onClick={() => { update({ lines: 1 }); close(); }} />
      <MenuItem label={mark(s.lines === 2, '두 줄 표시')} onClick={() => { update({ lines: 2 }); close(); }} />
    </>
  );
}

/** 슬라이드 쇼 ribbon group. */
export function CaptionsGroup({ notify }: { notify: (msg: string) => void }) {
  const s = useCaptionSettings();
  return (
    <Group label="자막">
      <DropButton big icon="💬" label={s.on ? '자막 끄기' : '자막 켜기'} title="말하는 내용을 글자로 바꿔 청중 화면 아래에 보여 줍니다 (마이크 필요)" active={s.on} render={(close) => (
        <>
          <MenuItem label={s.on ? '자막 끄기' : '자막 켜기'} onClick={() => { close(); toggleCaptions(notify); }} />
          <MenuSep />
          <CaptionMenu close={close} />
        </>
      )} />
    </Group>
  );
}

/** Button for the presenter's top bar, like the laser toggle. */
export function CaptionToggle({ notify }: { notify: (msg: string) => void }) {
  const s = useCaptionSettings();
  return <button type="button" className={s.on ? 'on' : ''} aria-pressed={s.on} title="말하는 내용을 청중 화면 아래에 자막으로 보여 줍니다 (마이크 필요)" onClick={() => toggleCaptions(notify)}>💬 자막 {s.on ? '끄기' : '켜기'}</button>;
}

// ── Audience: draw the band ──────────────────────────────────────────────────────────────────────
/** Captions from the presenter, same computer (channel) or other devices (relay event). Null when nothing to show. */
export function useCaption(): { lines: string[]; trLines: string[]; size: CaptionSize } | null {
  const [cap, setCap] = useState<{ text: string; tr: string; trOnly: boolean; size: CaptionSize; lines: 1 | 2; at: number } | null>(null);
  useEffect(() => {
    const got = (raw: unknown) => {
      const m = parseCaptionMessage(raw);
      if (!m) return;
      setCap('off' in m ? null : { text: m.text, tr: m.tr ?? '', trOnly: m.trOnly === true, size: m.size, lines: m.lines, at: Date.now() });
    };
    const ch = openLiveChannel((m) => { if (m.type === 'caption') got(m); });
    const net = (e: Event) => got((e as CustomEvent).detail);
    window.addEventListener('lightcast:caption', net);
    return () => { ch.close(); window.removeEventListener('lightcast:caption', net); };
  }, []);
  // Fade out after a pause (also covers a lost "off" message).
  useEffect(() => {
    if (!cap) return undefined;
    const t = setTimeout(() => setCap(null), Math.max(0, CAPTION_FADE_MS + 300 - (Date.now() - cap.at)));
    return () => clearTimeout(t);
  }, [cap]);
  if (!cap) return null;
  const shown = bandLines(cap.text, cap.tr, cap.trOnly);
  const width = CAPTION_LINE_WIDTH[cap.size];
  const lines = wrapCaption(shown.original, width, cap.lines);
  const trLines = wrapCaption(shown.translation, width, cap.lines);
  return lines.length || trLines.length ? { lines, trLines, size: cap.size } : null;
}

export function CaptionBand() {
  const cap = useCaption();
  if (!cap) return null;
  const vw = CAPTION_SIZES.find((z) => z.id === cap.size)?.vw ?? 3;
  return (
    <div className="caption-band" role="status" aria-live="off" style={{ fontSize: `${vw}vw` }}>
      {cap.lines.map((l, i) => <div key={i}>{l}</div>)}
      {cap.trLines.map((l, i) => <div key={`t${i}`} className="caption-tr">{l}</div>)}
    </div>
  );
}
