import { useEffect, useRef, useState } from 'react';
import { CURRENT_SCENE, formatDb, SCENE_ADDRESS, sceneName, scribbleColor, shortName, stripAddress, X32_STRIPS, type X32Strip } from '../domain/x32';
import { desktop } from '../domain/desktop';
import { Fader, faderKey, LitButton } from './X32Controls';
import { useX32, x32 } from './x32';
import { X32StripModal } from './X32StripModal';

const SCENES = Array.from({ length: 100 }, (_, i) => i);
const num = (id: string) => Number(id.split('/')[1]);
/** Sections of the surface, in console order. */
const SECTIONS: { id: string; label: string; strips: (s: X32Strip) => boolean }[] = [
  { id: 'ch', label: 'INPUT 1-32', strips: (s) => s.kind === 'ch' },
  { id: 'aux', label: 'AUX IN 1-8', strips: (s) => s.kind === 'auxin' },
  { id: 'fx', label: 'FX RETURN 1-8', strips: (s) => s.kind === 'fxrtn' },
  { id: 'bus', label: 'BUS 1-16', strips: (s) => s.kind === 'bus' },
  { id: 'mtx', label: 'MATRIX 1-6', strips: (s) => s.kind === 'mtx' },
  { id: 'dca', label: 'DCA 1-8', strips: (s) => s.kind === 'dca' },
  { id: 'main', label: 'MAIN', strips: (s) => s.id === 'main/m' },
];
/** Layer buttons: everything at once, or one bank like the console's layer keys. */
const LAYERS: { id: string; label: string; strips: (s: X32Strip) => boolean }[] = [
  { id: 'all', label: 'ALL', strips: () => true },
  { id: 'ch1', label: 'CH 1-16', strips: (s) => s.kind === 'ch' && num(s.id) <= 16 },
  { id: 'ch17', label: 'CH 17-32', strips: (s) => s.kind === 'ch' && num(s.id) > 16 },
  { id: 'aux', label: 'AUX · FX', strips: (s) => s.kind === 'auxin' || s.kind === 'fxrtn' },
  { id: 'bus', label: 'BUS 1-16', strips: (s) => s.kind === 'bus' },
  { id: 'mtx', label: 'MTX · DCA', strips: (s) => s.kind === 'mtx' || s.kind === 'dca' || s.id === 'main/m' },
];
const MAIN = X32_STRIPS.find((s) => s.id === 'main/st')!;

/** One channel strip of the surface: SEL, scribble strip, MUTE, fader. */
function Strip({ strip, selected, active, onSelect, onActivate, master }: {
  strip: X32Strip; selected: boolean; active: boolean; onSelect: () => void; onActivate: () => void; master?: boolean;
}) {
  const mixer = useX32();
  const v = mixer.values;
  const onAddr = stripAddress(strip.id, 'on');
  const faderAddr = stripAddress(strip.id, 'fader');
  const muted = v[onAddr] === 0;
  const fader = typeof v[faderAddr] === 'number' ? (v[faderAddr] as number) : 0;
  const name = shortName(strip.id, v);
  const scribble = scribbleColor(strip.id, v);
  const main = strip.kind === 'main';
  return (
    <div className={`x32-strip ${master ? 'master' : ''} ${selected ? 'selected' : ''} ${active ? 'active' : ''}`} data-strip={strip.id} onPointerDown={onActivate}>
      <LitButton tone="green" on={selected} onClick={onSelect} title={strip.kind === 'dca' ? 'DCA는 페이더 · 뮤트만 있습니다' : '게인 · 로우 컷 · 게이트 · 컴프레서 · EQ · 센드 (Enter)'} disabled={strip.kind === 'dca'}>SEL</LitButton>
      <div className="x32-scribble" style={{ background: main ? '#f1f5f9' : scribble.background, color: main ? '#0b0c0f' : scribble.color }} title={`${strip.label} ${name}`}>
        <small>{strip.label}</small>
        <b>{name === strip.label ? '' : name}</b>
      </div>
      <LitButton tone="red" on={muted} title="뮤트 (M)" onClick={() => x32.set(onAddr, muted ? 1 : 0)}>MUTE</LitButton>
      <Fader value={fader} label={`${strip.label} ${name} 페이더`} readout={formatDb(fader)} onChange={(f) => x32.setSoon(faderAddr, f)} />
      <span className="x32-readout">{formatDb(fader).replace(' dB', '')}</span>
    </div>
  );
}

/**
 * The X32 surface: every fader of the console (inputs 1-32, aux in, FX returns, buses, matrices, DCAs,
 * main), layer buttons, scene recall, SEL for a strip's processing, and arrow keys for the selected strip.
 */
export function MixerPanel() {
  const mixer = useX32();
  const [layer, setLayer] = useState('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [active, setActive] = useState('ch/01');
  const current = mixer.values[CURRENT_SCENE];
  const [scene, setScene] = useState<number>(typeof current === 'number' ? current : 0);
  // The scene list starts on the mixer's current scene once it is known (and follows recalls).
  useEffect(() => { if (typeof current === 'number') setScene(current); }, [current]);
  const surface = useRef<HTMLDivElement>(null);

  const filter = LAYERS.find((l) => l.id === layer)!.strips;
  const sections = SECTIONS.map((sec) => ({ ...sec, list: X32_STRIPS.filter((s) => sec.strips(s) && filter(s)) })).filter((sec) => sec.list.length);
  const order = [...sections.flatMap((sec) => sec.list), MAIN].map((s) => s.id);

  // Console-wide keys for the selected strip: ←/→ choose a strip, ↑/↓ move its fader by 1 dB
  // (Shift: 5 dB), M mutes, Enter opens SEL. Typing in a box, and knobs/faders with focus, keep their keys.
  const latest = useRef({ active, order, editing });
  latest.current = { active, order, editing };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { active: id, order: ids, editing: open } = latest.current;
      const t = e.target as HTMLElement | null;
      if (open || e.metaKey || e.ctrlKey || e.altKey || t?.closest('input, select, textarea, [role="slider"]')) return;
      if (x32.state.status !== 'connected') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = ids.indexOf(id);
        const next = ids[Math.max(0, Math.min(ids.length - 1, (i < 0 ? 0 : i) + (e.key === 'ArrowLeft' ? -1 : 1)))];
        setActive(next);
        surface.current?.querySelector(`[data-strip="${next}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        e.preventDefault();
        return;
      }
      const faderAddr = stripAddress(id, 'fader');
      const value = x32.state.values[faderAddr];
      const next = faderKey(e.key, e.shiftKey, typeof value === 'number' ? value : 0);
      if (next != null && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key.startsWith('Page'))) {
        x32.setSoon(faderAddr, next);
        e.preventDefault();
      } else if (e.key === 'm' || e.key === 'M') {
        const onAddr = stripAddress(id, 'on');
        x32.set(onAddr, x32.state.values[onAddr] === 0 ? 1 : 0);
        e.preventDefault();
      } else if (e.key === 'Enter' && !id.startsWith('dca/')) {
        setEditing(id);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (mixer.status !== 'connected') {
    return (
      <div className="stack x32-offline">
        <p className="muted small">{mixer.status === 'unavailable' ? 'X32 믹서 조작은 LightCast 데스크톱 앱에서 됩니다.' : mixer.status === 'off' ? 'X32 믹서가 연결되어 있지 않습니다.' : mixer.status === 'lost' ? `X32 응답 없음 · ${mixer.ip ?? ''} — 다시 연결하는 중…` : 'X32에 연결하는 중…'}</p>
        <p className="hint">LightCast 콘솔의 ⚙ 설정 → 장비 · 연결 → Behringer X32 믹서에서 연결하세요.</p>
      </div>
    );
  }

  const strip = (s: X32Strip, master?: boolean) => (
    <Strip key={s.id} strip={s} master={master} active={active === s.id} selected={editing === s.id}
      onActivate={() => setActive(s.id)} onSelect={() => setEditing(editing === s.id ? null : s.id)} />
  );

  return (
    <div className="x32-console">
      <div className="x32-topbar">
        <span className="x32-led on" aria-hidden />
        <strong className="x32-lcd">X32 · {mixer.name ?? mixer.ip}{typeof current === 'number' ? ` · 장면 ${sceneName(current, mixer.values)}` : ''}</strong>
        <select className="x32-select" aria-label="장면" value={scene} onChange={(e) => setScene(Number(e.target.value))}>
          {SCENES.map((n) => <option key={n} value={n}>{sceneName(n, mixer.values)}</option>)}
        </select>
        <button type="button" className="x32-btn yellow" onClick={() => { if (confirm(`X32 장면 ${sceneName(scene, mixer.values)}을(를) 불러올까요? 믹서 설정이 그 장면으로 바뀝니다.`)) x32.set(SCENE_ADDRESS, scene); }}>GO 장면</button>
      </div>
      {mixer.error && <p className="warn small">{mixer.error}</p>}
      <div className="x32-layers" role="tablist" aria-label="페이더 레이어">
        {LAYERS.map((l) => <button key={l.id} type="button" role="tab" aria-selected={l.id === layer} className={`x32-btn ${l.id === layer ? 'lit' : ''} blue`} onClick={() => setLayer(l.id)}>{l.label}</button>)}
        <span className="x32-keys">←/→ 채널 선택 · ↑/↓ 페이더 1 dB (Shift 5 dB) · M 뮤트 · Enter SEL</span>
      </div>
      <div className="x32-surface" ref={surface}>
        <div className="x32-sections">
          {sections.map((sec) => (
            <section key={sec.id} className="x32-section-bank" aria-label={sec.label}>
              <h5>{sec.label}</h5>
              <div className="x32-bank">{sec.list.map((s) => strip(s))}</div>
            </section>
          ))}
        </div>
        <section className="x32-section-bank master" aria-label="Main LR">
          <h5>MAIN LR</h5>
          {strip(MAIN, true)}
        </section>
      </div>
      {editing && <X32StripModal stripId={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Open the mixer in its own window — in the desktop app it floats above everything else. */
export function openMixerWindow() {
  const url = `${location.origin}${location.pathname}?view=mixer`;
  if (desktop) desktop.openView(url);
  else window.open(url, 'freecast-mixer', 'popup,width=1280,height=720');
}
