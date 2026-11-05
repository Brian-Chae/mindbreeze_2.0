// @vitest-environment jsdom
// SDD-313 — 전체 동의 체크는 화면에 보이는 선택 항목과 같은 소스에서 파생된다.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegratedEntryConsentView } from '../src/components/class/flow/member/IntegratedEntryConsentView';

let root: Root;
let container: HTMLDivElement;
const noop = () => undefined;
async function render(values: { required: boolean; eeg: boolean; research: boolean; report: boolean }, eegLocked: boolean, onChange: (v: unknown) => void = noop) {
  await act(async () => root.render(
    <IntegratedEntryConsentView values={values} onChange={onChange} onSubmit={noop} onBack={noop} onRetry={noop} loading={false}
      metadataPending={false} metadataAcquired={false} loadError={null} saving={false} saveError={null}
      researchAllowed eegAllowed eegLocked={eegLocked} aiEnabled={false} />));
}
const box = (name: string) => container.querySelector<HTMLInputElement>(`input[data-consent="${name}"]`)!;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe('전체 동의와 선택 항목 비대칭 제거', () => {
  it('EEG 항목이 잠겨 해제 상태면 나머지가 모두 선택돼도 전체 동의는 켜지지 않는다', async () => {
    await render({ required: true, eeg: false, research: true, report: true }, true);
    expect(box('eeg').checked).toBe(false);
    expect(box('all').checked).toBe(false);
    expect(box('all').indeterminate).toBe(true);
  });
  it('화면에 보이는 모든 항목이 선택됐을 때만 전체 동의가 켜진다', async () => {
    await render({ required: true, eeg: true, research: true, report: true }, true);
    expect(box('all').checked).toBe(true);
    expect(box('all').indeterminate).toBe(false);
  });
  it('전체 동의를 눌러도 잠긴 EEG 항목 값은 바뀌지 않는다', async () => {
    const onChange = vi.fn();
    await render({ required: false, eeg: false, research: false, report: false }, true, onChange);
    await act(async () => { box('all').click(); });
    expect(onChange).toHaveBeenCalledWith({ required: true, eeg: false, research: true, report: true });
  });
});
