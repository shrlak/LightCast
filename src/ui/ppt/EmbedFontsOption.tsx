// 저장 › PPTX 저장 글꼴 포함: put the deck's fonts into the exported .pptx when LightCast has the font files.
import { useState } from 'react';
import { embedFontsPref, setEmbedFontsPref } from '../../domain/embeddedFonts';

export function EmbedFontsOption() {
  const [on, setOn] = useState(embedFontsPref);
  return (
    <label className="bs-note" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '6px 0', cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setEmbedFontsPref(e.target.checked); }} style={{ accentColor: '#2f9e44', marginTop: 3 }} />
      <span><b>PPTX에 글꼴 포함</b><br /><small>이 컴퓨터에 글꼴 파일이 있고 저작권상 허용되는 글꼴만 파일에 넣습니다. 다른 컴퓨터에서도 같은 글꼴로 보입니다. 파일 크기가 커질 수 있습니다.</small></span>
    </label>
  );
}
