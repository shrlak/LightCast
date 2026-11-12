import { useEffect, useState } from 'react';
import { desktop } from '../domain/desktop';
import { MixerPanel } from '../ui/MixerPanel';

/**
 * `?view=mixer`: the X32 mixer in its own window. In the desktop app it floats above the console,
 * the slide show and other apps; 📌 lets it go behind other windows again.
 */
export function MixerView() {
  const [onTop, setOnTop] = useState<boolean | null>(null);
  useEffect(() => {
    document.title = 'LightCast — X32 믹서';
    desktop?.setOnTop?.().then(setOnTop, () => setOnTop(null));
  }, []);
  return (
    <div className="mixer-view">
      {onTop !== null && (
        <button type="button" className={`x32-btn ${onTop ? 'lit yellow' : ''} mixer-pin`} aria-pressed={onTop}
          title={onTop ? '다른 창 위에 항상 떠 있습니다 — 누르면 일반 창이 됩니다' : '누르면 다른 창 위에 항상 떠 있습니다'}
          onClick={() => desktop?.setOnTop?.(!onTop).then(setOnTop)}>📌 항상 위</button>
      )}
      <MixerPanel />
    </div>
  );
}
