// Korean spelling: common misspellings and their fixes. A Hunspell dictionary can't judge Korean
// without its compounding and jamo conversion (the ko dictionary needs AF aliases and ICONV, which
// the engine's subset doesn't read), so Korean words are checked against this list instead: only
// forms that are wrong wherever they appear (낳았다/나았다, 로서/로써 and the like are left out).
//
// A rule's pattern is the wrong form, with two markers:
//   `~` in front   — Hangul may come before it (an ending: 잘되요, 공부할께)
//   `…` at the end — any Hangul may follow (a stem with its particles and endings: 몇일이, 설겆이를)
// Without `…` nothing Hangul may follow, so `되요` is found in "되요", "안되요." and "되요?" but not
// in "되어요". A list of tails (third element) allows exactly those endings after the form.
// A space in the pattern matches any run of spaces. The fix replaces the pattern's own span; the
// tail is kept.

export interface KoRule { wrong: string; right: string; lead: boolean; any: boolean; tails?: string[] }
export interface KoHit { start: number; length: number; word: string; suggestions: string[] }

type Raw = [pattern: string, right: string, tails?: string[]];

// Verb endings after a final-ㄹ syllable: ~ㄹ께 → ~ㄹ게, ~ㄹ껄 → ~ㄹ걸, ~ㄹ꺼 → ~ㄹ 거.
// (들께 is the honorific particle — 형제들께 — so 들 is not in the list.)
const L_STEMS = ['할', '갈', '볼', '올', '될', '줄', '둘', '살', '칠', '쓸', '잘', '을', '울', '탈', '찰'];
const ENDINGS: Raw[] = [...new Set(L_STEMS)].flatMap((s): Raw[] => [
  [`~${s}께`, `${s}게`, ['', '요']],
  [`~${s}껄`, `${s}걸`, ['', '요']],
  [`~${s}꺼…`, `${s} 거`],
]);

const RAW: Raw[] = [
  // 되/돼, 뵈/봬
  ['~되요', '돼요'],
  ['안되요', '안 돼요'],
  ['~되서', '돼서', ['', '요', '는', '도']],
  ['~됬…', '됐'],
  ['~되버…', '돼버'],
  ['않되…', '안 되'],
  ['않돼…', '안 돼'],
  ['~뵈요', '봬요'],
  ['~뵜…', '뵀'],
  // -에요/-예요, -습니다
  ['~아니예요', '아니에요'],
  ['~거에요', '거예요'],
  ['뭐에요', '뭐예요'],
  ['~읍니다', '습니다'],
  ['~읍니까', '습니까'],
  ['~있슴', '있음'],
  ['~없슴', '없음'],
  ['~했슴', '했음'],
  ['~였슴', '였음'],
  ['~겠슴', '겠음'],
  ['~할려', '하려', ['고', '고요', '면', '는', '나', '다가', '니까']],
  // 왠/웬
  ['웬지', '왠지'],
  ['왠만…', '웬만'],
  ['왠일…', '웬일'],
  ['왠', '웬'],
  // Well-known word misspellings
  ['몇일…', '며칠'],
  ['몇 일', '며칠', ['', '이', '이나', '간', '동안', '을', '만에', '째', '뒤', '후', '전', '이면', '이에요', '이지']],
  ['어의없…', '어이없'],
  ['어의가 없…', '어이가 없'],
  ['금새…', '금세'],
  ['설겆이…', '설거지'],
  ['역활…', '역할'],
  ['희안…', '희한'],
  ['오랫만…', '오랜만'],
  ['일일히', '일일이'],
  ['깨끗히', '깨끗이'],
  ['곰곰히', '곰곰이'],
  ['따뜻히', '따뜻이'],
  ['버젓히', '버젓이'],
  ['느긋히', '느긋이'],
  ['번번히', '번번이'],
  ['틈틈히', '틈틈이'],
  ['꼼꼼이', '꼼꼼히'],
  ['솔직이', '솔직히'],
  ['꾸준이', '꾸준히'],
  ['일찌기', '일찍이'],
  ['더우기', '더욱이'],
  ['구지', '굳이'],
  // 찌게 alone is also 찌다 + -게 (살찌게), so only the dishes.
  ['~장찌게…', '장찌개'],
  ['김치찌게…', '김치찌개'],
  ['부대찌게…', '부대찌개'],
  ['순두부찌게…', '순두부찌개'],
  ['동태찌게…', '동태찌개'],
  ['참치찌게…', '참치찌개'],
  ['육계장…', '육개장'],
  ['깎뚜기…', '깍두기'],
  ['떡볶기…', '떡볶이'],
  ['남비…', '냄비'],
  ['어떻해…', '어떡해'],
  ['어떡게', '어떻게'],
  ['문안하게', '무난하게'],
  ['바램…', '바람'],
  ['내노라…', '내로라'],
  ['내꺼…', '내 거'],
  ['갯수…', '개수'],
  ['설레임…', '설렘'],
  ['설레이…', '설레'],
  ['제작년…', '재작년'],
  ['짜집기…', '짜깁기'],
  ['애띤', '앳된'],
  ['애띠…', '앳되'],
  ['눈쌀…', '눈살'],
  ['폭팔…', '폭발'],
  ['어줍잖…', '어쭙잖'],
  ['섥히…', '설키'],
  ['단언컨데', '단언컨대'],
  ['요컨데', '요컨대'],
  ['홧병…', '화병'],
  ['새침떼기…', '새침데기'],
  ['귀뜸…', '귀띔'],
  ['희노애락…', '희로애락'],
  ['곱배기…', '곱빼기'],
  ['뒤치닥거리…', '뒤치다꺼리'],
  ['넓다랗…', '널따랗'],
  ['괜시리', '괜스레'],
  ['어리버리…', '어리바리'],
  ['오도방정…', '오두방정'],
  ['통채로', '통째로'],
  ['트름…', '트림'],
  ['삼가하…', '삼가'],
  ['삼가해…', '삼가'],
  ['윗어른…', '웃어른'],
  ['윗층…', '위층'],
  ['윗쪽…', '위쪽'],
  ['숫컷…', '수컷'],
  ['햇님…', '해님'],
  ['꼭지점…', '꼭짓점'],
  ['인삿말…', '인사말'],
  ['머릿말…', '머리말'],
  ['가랭이…', '가랑이'],
  ['아지랭이…', '아지랑이'],
  ['멋장이…', '멋쟁이'],
  ['웅큼…', '움큼'],
  ['괴씸…', '괘씸'],
  ['어물쩡…', '어물쩍'],
  ['애시당초…', '애당초'],
  ['치뤘…', '치렀'],
  ['치뤄…', '치러'],
  ['잠궜…', '잠갔'],
  ['잠궈…', '잠가'],
  ['담궜…', '담갔'],
  ['담궈…', '담가'],
  ['바꼈…', '바뀌었'],
  ['사겼…', '사귀었'],
  ['엇그제…', '엊그제'],
  ['뒷풀이…', '뒤풀이'],
  ['시덥잖…', '시답잖'],
  ['구렛나루…', '구레나룻'],
  ['넉두리…', '넋두리'],
  ['건데기…', '건더기'],
  ['우뢰…', '우레'],
  // Church words (하나님, 예배드리다, 찬양대 are right and not listed)
  ['성경귀절…', '성경 구절'],
  ['~귀절…', '구절'],
  ['싯귀…', '시구'],
  ['에배…', '예배'],
  ['예베…', '예배'],
  ['새례…', '세례'],
  ['임마뉴엘…', '임마누엘'],
  ['할렐류야…', '할렐루야'],
  ['바리세인…', '바리새인'],
  ['사두게인…', '사두개인'],
  ['마테복음…', '마태복음'],
  ['~게시록…', '계시록'],
  ['대살로니가…', '데살로니가'],
  // 예기 (豫期) is a word too — 예기치 못한 — so only the endings that make it 얘기.
  ['예기', '얘기', ['', '를', '가', '도', '는', '좀', '예요', '야', '랑', '만']],
  ...ENDINGS,
];

export const KO_RULES: KoRule[] = RAW.map(([p, right, tails]) => {
  const lead = p.startsWith('~');
  const any = p.endsWith('…');
  return { wrong: p.replace(/^~/, '').replace(/…$/, ''), right, lead, any, tails };
});

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const H = '[가-힣]';

function compile(r: KoRule): RegExp {
  const body = r.wrong.split(' ').map(esc).join('\\s+');
  const tail = r.any ? '' : r.tails ? `(?=(?:${r.tails.map(esc).sort((a, b) => b.length - a.length).join('|')})(?!${H}))` : `(?!${H})`;
  return new RegExp(`${r.lead ? '' : `(?<!${H})`}${body}${tail}`, 'gu');
}
const COMPILED = KO_RULES.map((r) => [r, compile(r)] as const);

/** The Korean misspellings in `text`, left to right; where two rules overlap the longer wins. */
export function koMisspellings(text: string): KoHit[] {
  if (!/[가-힣]/.test(text)) return [];
  const found: (KoHit & { end: number })[] = [];
  for (const [r, re] of COMPILED) {
    if (!text.includes(r.wrong.split(' ')[0])) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) found.push({ start: m.index, length: m[0].length, end: m.index + m[0].length, word: m[0], suggestions: [r.right] });
  }
  found.sort((a, b) => a.start - b.start || b.length - a.length);
  const out: KoHit[] = [];
  let end = -1;
  for (const h of found) {
    if (h.start < end) continue;
    out.push({ start: h.start, length: h.length, word: h.word, suggestions: h.suggestions });
    end = h.end;
  }
  return out;
}

/** The fix for a misspelt Korean form (`되요` → `돼요`), or null when no rule matches all of it. */
export function koFix(word: string): string | null {
  const h = koMisspellings(word);
  return h.length === 1 && h[0].start === 0 && h[0].length === word.length ? h[0].suggestions[0] : null;
}
