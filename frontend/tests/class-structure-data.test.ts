import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError } from '../src/lib/api/client';
import * as api from '../src/lib/api/class-structure';
import { asClassId, asRelationshipId } from '../src/lib/class-structure/read-model';

afterEach(() => vi.restoreAllMocks());

describe('읽기 wrapper', () => {
  it('다섯 GET 경로와 envelope를 보존하고 쿼리를 직렬화한다', async () => {
    const payload = { classes: [], total: 0 };
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue(payload);
    expect(await api.getClasses({ status: 'active & closed', page: 2, limit: 10 })).toBe(payload);
    await api.getClass(asClassId('a/b'));
    await api.getClassSessions(asClassId('a/b'));
    await api.getCounseling();
    await api.getCounselingDetail(asRelationshipId('r/1'));
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/classes?status=active+%26+closed&page=2&limit=10', '/classes/a%2Fb',
      '/classes/a%2Fb/sessions', '/counseling', '/counseling/r%2F1',
    ]);
  });
  it('공통 인증 오류를 wrapper에서 변조하지 않는다', async () => {
    const error = new ApiError(404, '비공개 원문', { secret: true });
    vi.spyOn(apiClient, 'get').mockRejectedValue(error);
    await expect(api.getClass(asClassId('missing'))).rejects.toBe(error);
  });
  it('취소된 요청은 전송을 시작하지 않고 진행 중 결과도 폐기한다', async () => {
    const controller = new AbortController();
    controller.abort();
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ classes: [], total: 0 });
    await expect(api.getClasses(undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(get).not.toHaveBeenCalled();
    const active = new AbortController();
    get.mockImplementation(() => new Promise(() => {}));
    const request = api.getClasses(undefined, active.signal);
    active.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
