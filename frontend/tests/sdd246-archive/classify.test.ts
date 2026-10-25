import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/api/client';
import { backoffMs, classifyArchiveError } from '../../src/lib/biosignal/archive-errors';

const api = (status: number, data: unknown = null) => new ApiError(status, `e${status}`, data);

describe('SDD246 archive 오류 분류(단계별)', () => {
  it('PUT 서명 만료 403은 새 presign으로 복구한다(권한 거절로 오인 금지)', () => {
    expect(classifyArchiveError('put', api(403))).toMatchObject({ action: 'represign', stage: 'put' });
  });
  it('API 권한/동의 403은 전송 중단·보존(halt)', () => {
    expect(classifyArchiveError('presign', api(403, { detail: 'consent' }))).toMatchObject({ action: 'halt', stage: 'presign' });
    expect(classifyArchiveError('verify', api(403, { detail: { code: 'archive_rejected', reason: 'consent_withdrawn' } }))).toMatchObject({ action: 'halt', code: 'consent_withdrawn' });
  });
  it.each([['presign', 409], ['verify', 409]] as const)('%s 409 hash 충돌은 격리', (stage, status) => {
    expect(classifyArchiveError(stage, api(status, { detail: { code: 'artifact_conflict' } }))).toMatchObject({ action: 'quarantine', code: 'artifact_conflict' });
  });
  it('409 pending_time_review는 완료로 세지 않는 시간 검토 격리', () => {
    expect(classifyArchiveError('presign', api(409, { detail: { code: 'pending_time_review', reason: 'straddles_cutoff' } }))).toMatchObject({ action: 'time_review', code: 'straddles_cutoff' });
  });
  it.each([413, 422])('%s는 격리하되 크기 초과는 분할 후보', status => {
    const d = classifyArchiveError('presign', api(status));
    expect(d.action).toBe('quarantine');
    expect(d.splitCandidate).toBe(status === 413);
  });
  it.each([['put', 500], ['put', 503], ['put', 429], ['put', 408], ['presign', 502], ['verify', 429]] as const)('%s %s는 backoff 재시도', (stage, status) => {
    expect(classifyArchiveError(stage, api(status))).toMatchObject({ action: 'backoff' });
  });
  it('네트워크 오류(TypeError/Abort)는 어느 단계든 backoff', () => {
    expect(classifyArchiveError('put', new TypeError('Failed to fetch')).action).toBe('backoff');
    expect(classifyArchiveError('verify', new DOMException('x', 'AbortError')).action).toBe('backoff');
  });
  it('ACK 404(서버가 청크를 모름)는 새 presign', () => {
    expect(classifyArchiveError('verify', api(404))).toMatchObject({ action: 'represign' });
  });
  it('Retry-After를 backoff 하한으로 존중한다', () => {
    expect(classifyArchiveError('put', api(429, { retry_after: 90 })).retryAfterMs).toBe(90_000);
  });
});

describe('SDD246 backoff — 횟수만으로 영구 실패하지 않는다', () => {
  it('지수 증가, 상한 60초, 1000회째도 유한 대기', () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(50)).toBe(60_000);
    expect(backoffMs(1000)).toBe(60_000);
  });
  it('retryAfter가 더 크면 그 값을 쓴다', () => { expect(backoffMs(0, 120_000)).toBe(120_000); });
});
