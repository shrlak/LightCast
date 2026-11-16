// 자막 menu: choose the language of the second (translated) caption line. New file so captionTools.tsx stays small.
import { TRANSLATE_LANGS, translateStatusText, type TranslateLang, type TranslateStatus } from '../../domain/captionTranslate';
import { MenuItem, MenuSep } from './ribbonParts';

const mark = (on: boolean, label: string) => `${on ? '✓ ' : '  '}${label}`;

export function TranslateMenu({ lang, only, status, set, close }: {
  lang: TranslateLang | null; only: boolean; status: TranslateStatus;
  set: (patch: { trLang?: TranslateLang | null; trOnly?: boolean }) => void; close: () => void;
}) {
  return (
    <>
      <MenuItem label={`번역: ${lang ? translateStatusText(status) : '꺼짐'}`} onClick={close} />
      <MenuItem label={mark(lang === null, '번역 자막 없음')} onClick={() => { set({ trLang: null }); close(); }} />
      {TRANSLATE_LANGS.map((l) => <MenuItem key={l.id} label={mark(lang === l.id, `번역 언어: ${l.label}`)} onClick={() => { set({ trLang: l.id }); close(); }} />)}
      <MenuItem label={mark(!only, '원문 아래에 번역 표시')} onClick={() => { set({ trOnly: false }); close(); }} />
      <MenuItem label={mark(only, '번역만 표시 (번역이 없으면 원문)')} onClick={() => { set({ trOnly: true }); close(); }} />
      <MenuSep />
    </>
  );
}
