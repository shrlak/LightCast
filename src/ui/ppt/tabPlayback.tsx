// The 재생 (Playback) tab PowerPoint adds while an audio or video object is selected, after
// DeckCraft's ribbon/playback.rs: Play / Pause preview, Trim, fades, volume and the play options.
import { useEffect, useState } from 'react';
import type { MediaPlayback, SlideElement } from '../../domain/types';
import { VOLUME_STEPS, cleanPlayback, parseSeconds, secondsText } from '../../domain/mediaPlayback';
import type { Ed } from './editor';
import { Big, Col, DropButton, Group, MenuItem } from './ribbonParts';
import { playMedia } from './mediaControl';

/** A seconds box that keeps what is typed until it is left (Enter or blur), DeckCraft-style. */
function Seconds({ label, value, onSet, disabled }: { label: string; value: number | undefined; onSet: (s: number) => void; disabled?: boolean }) {
  const [text, setText] = useState(secondsText(value));
  useEffect(() => setText(secondsText(value)), [value]);
  const commit = () => onSet(parseSeconds(text));
  return (
    <label className="rb-range" title={`${label} (초)`}>{label}
      <input className="rb-secs" value={text} disabled={disabled} inputMode="decimal" onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} /> 초
    </label>
  );
}

export function PlaybackTab({ ed }: { ed: Ed }) {
  const el = ed.selEls.find((e) => e.kind === 'audio' || e.kind === 'video');
  const pb: MediaPlayback = el?.playback ?? {};
  const [playing, setPlaying] = useState(false);
  const setPb = (patch: Partial<MediaPlayback>) => {
    if (!el) return;
    ed.setElements((els) => els.map((e) => (e.id === el.id ? { ...e, playback: cleanPlayback({ ...(e.playback ?? {}), ...patch }) } : e)));
  };
  const check = (key: keyof MediaPlayback, label: string, title?: string, onlyVideo?: boolean) => (
    <label className="rb-check" title={title}><input type="checkbox" disabled={!el || !ed.canEdit || (onlyVideo && el.kind !== 'video')} checked={!!pb[key]} onChange={(e) => setPb({ [key]: e.target.checked || undefined })} /> {label}</label>
  );
  const toggle = (target: SlideElement) => {
    playMedia(target, ed.dispatch, playing ? 'pause' : 'play');
    setPlaying(!playing);
  };
  return (
    <>
      <Group label="미리 보기">
        <Big icon={playing ? '❚❚' : '▶'} label={playing ? '일시 중지' : '재생'} title="선택한 미디어를 미리 재생합니다" disabled={!el} onClick={() => el && toggle(el)} />
      </Group>
      <Group label="편집">
        <Big icon="✂" label={el?.kind === 'audio' ? '오디오 맞추기' : '비디오 트리밍'} title="시작·종료 시간과 페이드 (재생 옵션)" disabled={!el} onClick={() => ed.setDialog('audio')} />
        <Col>
          <Seconds label="페이드 인" value={pb.fadeIn} disabled={!el || !ed.canEdit} onSet={(s) => setPb({ fadeIn: s || undefined })} />
          <Seconds label="페이드 아웃" value={pb.fadeOut} disabled={!el || !ed.canEdit} onSet={(s) => setPb({ fadeOut: s || undefined })} />
        </Col>
      </Group>
      <Group label={el?.kind === 'video' ? '비디오 옵션' : '오디오 옵션'}>
        <DropButton big icon="🔊" label="볼륨" disabled={!el || !ed.canEdit} render={(close) => <>{VOLUME_STEPS.map(([l, patch]) => (
          <MenuItem key={l} label={l} on={l === '음소거' ? !!pb.muted : !pb.muted && (pb.volume ?? 1) === (patch.volume ?? 1)} onClick={() => { setPb(patch); close(); }} />
        ))}</>} />
        <Col>
          <label className="rb-range">시작
            <select disabled={!el || !ed.canEdit} value={pb.autoplay ? 'auto' : 'click'} onChange={(e) => setPb({ autoplay: e.target.value === 'auto' || undefined })}>
              <option value="click">클릭할 때</option><option value="auto">자동 실행</option>
            </select>
          </label>
          {check('acrossSlides', '여러 슬라이드에서 재생', '다음 슬라이드로 넘어가도 계속 재생합니다 (오디오)')}
          {check('loop', '반복 재생', '멈출 때까지 처음부터 다시 재생합니다')}
        </Col>
        <Col>
          {check('hideDuringShow', '쇼 동안 숨기기', '재생하지 않을 때는 슬라이드 쇼에서 보이지 않습니다')}
          {check('rewind', '재생 후 되감기', '끝나면 처음 장면으로 돌아갑니다')}
          {check('fullScreen', '전체 화면 재생', '재생하는 동안 슬라이드를 가득 채웁니다', true)}
        </Col>
      </Group>
    </>
  );
}
