// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ExportDialog } from '../src/components/data-center/export-dialog';
import { ExportJobs } from '../src/components/data-center/export-jobs';
import { exportApi, type ExportPreview } from '../src/lib/api/data-center-export';
import { exclusionReasonLabel, summarizeExclusions } from '../src/lib/data-center-labels';
import preview from '../../specs/sdd-243-platform-data-center/contracts/fixtures/export-preview.json';
import status from '../../specs/sdd-243-platform-data-center/contracts/fixtures/export-status.json';

const ALL_REASONS = ['not_completed', 'attribution_unknown', 'not_collected', 'unsupported_client', 'expired', 'withdrawn', 'lost', 'unknown', 'band_not_used', 'consent_missing', 'retention_deadline_unknown', 'out_of_range', 'pending_upload', 'policy_blocked', 'manifest_not_connected', 'no_eligible_targets'];
const FUTURE = '2099-01-01T00:00:00Z';
const setValue = (el: HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

async function open(result: Partial<ExportPreview>, limits = {}) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const client = { ...exportApi, preview: vi.fn().mockResolvedValue({ ...preview, ...result, expires_at: FUTURE }), reauth: vi.fn(), create: vi.fn().mockResolvedValue(status) };
  await act(async () => { root.render(<ExportDialog target={{ scope: 'session', targetId: 's', label: '1회차' }} client={client} limits={limits} onClose={() => {}} />); });
  const dialog = document.querySelector('[role=dialog]')!;
  const button = (text: string) => Array.from(dialog.querySelectorAll('button')).find((x) => x.textContent === text)!;
  return { dialog, button, client, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe('데이터 센터 다운로드 안내 문구', () => {
  it('모든 제외 사유 코드에 한국어 이름이 있다', () => {
    for (const code of ALL_REASONS) expect(exclusionReasonLabel(code)).not.toMatch(/[a-z_]{4,}/);
    expect(exclusionReasonLabel('consent_missing')).toBe('뇌파 수집 미동의');
    expect(summarizeExclusions({ band_not_used: 2, consent_missing: 1 }, []).text).toBe('밴드 미착용 2건, 뇌파 수집 미동의 1건');
  });

  it('재인증 스위치가 꺼지면 비밀번호·재인증 문구 없이 바로 작업을 만든다', async () => {
    const { dialog, button, client, close } = await open({ exclusions: [], exclusion_counts: {}, extra_range_notices: [], eligible: true, estimated_bytes: null, session_count: 1, participant_count: 1 });
    expect(button('다운로드 작업 생성').disabled).toBe(true);
    expect(dialog.textContent).toContain("먼저 '다운로드할 데이터 확인'을 눌러 주세요");
    expect(button('다운로드할 데이터 확인').disabled).toBe(true);
    expect(dialog.textContent).toContain('이상 입력하면 확인할 수 있습니다');
    await act(async () => setValue(dialog.querySelector('textarea')!, '운영 확인'));
    await act(async () => button('다운로드할 데이터 확인').click());
    expect(dialog.textContent).toContain('1회차 · 1명 포함, 0건 제외');
    expect(dialog.querySelector('input[type=password]')).toBeNull();
    for (const word of ['재인증', '비밀번호', 'dc-policy', '미집계', 'manifest', 'feature', 'null']) expect(dialog.textContent).not.toContain(word);
    expect(dialog.textContent).not.toContain('제외되는 내용을 확인했습니다');
    expect(button('다운로드 작업 생성').disabled).toBe(false);
    await act(async () => button('다운로드 작업 생성').click());
    expect(client.reauth).not.toHaveBeenCalled();
    expect(client.create).toHaveBeenCalledWith({ preview_token: preview.preview_token, reason: '운영 확인', reauth_proof: undefined }, expect.any(String), undefined);
    await close();
  });

  it('제외가 있으면 한국어 사유와 확인 체크가 나온다', async () => {
    const { dialog, button, close } = await open({ exclusions: [{ reason: 'consent_missing' }], exclusion_counts: { consent_missing: 1 }, extra_range_notices: [], eligible: true, session_count: 2, participant_count: 3 });
    await act(async () => setValue(dialog.querySelector('textarea')!, '운영 확인'));
    await act(async () => button('다운로드할 데이터 확인').click());
    expect(dialog.textContent).toContain('2회차 · 3명 포함, 1건 제외');
    expect(dialog.textContent).toContain('제외 사유: 뇌파 수집 미동의 1건');
    expect(dialog.textContent).toContain('제외되는 내용을 확인했습니다');
    expect(dialog.textContent).toContain('제외되는 내용을 확인했다고 체크해 주세요');
    expect(button('다운로드 작업 생성').disabled).toBe(true);
    await close();
  });

  it('내려받을 수 있는 대상이 없으면 이유를 일반 한국어로 안내한다', async () => {
    const { dialog, button, close } = await open({ exclusions: [{ reason: 'consent_missing' }], exclusion_counts: { consent_missing: 1 }, eligible: false, blocked_reason: 'no_eligible_targets', session_count: 0, participant_count: 0 });
    await act(async () => setValue(dialog.querySelector('textarea')!, '운영 확인'));
    await act(async () => button('다운로드할 데이터 확인').click());
    expect(dialog.textContent).toContain('0회차 · 0명 포함, 1건 제외');
    expect(dialog.textContent).toContain('내려받을 수 있는 데이터가 없습니다 (사유: 뇌파 수집 미동의)');
    expect(dialog.textContent).not.toContain('no_eligible_targets');
    expect(dialog.textContent).not.toContain('consent_missing');
    await close();
  });

  it('스위치가 켜지면 기존 본인 확인 UI가 보인다', async () => {
    const { dialog, button, close } = await open({ exclusions: [], exclusion_counts: {}, extra_range_notices: [], eligible: true }, { reauth_required: true });
    await act(async () => setValue(dialog.querySelector('textarea')!, '운영 확인'));
    await act(async () => button('다운로드할 데이터 확인').click());
    expect(dialog.querySelector('input[type=password]')).not.toBeNull();
    expect(button('다운로드 작업 생성').disabled).toBe(true);
    await close();
  });

  it('작업 목록: 스위치가 꺼지면 본인 확인 없이 바로 링크를 발급한다', async () => {
    const download = vi.fn().mockResolvedValue({ url: 'https://example.com/x.zip', expires_at: FUTURE, part_no: 1, revocable: false });
    const reauth = vi.fn();
    const client = { ...exportApi, jobs: vi.fn().mockResolvedValue({ items: [{ ...status, expires_at: FUTURE }], next_cursor: null }), reauth, download };
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => root.render(<ExportJobs client={client} />));
    expect(host.textContent).not.toContain('재인증');
    await act(async () => (Array.from(host.querySelectorAll('button')).find((x) => x.textContent === '파일 1 다운로드') as HTMLButtonElement).click());
    expect(reauth).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledWith(status.export_id, expect.any(String), undefined, undefined);
    await act(async () => root.unmount()); host.remove();
  });
});
