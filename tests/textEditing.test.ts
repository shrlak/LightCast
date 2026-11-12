import { describe, expect, it } from 'vitest';
import { applyEdits, backStops, charMove, deleteForwardEnd, deleteWord, nextStop, paragraphRange, paraDown, paraUp, prevStop, stops, toOffset, toPos, wordAt, wordMove, wordRange, type Pos } from '../src/domain/textEditing';
import { DEFAULT_AUTOCORRECT, addEntry, autoCorrectAt, autoListStyle, correctWord, entryList, isOrdinal, removeEntry, sentenceCase, smartQuote, type AutoCorrectPrefs } from '../src/domain/autoCorrect';

/** Stops drawn as | in the text (DeckCraft's readable traces, observed in PowerPoint for Windows). */
const marked = (text: string, st: number[]) => {
  let out = '';
  for (let i = 0; i <= text.length; i++) {
    if (st.includes(i)) out += '|';
    if (i < text.length) out += text[i] === '\v' ? '↵' : text[i] === '\t' ? '→' : text[i];
  }
  return out;
};
const fwd = (t: string) => marked(t, stops(t));
const back = (t: string) => marked(t, backStops(t));

describe('word stops (Ctrl+arrows), as DeckCraft traced them in PowerPoint', () => {
  it('punctuation and spaces', () => {
    const t = 'Hello, world!  Foo...bar baz-qux it\'s 3.14 e.g. a_b x@y.com (end) "q" end.';
    const want = '|Hello|, |world|!  |Foo|...|bar |baz-qux |it\'s |3.14 |e|.|g|. |a|_|b |x|@|y|.|com |(|end|) |"|q|" |end|.|';
    expect(fwd(t)).toBe(want);
    expect(back(t)).toBe(want);
  });
  it('hyphens, apostrophes and numbers', () => {
    expect(fwd("a-b -b a--b a - b a- b dogs' x 'q' 1,000.5 3:45 v1.2.3 $5 50% a/b x&y #tag a+b c++ end"))
      .toBe("|a-b |-|b |a-|-|b |a |- |b |a- |b |dogs|' |x |'q|' |1,000.5 |3:45 |v1.2.3 |$|5 |50|% |a|/|b |x|&|y |#|tag |a|+|b |c|++ |end|");
  });
  it('emoji and symbols are never split; emoji then punctuation differs going left', () => {
    expect(fwd('👍👍 x 👍? x👍y')).toBe('|👍👍 |x |👍|? |x|👍|y|');
    expect(back('👍👍 x 👍? x👍y')).toBe('|👍👍 |x |👍? |x|👍|y|');
    expect(fwd('café éte ½ ®z')).toBe('|café |éte |½ |®|z|');
  });
  it('every Hangul syllable and CJK character is a word of its own', () => {
    const t = '日本語のテキストです。한국어 문장 a。。b';
    expect(fwd(t)).toBe('|日|本|語|の|テ|キ|ス|ト|で|す|。|한|국|어 |문|장 |a|。。|b|');
    expect(back(t)).toBe(fwd(t));
  });
  it('tabs, line breaks and other spaces', () => {
    expect(fwd('  lead x   mid  ')).toBe('|  |lead |x   |mid  |');
    expect(fwd('Five\vsix seven\tTab   x')).toBe('|Five|↵|six |seven|→|Tab   |x|');
    const t = 'a  b a　b a  b a  b end';
    expect(fwd(t)).toBe('|a  |b |a　|b |a  |b |a  |b |end|');
    expect(back(t)).toBe('|a| | |b |a|　|b |a | |b |a  |b |end|');
  });
  it('next and previous stop', () => {
    const t = '  lead x   mid  ';
    expect([nextStop(t, 1), nextStop(t, 9), nextStop(t, 16)]).toEqual([2, 11, null]);
    expect([prevStop(t, 1), prevStop(t, 9), prevStop(t, 15), prevStop(t, 0)]).toEqual([0, 7, 11, null]);
    expect([nextStop('', 0), prevStop('', 0)]).toEqual([null, null]);
  });
  it('Ctrl+→ at a paragraph end goes to the next one, Ctrl+← at its start to the previous end', () => {
    const p = ['one two', 'three'];
    expect(wordMove(p, [0, 4], true)).toEqual([0, 7]);
    expect(wordMove(p, [0, 7], true)).toEqual([1, 0]);
    expect(wordMove(p, [1, 5], true)).toEqual([1, 5]);
    expect(wordMove(p, [1, 0], false)).toEqual([0, 7]);
    expect(wordMove(p, [0, 6], false)).toEqual([0, 4]);
    expect(wordMove(p, [0, 0], false)).toEqual([0, 0]);
  });
});

describe('paragraph and character moves', () => {
  const b = ['one two', 'three', '', 'four'];
  it('Ctrl+↑ goes to the paragraph start, then the previous one', () => {
    expect(paraUp(b, [1, 3])).toEqual([1, 0]);
    expect(paraUp(b, [1, 0])).toEqual([0, 0]);
    expect(paraUp(b, [0, 0])).toEqual([0, 0]);
  });
  it('Ctrl+↓ goes to the next paragraph start, or the end of the last', () => {
    expect(paraDown(b, [0, 2])).toEqual([1, 0]);
    expect(paraDown(b, [3, 1])).toEqual([3, 4]);
  });
  it('character moves never split an emoji and cross paragraphs', () => {
    expect(charMove(['a👍b'], [0, 1], true)).toEqual([0, 3]);
    expect(charMove(['a👍b'], [0, 3], false)).toEqual([0, 1]);
    expect(charMove(['ab', 'c'], [0, 2], true)).toEqual([1, 0]);
    expect(charMove(['ab', 'c'], [1, 0], false)).toEqual([0, 2]);
  });
  it('flat offsets and positions convert both ways', () => {
    expect(toOffset(b, [1, 2])).toBe(10);
    expect(toPos(b, 10)).toEqual([1, 2]);
    expect(toPos(b, 14)).toEqual([2, 0]);
    expect(toPos(b, 999)).toEqual([3, 4]);
  });
});

describe('double- and triple-click selection', () => {
  it('a double-click selects the word without its trailing spaces', () => {
    const t = 'Hello world,  foo bar';
    expect(wordAt(t, 7)).toEqual([6, 11]);
    expect(wordAt(t, 15)).toEqual([14, 17]);
    expect(wordAt(t, 11)).toEqual([11, 12]);
    expect(wordAt(t, 12)).toEqual([11, 12]);
    expect(wordAt(t, 13)).toEqual([12, 14]);
    expect(wordAt(t, 21)).toEqual([18, 21]);
    expect(wordAt('日本語のテキスト abc', 5)).toEqual([5, 6]);
    expect(wordAt('', 3)).toEqual([0, 0]);
    expect(wordAt('x👨‍👩‍👧y', 3)).toEqual([1, 9]);
    expect(wordAt('주님 은혜', 1)).toEqual([1, 2]);
  });
  it('wordRange works in a paragraph of the box', () => {
    expect(wordRange(['first', 'second line'], [1, 2])).toEqual([[1, 0], [1, 6]]);
  });
  it('a triple-click selects the paragraph with its mark (the last has none)', () => {
    expect(paragraphRange(['ab', 'cd', 'ef'], 1)).toEqual([[1, 0], [2, 0]]);
    expect(paragraphRange(['ab', 'cd'], 1)).toEqual([[1, 0], [1, 2]]);
    expect(paragraphRange(['ab'], 99)).toEqual([[0, 0], [0, 2]]);
  });
});

describe('Ctrl+Backspace / Ctrl+Delete like PowerPoint', () => {
  const del = (text: string, at: Pos, forward: boolean): [string, Pos] => {
    const paras = text.split('\n');
    const r = deleteWord(paras, at, forward);
    return [applyEdits(paras, r.edits).join('\n'), r.caret];
  };
  it('Ctrl+Delete extent before smart spacing', () => {
    const t = 'ab   cd...ef gh';
    const ends = [...Array(t.length + 1).keys()].map((c) => deleteForwardEnd(t, c));
    expect(ends).toEqual([5, 2, 7, 5, 5, 7, 7, 10, 10, 10, 13, 12, 15, 15, 15, null]);
  });
  it('Ctrl+Backspace', () => {
    const t = 'ab   cd...ef gh';
    const want: [string, number][] = [
      ['ab   cd...ef gh', 0], ['b   cd...ef gh', 0], ['   cd...ef gh', 0], ['  cd...ef gh', 0], [' cd...ef gh', 0], ['cd...ef gh', 0],
      ['ab   d...ef gh', 5], ['ab   ...ef gh', 5], ['ab   cd..ef gh', 7], ['ab   cd.ef gh', 7], ['ab   cdef gh', 7], ['ab   cd...f gh', 10],
      ['ab   cd... gh', 10], ['ab   cd...gh', 10], ['ab   cd...ef h', 13], ['ab   cd...ef ', 13],
    ];
    want.forEach(([txt, caret], c) => expect(del(t, [0, c], false)).toEqual([txt, [0, caret]]));
    const w = 'Hello world  foo, bar\nnext para';
    expect(del(w, [0, 12], false)).toEqual(['Hello  foo, bar\nnext para', [0, 6]]);
    expect(del(w, [1, 0], false)).toEqual(['Hello world  foo, barnext para', [0, 21]]);
    expect(del('ab\n  cd', [1, 2], false)).toEqual(['ab\ncd', [1, 0]]);
    expect(del('a 👨‍👩‍👧', [0, 10], false)).toEqual(['a ', [0, 2]]);
    expect(del('하나님 은혜', [0, 3], false)).toEqual(['하나 은혜', [0, 2]]);
  });
  it('Ctrl+Delete with smart spacing', () => {
    const t = 'ab   cd...ef gh';
    const want: [string, number][] = [
      ['cd...ef gh', 0], ['a   cd...ef gh', 1], ['ab...ef gh', 2], ['ab cd...ef gh', 3], ['ab  cd...ef gh', 4], ['ab...ef gh', 2],
      ['ab   c...ef gh', 6], ['ab   cdef gh', 7], ['ab   cd. ef gh', 9], ['ab   cd.. ef gh', 10], ['ab   cd... gh', 11], ['ab   cd...e gh', 11],
      ['ab   cd...ef', 12], ['ab   cd...ef', 12], ['ab   cd...ef g', 14], ['ab   cd...ef gh', 15],
    ];
    want.forEach(([txt, caret], c) => expect(del(t, [0, c], true)).toEqual([txt, [0, caret]]));
    const w = 'Hello world  foo, bar\nnext para';
    const cases: [number, string, number][] = [
      [0, 'world  foo, bar\nnext para', 0], [5, 'Hello  foo, bar\nnext para', 5], [6, 'Hello foo, bar\nnext para', 6],
      [11, 'Hello world, bar\nnext para', 11], [16, 'Hello world  foobar\nnext para', 16], [17, 'Hello world  foo,\nnext para', 17],
      [21, 'Hello world  foo, barnext para', 21],
    ];
    for (const [c, txt, caret] of cases) expect(del(w, [0, c], true)).toEqual([txt, [0, caret]]);
    expect(del('ab  \ncd', [0, 3], true)).toEqual(['ab\ncd', [0, 2]]);
    expect(del('ab cd, ef', [0, 3], true)).toEqual(['ab, ef', [0, 2]]);
    expect(del('ab "cd" ef', [0, 4], true)).toEqual(['ab "" ef', [0, 4]]);
    expect(del('3.x 14', [0, 2], true)).toEqual(['3.14', [0, 2]]);
    expect(del('ab', [9, 9], true)[0]).toBe('ab');
  });
});

/** Type `text` one character at a time with smart quotes and AutoCorrect, as the editor does. */
function typeLine(text: string, prefs: AutoCorrectPrefs = DEFAULT_AUTOCORRECT): { line: string; sup: [number, number][]; list?: string } {
  let line = '';
  const sup: [number, number][] = [];
  let list: string | undefined;
  for (const ch of text) {
    const c = prefs.smartQuotes ? smartQuote(ch, line[line.length - 1]) : ch;
    line += c;
    const a = autoCorrectAt(prefs, line, line.length, true);
    if (a?.kind === 'replace') line = line.slice(0, a.start) + a.text + line.slice(a.end);
    // An ordinal already superscripted (when "1st," got its comma) is left alone.
    else if (a?.kind === 'ordinal' && !sup.some(([x]) => x === a.start)) sup.push([a.start, a.end]);
    else if (a?.kind === 'list') { list = a.list; line = line.slice(a.end); }
  }
  return { line, sup, list };
}

describe('AutoCorrect as you type (DeckCraft rules)', () => {
  it('smart quotes and the replacement list', () => {
    expect(typeLine('"hi" teh ').line).toBe('“hi” the ');
    expect(smartQuote("'", 'n')).toBe('’');
    expect(smartQuote("'", '(')).toBe('‘');
  });
  it('sentence capitals, days, I, two initials, caps lock, fractions and ellipsis', () => {
    expect(typeLine('hello world. see you monday, i think. ').line).toBe('Hello world. See you Monday, I think. ');
    expect(typeLine('THe tHIS 1/2 recieved... ').line).toBe('The This ½ received… ');
    expect(typeLine('(c) ').line).toBe('© ');
    expect(typeLine('Teh end').line).toBe('The end');
  });
  it('Korean is left alone', () => {
    expect(typeLine('주님의 은혜. 감사합니다 ').line).toBe('주님의 은혜. 감사합니다 ');
  });
  it('options turn rules off; your own entries come first; deleting a built-in one', () => {
    expect(typeLine('hello monday ', { ...DEFAULT_AUTOCORRECT, sentenceCaps: false, days: false }).line).toBe('hello monday ');
    let p = addEntry(DEFAULT_AUTOCORRECT, 'lc', 'LightCast') as AutoCorrectPrefs;
    p = removeEntry(p, 'teh');
    expect(typeLine('lc teh ', p).line).toBe('LightCast teh ');
    expect(entryList(p).some(([k]) => k === 'lc')).toBe(true);
    expect(entryList(p).some(([k]) => k === 'teh')).toBe(false);
    expect(typeof addEntry(p, 'two words', 'x')).toBe('string');
    expect(typeLine('lc adn ', { ...p, on: false }).line).toBe('lc adn ');
  });
  it('pasted text only gets the replacement list, not the case rules', () => {
    expect(correctWord(DEFAULT_AUTOCORRECT, 'monday', true, false)).toBeNull();
    expect(correctWord(DEFAULT_AUTOCORRECT, 'teh', true, false)).toBe('the');
    expect(autoCorrectAt(DEFAULT_AUTOCORRECT, 'monday notes ', 13, false)).toBeNull();
  });
  it('ordinals get a superscript suffix', () => {
    const r = typeLine('1st, 22nd and 103rd. 4th 11th x');
    expect(r.sup).toEqual([[1, 3], [7, 9], [17, 19], [22, 24], [27, 29]]);
    expect(typeLine('first x1st 1th 2st 21st').sup).toEqual([]);
    expect(typeLine('2nd ', { ...DEFAULT_AUTOCORRECT, ordinals: false }).sup).toEqual([]);
    expect([isOrdinal('11th'), isOrdinal('12nd'), isOrdinal('101st')]).toEqual([true, false, true]);
  });
  it('a list lead and a space start a list; "i." stays as typed', () => {
    expect(typeLine('* item')).toEqual({ line: 'item', sup: [], list: 'bullet' });
    expect(typeLine('1. one').list).toBe('number');
    expect(typeLine('a) x').list).toBe('alpha');
    expect(typeLine('i. x').list).toBe('roman');
    expect(typeLine('x * y').list).toBeUndefined();
    expect(typeLine('* x', { ...DEFAULT_AUTOCORRECT, lists: false }).line).toBe('* x');
    expect(autoListStyle('--')).toBe('square');
    expect(autoCorrectAt(DEFAULT_AUTOCORRECT, '* ', 2, true, true)).toBeNull();
  });
  it('sentence case keeps decimal points', () => {
    expect(sentenceCase('a lot')).toBe('A lot');
    expect(sentenceCase("i've. 3.5 ok")).toBe("I've. 3.5 Ok");
    expect(sentenceCase('I HAVE 3.5 APPLES')).toBe('I have 3.5 apples');
  });
});
