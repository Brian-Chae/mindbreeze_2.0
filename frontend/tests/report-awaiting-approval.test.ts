import { describe, expect, it } from 'vitest';
import { isAwaitingApproval } from '../src/lib/api/report-status';

describe('isAwaitingApproval (상담사 검토중 집계)', () => {
  it('승인 대상 pending_review 는 집계한다', () => {
    expect(isAwaitingApproval({ status: 'pending_review' })).toBe(true);
    expect(isAwaitingApproval({ status: 'pending_review', approval_required: true })).toBe(true);
  });
  it('클래스 회차 상담사용 리포트(approval_required=false)는 집계하지 않는다', () => {
    expect(isAwaitingApproval({ status: 'pending_review', approval_required: false })).toBe(false);
  });
  it('승인 완료·분석 중은 집계하지 않는다', () => {
    expect(isAwaitingApproval({ status: 'completed' })).toBe(false);
    expect(isAwaitingApproval({ status: 'pending_analysis' })).toBe(false);
  });
});
