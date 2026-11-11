// PowerPoint's Korean names for what the engine lists in English.
import type { ShapeCategory } from '../../engine';

export const SHAPE_CATEGORY: Record<ShapeCategory, string> = {
  lines: '선', rectangles: '사각형', basic: '기본 도형', arrows: '블록 화살표', equation: '수식 도형',
  flowchart: '순서도', stars: '별 및 현수막', callouts: '설명선', actionButtons: '실행 단추',
};

const SHAPE: Record<string, string> = {
  bentConnector2: '연결선: 꺾임 (한 번)',
  lineInv: '선: 오르막',
  snip2DiagRect: '사각형: 대각선 방향의 모서리가 잘림',
  snipRoundRect: '사각형: 잘린 위쪽 모서리와 둥근 위쪽 모서리',
  round2DiagRect: '사각형: 대각선 방향의 모서리가 둥근',
  nonIsoscelesTrapezoid: '사다리꼴: 비대칭',
  pieWedge: '부채꼴: 1/4',
  cornerTabs: '모서리 탭: 삼각형',
  squareTabs: '모서리 탭: 사각형',
  plaqueTabs: '모서리 탭: 1/4 원',
  gear6: '톱니바퀴: 톱니 6개',
  gear9: '톱니바퀴: 톱니 9개',
  funnel: '깔때기',
  chartX: '차트 표식: 교차선',
  chartStar: '차트 표식: 별 선',
  chartPlus: '차트 표식: 십자선',
  leftRightUpArrow: '화살표: 왼쪽/오른쪽/위쪽',
  curvedUpArrow: '화살표: 위로 구부러짐',
  curvedDownArrow: '화살표: 아래로 구부러짐',
  leftUpArrow: '화살표: 왼쪽/위쪽',
  bentUpArrow: '화살표: 위쪽으로 구부러짐',
  leftCircularArrow: '화살표: 시계 반대 방향 원형',
  leftRightCircularArrow: '화살표: 양방향 원형',
  swooshArrow: '화살표: 휘어진 곡선',
  rightArrowCallout: '설명선: 오른쪽 화살표',
  downArrowCallout: '설명선: 아래쪽 화살표',
  leftArrowCallout: '설명선: 왼쪽 화살표',
  upArrowCallout: '설명선: 위쪽 화살표',
  leftRightArrowCallout: '설명선: 왼쪽/오른쪽 화살표',
  upDownArrowCallout: '설명선: 위쪽/아래쪽 화살표',
  quadArrowCallout: '설명선: 왼쪽/오른쪽/위쪽/아래쪽 화살표',
  flowChartAlternateProcess: '순서도: 대체 처리',
  flowChartPredefinedProcess: '순서도: 미리 정의된 처리',
  flowChartInternalStorage: '순서도: 내부 저장소',
  flowChartMultidocument: '순서도: 다중 문서',
  flowChartPreparation: '순서도: 준비',
  flowChartManualInput: '순서도: 수동 입력',
  flowChartManualOperation: '순서도: 수동 연산',
  flowChartConnector: '순서도: 연결자',
  flowChartOffpageConnector: '순서도: 페이지 외부 연결자',
  flowChartPunchedCard: '순서도: 카드',
  flowChartPunchedTape: '순서도: 천공 테이프',
  flowChartSummingJunction: '순서도: 가산 접합',
  flowChartOr: '순서도: 논리합',
  flowChartCollate: '순서도: 대조',
  flowChartSort: '순서도: 정렬',
  flowChartExtract: '순서도: 추출',
  flowChartMerge: '순서도: 병합',
  flowChartOnlineStorage: '순서도: 저장 데이터',
  flowChartDelay: '순서도: 지연',
  flowChartMagneticTape: '순서도: 순차적 액세스 저장소',
  flowChartMagneticDisk: '순서도: 자기 디스크',
  flowChartMagneticDrum: '순서도: 직접 액세스 저장소',
  flowChartDisplay: '순서도: 화면 표시',
  flowChartOfflineStorage: '순서도: 오프라인 저장소',
  ribbon: '리본: 아래로 기울어짐',
  ellipseRibbon2: '리본: 위로 구부러지고 기울어짐',
  ellipseRibbon: '리본: 아래로 구부러지고 기울어짐',
  leftRightRibbon: '리본: 왼쪽/오른쪽 접힘',
  verticalScroll: '두루마리 모양: 세로로 말림',
  horizontalScroll: '두루마리 모양: 가로로 말림',
  borderCallout1: '설명선: 선',
  borderCallout2: '설명선: 꺾인 선',
  borderCallout3: '설명선: 이중 꺾인 선',
  accentCallout1: '설명선: 강조선이 있는 선',
  accentCallout2: '설명선: 강조선이 있는 꺾인 선',
  accentCallout3: '설명선: 강조선이 있는 이중 꺾인 선',
  callout1: '설명선: 테두리 없는 선',
  callout2: '설명선: 테두리 없는 꺾인 선',
  callout3: '설명선: 테두리 없는 이중 꺾인 선',
  accentBorderCallout1: '설명선: 테두리와 강조선이 있는 선',
  accentBorderCallout2: '설명선: 테두리와 강조선이 있는 꺾인 선',
  accentBorderCallout3: '설명선: 테두리와 강조선이 있는 이중 꺾인 선',
  actionButtonBackPrevious: '실행 단추: 뒤로 또는 이전',
  actionButtonForwardNext: '실행 단추: 앞으로 또는 다음',
  actionButtonBeginning: '실행 단추: 처음으로',
  actionButtonEnd: '실행 단추: 끝으로',
  actionButtonHome: '실행 단추: 홈',
  actionButtonInformation: '실행 단추: 정보',
  actionButtonReturn: '실행 단추: 되돌리기',
  actionButtonMovie: '실행 단추: 비디오',
  actionButtonDocument: '실행 단추: 문서',
  actionButtonSound: '실행 단추: 소리',
  actionButtonHelp: '실행 단추: 도움말',
  actionButtonBlank: '실행 단추: 사용자 지정',
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
  stripsOut: '줄무늬', sinkDown: '가라앉기', spinnerOut: '스피너', contract: '축소', shapes: '도형', decayingWave: '감쇠파',
  sCurve1: 'S자 곡선 1', sCurve2: 'S자 곡선 2', stairsDown: '계단 내려가기', bounceRight: '오른쪽으로 바운드', bounceLeft: '왼쪽으로 바운드',
  spiralRight: '오른쪽 나선', spiralLeft: '왼쪽 나선', spring: '용수철', funnel: '깔때기', swoosh: '휘익', star4: '4방향 별', star5: '5방향 별',
  star6: '6방향 별', star8: '8방향 별', heart: '하트', crescentMoon: '초승달', teardrop: '눈물 방울', football: '럭비공', plusPath: '더하기',
  rightTriangle: '직각 삼각형', curvedSquare: '굽은 사각형', figure8Horizontal: '가로 8자형', figure8Vertical: '세로 8자형', loopDeLoop: '고리 모양',
  bean: '콩', peanut: '땅콩', neutron: '중성자', customPath: '사용자 지정 경로',
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
    [/Words/g, '단어'], [/Characters/g, '문자'], [/ In$/g, ' 안쪽으로'], [/ Out$/g, ' 바깥쪽으로'], [/^In /g, '안쪽으로 '], [/^Out /g, '바깥쪽으로 '], [/^In$/g, '안쪽으로'], [/^Out$/g, '바깥쪽으로'], [/Left/g, '왼쪽'], [/Right/g, '오른쪽'],
    [/Top/g, '위'], [/Bottom/g, '아래'], [/Single/g, '단일'], [/Double/g, '이중'], [/Strips/g, '스트립'], [/Particles/g, '입자'],
    [/Diamonds/g, '다이아몬드'], [/Hexagons/g, '육각형'], [/ with Bounce/g, ' 및 바운드'], [/Cut/g, '자르기'],
    [/^circle$/g, '원형'], [/^diamond$/g, '다이아몬드'], [/^plus$/g, '더하기'],
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
    circleIn: '원형 안쪽으로', circleOut: '원형 바깥쪽으로', boxIn: '상자 안쪽으로', boxOut: '상자 바깥쪽으로', diamondIn: '다이아몬드 안쪽으로',
    diamondOut: '다이아몬드 바깥쪽으로', plusIn: '더하기 안쪽으로', plusOut: '더하기 바깥쪽으로', lu: '왼쪽 위로', ru: '오른쪽 위로', ld: '왼쪽 아래로', rd: '오른쪽 아래로',
    circle: '원형', diamond: '다이아몬드', hexagon: '육각형', triangle: '삼각형', square: '사각형', trapezoid: '사다리꼴', octagon: '팔각형',
    parallelogram: '평행 사변형', pentagon: '오각형',
    both: '모두', '1': '살 1개', '2': '살 2개', '3': '살 3개', '4': '살 4개', '8': '살 8개',
  };
  return m[o] ?? o;
}

/** Insert › SmartArt: layouts as PowerPoint's Korean UI names them, with their category. */
export const SMARTART_LAYOUT: Record<string, [string, string]> = {
  list: ['세로 글머리 기호 목록', '목록형'], blockList: ['기본 블록 목록', '목록형'], hBulletList: ['가로 글머리 기호 목록', '목록형'],
  verticalBoxList: ['세로 상자 목록', '목록형'], trapezoidList: ['사다리꼴 목록', '목록형'], tableList: ['표 목록', '목록형'],
  process: ['기본 프로세스', '프로세스형'], chevron: ['기본 갈매기형 수장 프로세스', '프로세스형'], verticalProcess: ['세로 프로세스', '프로세스형'],
  stepUp: ['단계 상향 프로세스', '프로세스형'], timeline: ['기본 시간 표시 막대', '프로세스형'], accentProcess: ['강조 프로세스', '프로세스형'],
  continuousBlockProcess: ['연속 블록 프로세스', '프로세스형'], bendingProcess: ['기본 굽은 프로세스', '프로세스형'], funnel: ['깔때기형', '프로세스형'], gear: ['톱니바퀴', '프로세스형'],
  cycle: ['기본 주기형', '주기형'], blockCycle: ['블록 주기형', '주기형'], textCycle: ['텍스트 주기형', '주기형'], continuousCycle: ['연속 주기형', '주기형'],
  segmentedCycle: ['분할 주기형', '주기형'], multidirectionalCycle: ['다방향 주기형', '주기형'], radial: ['기본 방사형', '주기형'], pie: ['기본 원형', '주기형'],
  hierarchy: ['계층 구조', '계층 구조형'], horizontalHierarchy: ['가로 계층 구조', '계층 구조형'], orgChart: ['조직도', '계층 구조형'],
  halfCircleOrgChart: ['반원형 조직도', '계층 구조형'], nameTitleOrgChart: ['이름 및 직위 조직도', '계층 구조형'],
  venn: ['기본 벤형', '관계형'], linearVenn: ['선형 벤형', '관계형'], stackedVenn: ['누적 벤형', '관계형'], target: ['기본 대상형', '관계형'], nestedTarget: ['중첩 대상형', '관계형'],
  matrix: ['기본 행렬형', '행렬형'], titledMatrix: ['제목 있는 행렬형', '행렬형'], gridMatrix: ['눈금 행렬형', '행렬형'], cycleMatrix: ['주기 행렬형', '행렬형'],
  pyramid: ['기본 피라미드형', '피라미드형'], invertedPyramid: ['역 피라미드형', '피라미드형'], segmentedPyramid: ['분할 피라미드형', '피라미드형'],
  pictureList: ['세로 그림 목록', '그림'], pictureCaption: ['그림 캡션 목록', '그림'], pictureProcess: ['그림 강조 프로세스', '그림'], pictureHList: ['가로 그림 목록', '그림'],
};
export const SMARTART_CATEGORIES = ['목록형', '프로세스형', '주기형', '계층 구조형', '관계형', '행렬형', '피라미드형', '그림'];
export const SMARTART_STYLE: Record<string, string> = {
  flat: '단순 채우기', subtle: '미세 효과', intense: '강한 효과', outline: '흰색 윤곽선', polished: '광택 처리',
  inset: '안쪽', cartoon: '만화', powder: '파우더', brick: '벽돌 장면',
};
export const smartArtColorLabel = (id: string, fallback: string) =>
  id === 'colorful' ? '색상형 - 강조색' :
    id.startsWith('range') ? `색상형 범위 - 강조색 ${id[5]}~${id[6]}` :
      id.endsWith('Grad') ? `그라데이션 범위 - 강조 ${id[6]}` :
        id.startsWith('accent') ? `강조 ${id[6]}` : fallback;
