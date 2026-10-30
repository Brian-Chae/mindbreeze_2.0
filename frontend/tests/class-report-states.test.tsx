// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { SessionSummary } from '../src/pages/sessions/session-summary-page';
import { getMockSummary, MOCK_STATES } from '../src/lib/class-report/mocks';
import { stateCopy } from '../src/lib/class-report/state-copy';
it.each(MOCK_STATES)('요약 %s는 상태·공통 면책·서버 인원을 표시한다', state => {
  const data = getMockSummary(state);
  const markup = renderToStaticMarkup(<MemoryRouter><SessionSummary data={data}/></MemoryRouter>);
  expect(markup).toContain(data.class_report.headline?.text ?? stateCopy(data.class_report.status));
  expect(markup).toContain('의료기기가 아니며');
  expect(markup).toContain(`참석`);
  expect(markup).not.toContain('data-section="S3"');
  expect(markup).not.toContain('data-section="S4"');
  if (state !== 'zero') expect(markup).toContain('코치 클래스 리포트 열기');
  if (state === 'pending') expect(markup).toContain('확인 중');
});
it('측정 1명 요약에는 클래스 방향 칩을 노출하지 않는다', () => {
  const markup = renderToStaticMarkup(<MemoryRouter><SessionSummary data={getMockSummary('single')}/></MemoryRouter>);
  expect(markup).not.toContain('ss-chips');
});
it('계산 오류 블록도 다시 불러오기 행동을 제공한다', () => {
  const markup = renderToStaticMarkup(<MemoryRouter><SessionSummary data={getMockSummary('error')} onReload={() => {}}/></MemoryRouter>);
  expect(markup).toContain('다시 불러오기');
});
