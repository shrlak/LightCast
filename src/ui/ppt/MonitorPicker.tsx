// 쇼 설정 › 여러 모니터: which monitor shows the slide show to the audience and which the presenter view.
import { useState } from 'react';
import { resolveMonitors } from '../../domain/monitors';
import { applyChoiceToDesktop, requestScreenDetails, useMonitorChoice, useMonitors } from '../useMonitors';
import { desktop } from '../../domain/desktop';
import type { Ed } from './editor';

export function MonitorPicker({ ed }: { ed: Ed }) {
  const { monitors, canList } = useMonitors((n) => ed.cmd.notify(n));
  const [choice, setChoice] = useMonitorChoice();
  const [asked, setAsked] = useState(false);
  const resolved = resolveMonitors(monitors, choice);
  const update = (next: typeof choice) => { setChoice(next); applyChoiceToDesktop(monitors, next); };
  const opts = (
    <>
      <option value="">자동</option>
      {monitors.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
    </>
  );
  if (!canList && !desktop) {
    return <p className="dlg-note">이 브라우저는 모니터 목록을 읽을 수 없습니다. 쇼 창을 원하는 모니터로 끌어 놓고 전체 화면(F11)으로 보세요.</p>;
  }
  if (!desktop && !monitors.length) {
    return (
      <div className="dlg-row">
        <button type="button" disabled={asked} onClick={() => { setAsked(true); void requestScreenDetails().then(() => setAsked(false)); }}>모니터 목록 허용…</button>
        <span className="dlg-note">브라우저가 여러 모니터 정보를 읽도록 허용하면 고를 수 있습니다.</span>
      </div>
    );
  }
  return (
    <>
      <label>청중 화면 (슬라이드 쇼)
        <select value={choice.audience ?? ''} disabled={monitors.length < 2} onChange={(e) => update({ ...choice, audience: e.target.value || null })}>{opts}</select>
      </label>
      <label>발표자 보기
        <select value={choice.presenter ?? ''} disabled={monitors.length < 2} onChange={(e) => update({ ...choice, presenter: e.target.value || null })}>{opts}</select>
      </label>
      <p className="dlg-note">
        {monitors.length < 2 ? '모니터가 하나입니다. 프로젝터나 TV를 연결하면 여기서 고를 수 있습니다.'
          : `지금 설정: 청중 화면 → ${resolved.audience?.label ?? '자동'} · 발표자 보기 → ${resolved.presenter?.label ?? '자동'}. 선택은 기억되고, 모니터를 연결하거나 뺄 때 알려 드립니다.`}
      </p>
      {resolved.notes.map((n) => <p key={n} className="dlg-note warn">{n}</p>)}
      <button type="button" onClick={() => { ed.cmd.open('settings'); }}>출력 화면 설정…</button>
    </>
  );
}
