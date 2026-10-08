import { afterEach, expect, it, vi } from 'vitest';
import * as api from '../src/lib/api/agent-checkin';
import { ApiError, apiClient } from '../src/lib/api/client';
afterEach(() => vi.restoreAllMocks());
it('안부·프로파일·위험 신호 조회 계약과 식별자 인코딩을 유지한다', async () => {
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue({});
  await api.getCheckinPrefs(); await api.listCheckinClients(); await api.getProfile('c/1'); await api.listCheckins('c/1'); await api.listRiskSignals('open');
  expect(get.mock.calls).toEqual([
    ['/agent/checkin-prefs'], ['/agent/counselor/checkin/clients'], ['/agent/counselor/clients/c%2F1/profile'],
    ['/agent/counselor/clients/c%2F1/checkins?limit=20'], ['/agent/counselor/risk-signals?status=open&limit=50'],
  ]);
});
it('일시 중지·켜기·프로파일 수정·처리의 메서드와 본문 계약을 유지한다', async () => {
  const put = vi.spyOn(apiClient, 'put').mockResolvedValue({});
  const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({});
  const post = vi.spyOn(apiClient, 'post').mockResolvedValue({});
  await api.putCheckinPrefs(true); await api.setCheckinEnabled('c/1', false); await api.patchProfileItem('p/1', { status: 'confirmed', text: '수정' }); await api.handleRiskSignal('r/1');
  expect(put.mock.calls).toEqual([['/agent/checkin-prefs', { paused: true }], ['/agent/counselor/checkin/clients/c%2F1', { enabled: false }]]);
  expect(patch.mock.calls).toEqual([['/agent/counselor/profile-items/p%2F1', { status: 'confirmed', text: '수정' }]]);
  expect(post.mock.calls).toEqual([['/agent/counselor/risk-signals/r%2F1/handled']]);
});
it('오류 응답은 JSON 파싱 전에 ok 상태를 확인한다', async () => {
  const order: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 502, get ok() { order.push('ok'); return false; }, json: async () => { order.push('json'); throw new SyntaxError('HTML'); } } as Response);
  await expect(api.getCheckinPrefs()).rejects.toBeInstanceOf(ApiError);
  expect(order).toEqual(['ok', 'json']);
});
