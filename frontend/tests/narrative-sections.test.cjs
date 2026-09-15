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
