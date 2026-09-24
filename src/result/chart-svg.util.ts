// Spec 7.2/7.3: 문항 유형별 그래프(원그래프/가로막대/세로막대)를 SVG로 그린 뒤
// sharp로 PNG 변환한다(result.service.ts). 순수 문자열 조립이라 외부 렌더링
// 의존성(canvas 등 네이티브 빌드)이 필요 없다.
const WIDTH = 800;
const HEIGHT = 600;
const HEADER_HEIGHT = 110;
const CHART_TOP = HEADER_HEIGHT + 20;
const CHART_HEIGHT = HEIGHT - CHART_TOP - 20;
const FONT = 'font-family="Malgun Gothic, sans-serif"';
const PALETTE = [
  '#40abfc',
  '#82ccff',
  '#b9e4ff',
  '#94a3b8',
  '#cbd5e1',
  '#fbbf24',
  '#f472b6',
  '#34d399',
  '#a78bfa',
  '#fb923c',
];

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Spec 7.3: "이미지에는 문항 번호·질문, 그래프, 응답 수, 기준 시각을 넣는다."
function buildHeader(
  orderNo: number,
  questionText: string,
  responseCount: number,
  asOf: string,
): string {
  return `
    <text x="40" y="38" font-size="15" fill="#6b7280" ${FONT}>Q${orderNo}</text>
    <text x="40" y="68" font-size="23" font-weight="700" fill="#111827" ${FONT}>${escapeXml(questionText)}</text>
    <text x="40" y="96" font-size="13" fill="#6b7280" ${FONT}>응답 ${responseCount}명 · 기준 ${asOf}</text>
    <line x1="40" y1="${HEADER_HEIGHT}" x2="${WIDTH - 40}" y2="${HEADER_HEIGHT}" stroke="#e5e7eb" />
  `;
}

interface OptionSlice {
  label: string;
  count: number;
  percentage: number;
}

// Spec 7.2: 단일선택 — 원그래프, 보기별 응답 수와 비율.
function buildPieChart(options: OptionSlice[]): string {
  const cx = WIDTH / 2 - 80;
  const cy = CHART_TOP + CHART_HEIGHT / 2;
  const r = Math.min(CHART_HEIGHT, 320) / 2 - 10;
  const total = options.reduce((sum, o) => sum + o.count, 0);

  let angle = -90;
  const slices = options
    .map((o, i) => {
      const fraction = total ? o.count / total : 0;
      const sweep = fraction * 360;
      if (total <= 0 || o.count <= 0) return '';
      const large = sweep > 180 ? 1 : 0;
      const start = polar(cx, cy, r, angle);
      const end = polar(cx, cy, r, angle + sweep);
      angle += sweep;
      return `<path d="M${cx},${cy} L${start.x.toFixed(2)},${start.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${end.x.toFixed(2)},${end.y.toFixed(2)} Z" fill="${PALETTE[i % PALETTE.length]}" />`;
    })
    .join('');

  const legend = options
    .map((o, i) => {
      const y = CHART_TOP + 10 + i * 28;
      return `<rect x="${WIDTH - 300}" y="${y}" width="16" height="16" fill="${PALETTE[i % PALETTE.length]}" rx="3" />
        <text x="${WIDTH - 278}" y="${y + 13}" font-size="14" fill="#111827" ${FONT}>${escapeXml(o.label)} — ${o.count}명 (${o.percentage.toFixed(1)}%)</text>`;
    })
    .join('');

  return slices + legend;
}

// Spec 7.2: 복수선택 — 가로 막대, 보기별 선택 수 + 응답자 중 선택 비율(합 100% 초과 가능).
function buildHorizontalBarChart(options: OptionSlice[]): string {
  const left = 220;
  const right = WIDTH - 60;
  const maxCount = Math.max(1, ...options.map((o) => o.count));
  const rowHeight = Math.min(
    56,
    (CHART_HEIGHT - 20) / Math.max(1, options.length),
  );

  return options
    .map((o, i) => {
      const y = CHART_TOP + i * rowHeight;
      const barWidth = (o.count / maxCount) * (right - left);
      return `
        <text x="${left - 10}" y="${y + rowHeight / 2 + 5}" text-anchor="end" font-size="14" fill="#111827" ${FONT}>${escapeXml(o.label)}</text>
        <rect x="${left}" y="${y + rowHeight * 0.2}" width="${Math.max(0, barWidth)}" height="${rowHeight * 0.6}" fill="#40abfc" rx="4" />
        <text x="${left + barWidth + 10}" y="${y + rowHeight / 2 + 5}" font-size="13" fill="#374151" ${FONT}>${o.count}명 (${o.percentage.toFixed(1)}%)</text>
      `;
    })
    .join('');
}

interface ScaleBar {
  score: number;
  count: number;
}

// Spec 7.2: 척도 — 1~5점 세로 막대 + 평균, 양 끝 설명을 축에 표시.
function buildVerticalBarChart(
  scaleCounts: ScaleBar[],
  average: number,
  minScaleLabel: string | null,
  maxScaleLabel: string | null,
): string {
  const left = 90;
  const right = WIDTH - 90;
  const bottom = CHART_TOP + CHART_HEIGHT - 50;
  const top = CHART_TOP + 30;
  const maxCount = Math.max(1, ...scaleCounts.map((s) => s.count));
  const slot = (right - left) / scaleCounts.length;
  const barWidth = slot * 0.5;

  const bars = scaleCounts
    .map((s, i) => {
      const x = left + i * slot + slot / 2 - barWidth / 2;
      const h = (s.count / maxCount) * (bottom - top);
      const y = bottom - h;
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(0, h)}" fill="#40abfc" rx="4" />
        <text x="${x + barWidth / 2}" y="${bottom + 24}" text-anchor="middle" font-size="14" fill="#111827" ${FONT}>${s.score}</text>
        <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" font-size="13" fill="#374151" ${FONT}>${s.count}</text>
      `;
    })
    .join('');

  return `
    ${bars}
    <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#9ca3af" />
    <text x="${left}" y="${bottom + 44}" font-size="12" fill="#6b7280" ${FONT}>${escapeXml(minScaleLabel ?? '')}</text>
    <text x="${right}" y="${bottom + 44}" text-anchor="end" font-size="12" fill="#6b7280" ${FONT}>${escapeXml(maxScaleLabel ?? '')}</text>
    <text x="${right}" y="${top - 10}" text-anchor="end" font-size="16" font-weight="700" fill="#111827" ${FONT}>평균 ${average.toFixed(1)}점</text>
  `;
}

function wrap(
  orderNo: number,
  questionText: string,
  responseCount: number,
  asOf: string,
  chartInner: string,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" />
    ${buildHeader(orderNo, questionText, responseCount, asOf)}
    ${chartInner}
  </svg>`;
}

export function buildSingleChoiceSvg(
  orderNo: number,
  questionText: string,
  responseCount: number,
  asOf: string,
  options: OptionSlice[],
): string {
  return wrap(
    orderNo,
    questionText,
    responseCount,
    asOf,
    buildPieChart(options),
  );
}

export function buildMultiChoiceSvg(
  orderNo: number,
  questionText: string,
  responseCount: number,
  asOf: string,
  options: OptionSlice[],
): string {
  return wrap(
    orderNo,
    questionText,
    responseCount,
    asOf,
    buildHorizontalBarChart(options),
  );
}

export function buildScaleSvg(
  orderNo: number,
  questionText: string,
  responseCount: number,
  asOf: string,
  scaleCounts: ScaleBar[],
  average: number,
  minScaleLabel: string | null,
  maxScaleLabel: string | null,
): string {
  return wrap(
    orderNo,
    questionText,
    responseCount,
    asOf,
    buildVerticalBarChart(scaleCounts, average, minScaleLabel, maxScaleLabel),
  );
}
