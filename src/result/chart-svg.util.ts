// Spec 7.2/7.3: 문항 유형별 그래프(원그래프/가로막대/세로막대)를 SVG로 그린 뒤
// sharp로 PNG 변환한다(result.service.ts). 순수 문자열 조립이라 외부 렌더링
// 의존성(canvas 등 네이티브 빌드)이 필요 없다.
const WIDTH = 800;
const HEIGHT = 600;
const HEADER_HEIGHT = 110; // 문항이 1줄일 때 기준값 — 2줄이면 늘어난다(wrapQuestionText).
const LINE_HEIGHT = 26;
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

// 실제 폰트 메트릭 대신 문자 폭을 대략 추정한다: 한글/한자 등 전각 문자는
// 폰트 크기와 거의 같은 폭, 그 외(영문·숫자·기호)는 대략 0.55배로 잡는다.
// 그래프 안 텍스트는 "안 잘리면 충분"한 용도라 정밀한 폰트 메트릭까지는 필요 없다.
function isWideChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0xac00 && code <= 0xd7a3) || // 한글 음절
    (code >= 0x1100 && code <= 0x11ff) || // 한글 자모
    (code >= 0x3130 && code <= 0x318f) || // 한글 호환 자모
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 한자
    (code >= 0x3040 && code <= 0x30ff) || // 가나
    (code >= 0xff00 && code <= 0xffef) // 전각 기호
  );
}

function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    width += (isWideChar(ch) ? 1.0 : 0.56) * fontSize;
  }
  return width;
}

// 한 줄로 맞춰야 하는 자리(범례, 막대 라벨 등)에 쓴다 — 넘치면 말줄임표.
function truncateToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  const ellipsis = '…';
  let result = '';
  for (const ch of text) {
    const next = result + ch;
    if (estimateTextWidth(next + ellipsis, fontSize) > maxWidth) break;
    result = next;
  }
  return result + ellipsis;
}

// 문항 제목처럼 여러 줄을 허용하는 자리에 쓴다 — 공백 기준으로 단어를 묶어
// 채우되, 한글은 공백이 드물어서 한 "단어"가 그대로 폭을 넘으면 글자 단위로
// 쪼갠다. maxLines를 넘기면 마지막 줄에 말줄임표를 붙인다.
function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
): string[] {
  const words = text.split(/(\s+)/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current) lines.push(current.trim());
    current = '';
  };

  for (const word of words) {
    const candidate = current + word;
    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    // 단어 하나가 통째로 폭을 넘으면(주로 한글) 글자 단위로 쪼갠다.
    if (estimateTextWidth(word, fontSize) > maxWidth) {
      pushCurrent();
      let chunk = '';
      for (const ch of word) {
        if (estimateTextWidth(chunk + ch, fontSize) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
    } else {
      pushCurrent();
      current = word;
    }
    if (lines.length >= maxLines) break;
  }
  pushCurrent();

  if (lines.length > maxLines) {
    const truncated = lines.slice(0, maxLines);
    truncated[maxLines - 1] = truncateToWidth(
      truncated[maxLines - 1],
      maxWidth,
      fontSize,
    );
    return truncated;
  }
  return lines;
}

// Spec 7.3: "이미지에는 문항 번호·질문, 그래프, 응답 수, 기준 시각을 넣는다."
// 질문이 길면 최대 2줄까지 줄바꿈하고, 그만큼 헤더 높이를 늘려 본문과 안 겹치게 한다.
function buildHeader(
  orderNo: number,
  questionText: string,
  responseCount: number,
  asOf: string,
): { svg: string; height: number } {
  const titleWidth = WIDTH - 80;
  const titleLines = wrapText(questionText, titleWidth, 23, 2);
  const extraLines = Math.max(0, titleLines.length - 1);
  const height = HEADER_HEIGHT + extraLines * LINE_HEIGHT;

  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="40" y="${68 + i * LINE_HEIGHT}" font-size="23" font-weight="700" fill="#111827" ${FONT}>${escapeXml(line)}</text>`,
    )
    .join('');

  return {
    height,
    svg: `
      <text x="40" y="38" font-size="15" fill="#6b7280" ${FONT}>Q${orderNo}</text>
      ${titleSvg}
      <text x="40" y="${68 + extraLines * LINE_HEIGHT + 28}" font-size="13" fill="#6b7280" ${FONT}>응답 ${responseCount}명 · 기준 ${asOf}</text>
      <line x1="40" y1="${height}" x2="${WIDTH - 40}" y2="${height}" stroke="#e5e7eb" />
    `,
  };
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

interface OptionSlice {
  label: string;
  count: number;
  percentage: number;
}

// Spec 7.2: 단일선택 — 원그래프, 보기별 응답 수와 비율.
function buildPieChart(
  options: OptionSlice[],
  chartTop: number,
  chartHeight: number,
): string {
  const cx = WIDTH / 2 - 80;
  const cy = chartTop + chartHeight / 2;
  const r = Math.min(chartHeight, 320) / 2 - 10;
  const total = options.reduce((sum, o) => sum + o.count, 0);
  const legendX = WIDTH - 278;
  const legendAvailableWidth = WIDTH - 40 - legendX;

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
      const y = chartTop + 10 + i * 28;
      // 라벨을 자를 때 뒤에 붙는 "— N명 (%)" 접미사의 폭도 미리 빼둬야
      // 전체 줄이 실제로 legendAvailableWidth 안에 들어온다(접미사까지
      // 자르면 숫자가 안 보이니, 접미사는 그대로 두고 라벨만 줄인다).
      const suffix = ` — ${o.count}명 (${o.percentage.toFixed(1)}%)`;
      const suffixWidth = estimateTextWidth(suffix, 14);
      const label = truncateToWidth(
        o.label,
        Math.max(20, legendAvailableWidth - suffixWidth),
        14,
      );
      return `<rect x="${WIDTH - 300}" y="${y}" width="16" height="16" fill="${PALETTE[i % PALETTE.length]}" rx="3" />
        <text x="${legendX}" y="${y + 13}" font-size="14" fill="#111827" ${FONT}>${escapeXml(label)}${escapeXml(suffix)}</text>`;
    })
    .join('');

  return slices + legend;
}

// Spec 7.2: 복수선택 — 가로 막대, 보기별 선택 수 + 응답자 중 선택 비율(합 100% 초과 가능).
function buildHorizontalBarChart(
  options: OptionSlice[],
  chartTop: number,
  chartHeight: number,
): string {
  const left = 220;
  const right = WIDTH - 60;
  const maxCount = Math.max(1, ...options.map((o) => o.count));
  const rowHeight = Math.min(
    56,
    (chartHeight - 20) / Math.max(1, options.length),
  );
  const labelMaxWidth = left - 20;

  return options
    .map((o, i) => {
      const y = chartTop + i * rowHeight;
      const barWidth = (o.count / maxCount) * (right - left);
      const label = truncateToWidth(o.label, labelMaxWidth, 14);
      return `
        <text x="${left - 10}" y="${y + rowHeight / 2 + 5}" text-anchor="end" font-size="14" fill="#111827" ${FONT}>${escapeXml(label)}</text>
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
  chartTop: number,
  chartHeight: number,
): string {
  const left = 90;
  const right = WIDTH - 90;
  const bottom = chartTop + chartHeight - 50;
  const top = chartTop + 30;
  const maxCount = Math.max(1, ...scaleCounts.map((s) => s.count));
  const slot = (right - left) / scaleCounts.length;
  const barWidth = slot * 0.5;
  const edgeLabelMaxWidth = (right - left) / 2 - 20;

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

  const minLabel = truncateToWidth(minScaleLabel ?? '', edgeLabelMaxWidth, 12);
  const maxLabel = truncateToWidth(maxScaleLabel ?? '', edgeLabelMaxWidth, 12);

  return `
    ${bars}
    <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#9ca3af" />
    <text x="${left}" y="${bottom + 44}" font-size="12" fill="#6b7280" ${FONT}>${escapeXml(minLabel)}</text>
    <text x="${right}" y="${bottom + 44}" text-anchor="end" font-size="12" fill="#6b7280" ${FONT}>${escapeXml(maxLabel)}</text>
    <text x="${right}" y="${top - 10}" text-anchor="end" font-size="16" font-weight="700" fill="#111827" ${FONT}>평균 ${average.toFixed(1)}점</text>
  `;
}

function wrap(
  orderNo: number,
  questionText: string,
  responseCount: number,
  asOf: string,
  buildChart: (chartTop: number, chartHeight: number) => string,
): string {
  const header = buildHeader(orderNo, questionText, responseCount, asOf);
  const chartTop = header.height + 20;
  const chartHeight = HEIGHT - chartTop - 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" />
    ${header.svg}
    ${buildChart(chartTop, chartHeight)}
  </svg>`;
}

export function buildSingleChoiceSvg(
  orderNo: number,
  questionText: string,
  responseCount: number,
  asOf: string,
  options: OptionSlice[],
): string {
  return wrap(orderNo, questionText, responseCount, asOf, (top, height) =>
    buildPieChart(options, top, height),
  );
}

export function buildMultiChoiceSvg(
  orderNo: number,
  questionText: string,
  responseCount: number,
  asOf: string,
  options: OptionSlice[],
): string {
  return wrap(orderNo, questionText, responseCount, asOf, (top, height) =>
    buildHorizontalBarChart(options, top, height),
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
  return wrap(orderNo, questionText, responseCount, asOf, (top, height) =>
    buildVerticalBarChart(
      scaleCounts,
      average,
      minScaleLabel,
      maxScaleLabel,
      top,
      height,
    ),
  );
}
