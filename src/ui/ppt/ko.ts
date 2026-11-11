// PowerPoint's Korean names for what the engine lists in English.
import type { ShapeCategory } from '../../engine';

export const SHAPE_CATEGORY: Record<ShapeCategory, string> = {
  lines: '선', rectangles: '사각형', basic: '기본 도형', arrows: '블록 화살표', equation: '수식 도형',
  flowchart: '순서도', stars: '별 및 현수막', callouts: '설명선', actionButtons: '실행 단추',
};

const SHAPE: Record<string, string> = {
  line: '선', straightConnector1: '화살표', bentConnector3: '연결선: 꺾임', curvedConnector3: '연결선: 구부러짐',
  rect: '사각형', roundRect: '사각형: 둥근 모서리', snip1Rect: '사각형: 한쪽 모서리가 잘림', snip2SameRect: '사각형: 위쪽 모서리가 잘림',
  round1Rect: '사각형: 한쪽 모서리가 둥근', round2SameRect: '사각형: 위쪽 모서리가 둥근', textBox: '텍스트 상자', ellipse: '타원',
  triangle: '이등변 삼각형', rtTriangle: '직각 삼각형', parallelogram: '평행 사변형', trapezoid: '사다리꼴', diamond: '다이아몬드',
  pentagon: '정오각형', hexagon: '육각형', heptagon: '칠각형', octagon: '팔각형', decagon: '십각형', dodecagon: '십이각형',
  pie: '부분 원형', chord: '현', teardrop: '눈물 방울', frame: '액자', halfFrame: 'L 도형', corner: '모서리', diagStripe: '대각선 줄무늬',
  plus: '십자형', plaque: '배지', can: '원통형', cube: '정육면체', bevel: '빗면', donut: '도넛', noSmoking: '"없음" 기호',
  blockArc: '막힌 원호', foldedCorner: '모서리가 접힌 도형', smileyFace: '웃는 얼굴', heart: '하트', lightningBolt: '번개',
  sun: '해', moon: '달', cloud: '구름', arc: '원호', bracketPair: '양쪽 대괄호', bracePair: '양쪽 중괄호',
  leftBracket: '왼쪽 대괄호', rightBracket: '오른쪽 대괄호', leftBrace: '왼쪽 중괄호', rightBrace: '오른쪽 중괄호',
  rightArrow: '화살표: 오른쪽', leftArrow: '화살표: 왼쪽', upArrow: '화살표: 위쪽', downArrow: '화살표: 아래쪽',
  leftRightArrow: '화살표: 왼쪽/오른쪽', upDownArrow: '화살표: 위쪽/아래쪽', quadArrow: '화살표: 왼쪽/오른쪽/위쪽/아래쪽',
  bentArrow: '화살표: 굽음', uturnArrow: '화살표: U자형', curvedRightArrow: '화살표: 오른쪽으로 구부러짐', curvedLeftArrow: '화살표: 왼쪽으로 구부러짐',
  stripedRightArrow: '화살표: 줄무늬가 있는 오른쪽', notchedRightArrow: '화살표: 톱니 모양의 오른쪽', homePlate: '화살표: 오각형', chevron: '화살표: 갈매기형 수장',
  circularArrow: '화살표: 원형', mathPlus: '더하기 기호', mathMinus: '빼기 기호', mathMultiply: '곱하기 기호', mathDivide: '나누기 기호',
  mathEqual: '등호', mathNotEqual: '같지 않음', flowChartProcess: '순서도: 처리', flowChartDecision: '순서도: 판단',
  flowChartTerminator: '순서도: 수행의 시작/종료', flowChartDocument: '순서도: 문서', flowChartInputOutput: '순서도: 데이터',
  star4: '별: 꼭짓점 4개', star5: '별: 꼭짓점 5개', star6: '별: 꼭짓점 6개', star7: '별: 꼭짓점 7개', star8: '별: 꼭짓점 8개',
  star10: '별: 꼭짓점 10개', star12: '별: 꼭짓점 12개', star16: '별: 꼭짓점 16개', star24: '별: 꼭짓점 24개', star32: '별: 꼭짓점 32개',
  irregularSeal1: '폭발: 꼭짓점 8개', irregularSeal2: '폭발: 꼭짓점 14개', ribbon2: '리본: 위로 기울어짐', wave: '물결', doubleWave: '이중 물결',
  wedgeRectCallout: '말풍선: 사각형', wedgeRoundRectCallout: '말풍선: 모서리가 둥근 사각형', wedgeEllipseCallout: '말풍선: 타원형', cloudCallout: '생각 풍선: 구름 모양',
};
export const shapeLabel = (name: string, english: string) => SHAPE[name] ?? english;

export const TRANSITION: Record<string, string> = {
  none: '없음', morph: '모핑', fade: '페이드', push: '밀어내기', wipe: '닦아내기', split: '나누기', reveal: '나타내기', cut: '자르기',
  randomBar: '실선 무늬', shape: '도형', uncover: '당기기', cover: '덮기', flash: '깜박이기', fallOver: '넘어지기', drape: '휘장',
  curtains: '커튼', wind: '바람', prestige: '명성', fracture: '부서지기', crush: '구기기', peelOff: '벗기기', pageCurlDouble: '페이지 말아 넘기기',
  airplane: '비행기', origami: '종이 접기', dissolve: '디졸브', checker: '바둑판 무늬', blinds: '블라인드', clock: '시계', ripple: '물결',
  honeycomb: '벌집', glitter: '반짝이', vortex: '소용돌이', shred: '조각', switch: '전환', flip: '대칭 이동', gallery: '갤러리', cube: '큐브',
  doors: '문', box: '상자', comb: '빗질', zoom: '확대/축소', random: '임의', pan: '이동', ferris: '관람차', conveyor: '컨베이어',
  rotate: '회전', window: '창', orbit: '궤도', flythrough: '통과',
};
export const TRANSITION_CATEGORY: Record<string, string> = { Subtle: '은은한 효과', Exciting: '화려한 효과', 'Dynamic Content': '동적 콘텐츠' };

export const ANIMATION: Record<string, string> = {
  appear: '나타내기', fade: '밝기 변화', fly: '날아오기', float: '떠오르기', split: '나누기', wipe: '닦아내기', shape: '도형', wheel: '회전하기',
  randomBars: '실선 무늬', grow: '확대/축소 및 회전', zoom: '확대/축소', swivel: '회전', bounce: '바운드', blinds: '블라인드', box: '상자',
  checkerboard: '바둑판 무늬', circle: '원', diamond: '다이아몬드', dissolve: '디졸브', peek: '살짝 나타내기', strips: '줄무늬', expand: '확장',
  rise: '떠오르기', spinner: '스피너', pulse: '펄스', colorPulse: '색 펄스', teeter: '흔들기', spin: '회전', growShrink: '크게/작게',
  desaturate: '채도 낮추기', darken: '어둡게', lighten: '밝게', transparency: '투명도', objectColor: '개체 색', complementaryColor: '보색',
  lineColor: '선 색', fillColor: '채우기 색', fontColor: '글꼴 색', underline: '밑줄', boldFlash: '굵게 깜박이기', wave: '물결',
  disappear: '사라지기', fadeOut: '밝기 변화', flyOut: '날아가기', floatOut: '떠내려가기', splitOut: '나누기', wipeOut: '닦아내기',
  shapeOut: '도형', wheelOut: '회전하기', randomBarsOut: '실선 무늬', shrinkTurn: '축소 및 회전', zoomOut: '확대/축소', swivelOut: '회전',
  bounceOut: '바운드', dissolveOut: '디졸브', blindsOut: '블라인드', boxOut: '상자', checkerboardOut: '바둑판 무늬', diamondOut: '다이아몬드',
  peekOut: '살짝 사라지기', lines: '선', arcs: '호', turns: '회전', loops: '루프', diagonalDownRight: '대각선 오른쪽 아래로',
  diagonalUpRight: '대각선 오른쪽 위로', zigzag: '지그재그', sineWave: '사인파', pathWave: '물결', heartbeat: '심장 박동',
};
export const ANIMATION_CLASS: Record<string, string> = { entrance: '나타내기', emphasis: '강조', exit: '끝내기', path: '이동 경로' };
export const ANIMATION_START: Record<string, string> = { click: '클릭할 때', with: '이전 효과와 함께', after: '이전 효과 다음에' };

/** An engine effect option label ("From Right", "Horizontal In"…) in Korean. */
export function optionLabel(label: string): string {
  const words: [RegExp, string][] = [
    [/From Bottom-Left/g, '왼쪽 아래에서'], [/From Bottom-Right/g, '오른쪽 아래에서'], [/From Top-Left/g, '왼쪽 위에서'], [/From Top-Right/g, '오른쪽 위에서'],
    [/From Right/g, '오른쪽에서'], [/From Left/g, '왼쪽에서'], [/From Top/g, '위에서'], [/From Bottom/g, '아래에서'],
    [/Horizontal In/g, '가로 안쪽으로'], [/Horizontal Out/g, '가로 바깥쪽으로'], [/Vertical In/g, '세로 안쪽으로'], [/Vertical Out/g, '세로 바깥쪽으로'],
    [/Horizontal/g, '가로'], [/Vertical/g, '세로'], [/Smoothly/g, '부드럽게'], [/Through Black/g, '검정을 통해'], [/Counterclockwise/g, '시계 반대 방향'],
    [/Clockwise/g, '시계 방향'], [/Wedge/g, '쐐기형'], [/Zoom and Rotate/g, '확대/축소 및 회전'], [/Center/g, '가운데'], [/Objects/g, '개체'],
    [/Words/g, '단어'], [/Characters/g, '문자'], [/^In$/g, '안쪽으로'], [/^Out$/g, '바깥쪽으로'], [/Left/g, '왼쪽'], [/Right/g, '오른쪽'],
    [/Top/g, '위'], [/Bottom/g, '아래'], [/Single/g, '단일'], [/Double/g, '이중'], [/Strips/g, '스트립'], [/Particles/g, '입자'],
    [/Diamonds/g, '다이아몬드'], [/Hexagons/g, '육각형'], [/ with Bounce/g, ' 및 바운드'], [/Cut/g, '자르기'],
  ];
  let s = label;
  for (const [re, ko] of words) s = s.replace(re, ko);
  return s;
}

/** Animation options are file values (b, l, horzIn…). */
export function animOptionLabel(o: string): string {
  const m: Record<string, string> = {
    b: '아래에서', t: '위에서', l: '왼쪽에서', r: '오른쪽에서', lb: '왼쪽 아래에서', lt: '왼쪽 위에서', rb: '오른쪽 아래에서', rt: '오른쪽 위에서',
    u: '위로', d: '아래로', horz: '가로', vert: '세로', horzIn: '가로 안쪽으로', horzOut: '가로 바깥쪽으로', vertIn: '세로 안쪽으로', vertOut: '세로 바깥쪽으로',
    in: '안쪽으로', out: '바깥쪽으로', across: '가로', down: '아래로', up: '위로', right: '오른쪽', left: '왼쪽', clockwise: '시계 방향', counterClockwise: '시계 반대 방향',
    both: '모두', '1': '살 1개', '2': '살 2개', '3': '살 3개', '4': '살 4개', '8': '살 8개',
  };
  return m[o] ?? o;
}
