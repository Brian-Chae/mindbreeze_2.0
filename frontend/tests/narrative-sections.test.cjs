const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
}
require.extensions['.css'] = () => {};
const { adaptReportContent } = require('../src/lib/api/report.ts');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const NarrativeSections = require('../src/components/reports/NarrativeSections.tsx').default;
const raw = { eeg: { status: 'valid', narrative: { journey: '나의 여정', closing: '나의 마무리' }, timeline: [0, 600, 1200].map((t, i) => ({ t, respiratory_rate: 18-i, heart_rate: 75-i, sdnn: 40+i, concentration: .4+i*.1, relaxation: .5+i*.1, stress: .5-i*.1 })) } };
test('초 단위 백엔드 시간을 분으로 변환하고 서사에 시계열을 보존한다', () => {
  const view = adaptReportContent(raw);
  assert.deepEqual(view.displayNarrative.timeline.map(p => p.min), [0, 10, 20]);
});
test('실측 6지표 그래프와 서사 제목을 렌더한다', () => {
  const html = renderToStaticMarkup(React.createElement(NarrativeSections, { narrative: adaptReportContent(raw).displayNarrative }));
  assert.equal((html.match(/<polyline/g) || []).length, 6);
  assert.match(html, /서서히 느려진 호흡/);
  assert.match(html, /10분/);
  assert.match(html, /20분/);
  assert.match(html, /나의 여정/);
});
test('텍스트만 있으면 측정 곡선을 만들지 않는다', () => {
  const view = adaptReportContent({ narrative: { journey: '텍스트만', closing: '마무리' } });
  const html = renderToStaticMarkup(React.createElement(NarrativeSections, { narrative: view.displayNarrative }));
  assert.doesNotMatch(html, /<polyline/);
  assert.doesNotMatch(html, /20분/);
});
test('레거시 분 단위 시간을 다시 나누지 않는다', () => {
  const content = structuredClone(raw);
  content.eeg.timeline = content.eeg.timeline.map(({ t, ...point }) => ({ ...point, min: t / 60 }));
  assert.deepEqual(adaptReportContent(content).displayNarrative.timeline.map(p => p.min), [0, 10, 20]);
});
test('곡선은 실제 입력을 반영하고 결측 구간을 연결하지 않는다', () => {
  const view = adaptReportContent(raw).displayNarrative;
  const render = (narrative) => renderToStaticMarkup(React.createElement(NarrativeSections, { narrative }));
  const original = render(view);
  const changed = structuredClone(view);
  changed.timeline[1].heart_rate = 88;
  assert.notEqual(render(changed), original);
  const missing = structuredClone(view);
  missing.timeline[1].heart_rate = null;
  const html = render(missing);
  assert.equal((html.match(/<polyline/g) || []).length, 5);
  assert.doesNotMatch(html, /NaN|Infinity/);
});
test('변화량만 있는 구형 계약은 임의의 20분 그래프를 만들지 않는다', () => {
  const view = adaptReportContent(raw).displayNarrative;
  delete view.timeline;
  const html = renderToStaticMarkup(React.createElement(NarrativeSections, { narrative: view }));
  assert.doesNotMatch(html, /<polyline|20분/);
  assert.equal((html.match(/추이를 분석할 데이터가 부족해요/g) || []).length, 6);
});

test('여섯 신호의 개선·반대·유지 방향을 카드에서 구분한다', () => {
  const ids = ['respiratory_rate', 'heart_rate', 'hrv', 'focus', 'relaxation', 'emotional_stability'];
  for (const mode of ['better', 'worse', 'stable']) {
    const changes = ids.map((id, index) => ({ id, early: 50, late: mode === 'stable' ? 50 : 50 + (index < 2 ? -10 : 10) * (mode === 'better' ? 1 : -1) }));
    const view = adaptReportContent({ eeg: { status: 'valid', changes } }).displayNarrative;
    const html = renderToStaticMarkup(React.createElement(NarrativeSections, { narrative: view }));
    const cards = html.match(/<article class="metric">[\s\S]*?<\/article>/g);
    assert.equal(cards.length, 6);
    for (const card of cards) {
      assert.match(card, mode === 'better' ? /좋아졌어요/ : mode === 'worse' ? /주의가 필요해요/ : /비슷하게 유지됐어요/);
      assert.match(card, /metric-definition/);
      assert.match(card, /명상 시작\(전반\).*마무리\(후반\)/);
    }
    assert.match(html, /심박변이\(심장 박동 간격의 변화\)/);
    assert.match(html, /밀리초/);
    assert.doesNotMatch(html, /HRV|\dms|bpm/);
  }
});

test('저장된 LLM 서사도 쉽게 표시하며 원본과 결측은 보존한다', () => {
  const content = { narrative: { journey: '세션의 전반 대비 후반 HRV 지표가 8ms 늘었어요.', body: 'HRV는 유지됐어요.', mind: '지표를 살펴봐요.', closing: '다음 세션에도 함께해요.' } };
  const original = structuredClone(content);
  const view = adaptReportContent(content).displayNarrative;
  assert.match(view.journey, /명상 시간.*명상 시작\(전반\).*마무리\(후반\).*심박변이.*몸·마음 신호.*8밀리초/);
  assert.doesNotMatch([view.bodyText, view.mindText, view.closing].join(' '), /HRV|세션|지표/);
  assert.equal(view.body.length, 0);
  assert.equal(view.mind.length, 0);
  assert.deepEqual(content, original);
});

test('웹 보조 카드의 집중 안정과 정서 안정 정의는 서사 근사와 구별한다', () => {
  const EegMetricsGrid = require('../src/components/reports/EegMetricsGrid.tsx').default;
  const eeg = adaptReportContent(raw).eeg;
  const html = renderToStaticMarkup(React.createElement(EegMetricsGrid, { eeg, reportType: 'client' }));
  assert.match(html, /집중 관련 뇌파 신호가 얼마나 일정하게 유지됐는지/);
  assert.match(html, /정서 안정과 관련된 뇌파 신호/);
  assert.doesNotMatch(html, /스트레스 신호를 반대로/);
  assert.match(html, /산출 불가/);
  assert.doesNotMatch(html, /좋아졌어요/);
});
