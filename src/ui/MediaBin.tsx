import { useRef, useState, type Dispatch } from 'react';
import type { Action, AppState } from '../domain/reducer';
import type { Background, MediaMeta } from '../domain/types';
import { BACKGROUND_PRESETS } from '../domain/defaults';
import { swatchStyle } from './backgroundSwatch';
import { deleteMedia, forgetMediaUrl, putMedia } from '../domain/media';
import { uid } from '../domain/lyrics';
import { useMediaUrl } from './hooks';
import { assetUrl } from './SlideCanvas';
import { protectedMediaIds, PROTECTED_MESSAGE } from '../domain/materialProtection';
import { isMetafileName } from '../domain/metafile/image';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
}

const MAX_BYTES = 1024 * 1024 * 1024;

function sameBackground(a: Background | null | undefined, b: Background): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'media') return a.mediaId === (b as typeof a).mediaId;
  if (a.kind === 'camera') return a.deviceId === (b as typeof a).deviceId;
  if (a.kind === 'image') return a.url === (b as typeof a).url;
  if (a.kind === 'motion') return a.style === (b as typeof a).style && a.colors.join() === (b as typeof a).colors.join();
  if (a.kind === 'pattern') return a.preset === (b as typeof a).preset && a.fg === (b as typeof a).fg && a.bg === (b as typeof a).bg;
  return a.value === (b as typeof a).value;
}

function MediaThumb({ media }: { media: MediaMeta }) {
  const url = useMediaUrl(media.id);
  if (!url) return <div className="swatch-fill" />;
  return media.type === 'image' ? <img className="swatch-fill" src={url} alt="" /> : <video className="swatch-fill" src={url} muted preload="metadata" />;
}

export function MediaBin({ state, dispatch }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [cameras, setCameras] = useState<{ deviceId: string; label: string }[]>([]);
  const [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const selected = state.library.presentations.find((p) => p.id === state.selectedId);

  const add = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') || isMetafileName(file.name) ? 'image' : null;
      if (!type || file.size > MAX_BYTES) continue;
      const id = uid('m');
      await putMedia(id, file);
      dispatch({ type: 'media/add', media: { id, name: file.name, type } });
    }
    if (input.current) input.current.value = '';
  };

  const findCameras = async () => {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((d) => d.kind === 'videoinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `카메라 ${i + 1}` })));
    } catch (e) {
      alert(`카메라를 쓸 수 없습니다: ${(e as Error).message}`);
    }
  };

  const remove = async (m: MediaMeta) => {
    if (protectedMediaIds(state.library).has(m.id)) { alert(PROTECTED_MESSAGE); return; }
    if (!confirm(`“${m.name}”을(를) 미디어에서 삭제할까요?`)) return;
    dispatch({ type: 'media/remove', id: m.id });
    forgetMediaUrl(m.id);
    await deleteMedia(m.id);
  };

  const items: { key: string; name: string; background: Background; media?: MediaMeta }[] = [
    ...BACKGROUND_PRESETS.map((p) => ({ key: p.name, name: p.name, background: p.background })),
    ...cameras.map((c) => ({ key: c.deviceId, name: c.label, background: { kind: 'camera', deviceId: c.deviceId, label: c.label } as Background })),
    ...state.library.media.filter((m) => m.type !== 'audio' && !m.backgroundHidden).map((m) => ({
      key: m.id, name: m.name, media: m,
      background: { kind: 'media', mediaId: m.id, mediaType: m.type === 'video' ? 'video' : 'image', fit } as Background,
    })),
  ];

  return (
    <section className="panel media-bin">
      <div className="media-bin-head">
        <h2>배경 · 미디어</h2>
        <p className="muted small">누르면 바로 화면 배경이 됩니다 · 📌 “{selected?.title ?? '—'}”의 배경으로 고정</p>
        <div className="row gap-xs wrap">
          <button className="primary" onClick={() => input.current?.click()}>＋ 그림 · 영상</button>
          <button onClick={findCameras} title="카메라 · 캡처 카드 입력">📷 카메라</button>
          <select value={fit} onChange={(e) => setFit(e.target.value as 'cover' | 'contain')} title="그림 · 영상을 화면에 맞추는 방법" aria-label="화면 맞춤">
            <option value="cover">꽉 채우기</option><option value="contain">전체 보이기</option>
          </select>
        </div>
        <input ref={input} type="file" accept="image/*,.wmf,.emf,video/*" multiple hidden onChange={(e) => add(e.target.files)} />
      </div>
      <div className="swatches">
        {items.map((it) => (
          <div key={it.key} className={`swatch ${sameBackground(state.live.background, it.background) ? 'live' : ''}`}>
            <button className="swatch-main" title={it.name} onClick={() => dispatch({ type: 'live/background', background: it.background })}>
              {it.media ? <MediaThumb media={it.media} /> : it.background.kind === 'camera' ? <div className="swatch-fill camera-swatch">📷</div> : it.background.kind === 'image' ? <img className="swatch-fill" src={assetUrl(it.background.url)} alt="" loading="lazy" /> : (
                <div className="swatch-fill" style={swatchStyle(it.background)} />
              )}
              <span className="swatch-name truncate">{it.media?.type === 'video' ? '▶ ' : ''}{it.name}</span>
            </button>
            <div className="swatch-actions">
              {it.background.kind !== 'camera' && (
                <button className="mini-btn" title="이 프레젠테이션의 배경으로 고정" disabled={!selected}
                  onClick={() => selected && dispatch({ type: 'presentation/update', id: selected.id, patch: { background: it.background } })}>📌</button>
              )}
              {it.media?.type === 'image' && (
                <button className={`mini-btn ${state.library.logoMediaId === it.media.id ? 'active' : ''}`} title="로고 화면으로 사용 (L)"
                  onClick={() => dispatch({ type: 'library/logo', mediaId: state.library.logoMediaId === it.media!.id ? null : it.media!.id })}>L</button>
              )}
              {it.media && <button className="mini-btn" title="삭제" onClick={() => remove(it.media!)}>✕</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
