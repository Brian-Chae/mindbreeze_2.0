import { describe, expect, it } from 'vitest';
import { describeNativeStartFailure } from '../src/lib/native-measurement/device-status';

describe('describeNativeStartFailure — 네이티브 시작 실패 사유를 화면에 올린다', () => {
  it('failed + 코드면 사유 문구', () => {
    expect(describeNativeStartFailure('native', 'failed', 'already_active')).toContain('이전 측정');
    expect(describeNativeStartFailure('native', 'failed', 'internal_error')).toBe('측정을 시작하지 못했어요 (internal_error)');
  });
  it('정상·대기·웹 경로·코드 없음은 null', () => {
    expect(describeNativeStartFailure('native', 'starting', null)).toBeNull();
    expect(describeNativeStartFailure('native', 'running', null)).toBeNull();
    expect(describeNativeStartFailure('web', 'failed', 'x')).toBeNull();
    expect(describeNativeStartFailure('native', 'failed', null)).toBeNull();
  });
});
