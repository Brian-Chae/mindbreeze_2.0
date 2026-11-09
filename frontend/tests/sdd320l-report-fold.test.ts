// 11/9 대표 지시: 리포트 계층 목록은 처리할 일이 있는 회차만 펼친 채로 시작한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rowState } from '../src/lib/report-ops-labels';

const src = readFileSync(resolve(__dirname, '..', 'src/components/reports/ReportHierarchyList.tsx'), 'utf8');

describe('리포트 회차 기본 펼침', () => {
  it('항상 펼침(useState(true))이 아니라 처리할 일 기준으로 시작한다', () => {
    const block = src.slice(src.indexOf('function SessionBlock'), src.indexOf('function', src.indexOf('function SessionBlock') + 10));
    expect(block).not.toMatch(/useState\(true\)/);
    expect(src).toMatch(/const \[open, setOpen\] = useState\(needsAttention\)/);
    expect(src).toMatch(/session\.needs_review > 0 \|\| session\.delivery_failed > 0/);
  });
  it('검토 필요·발송 실패·생성 실패는 처리할 일, 승인 완료·리포트 없음은 아님', () => {
    const base = { report_id: 'r', status: 'completed', approval_required: true, delivery_status: 'sent', generation_status: 'completed' };
    const tone = (d: Record<string, unknown> | null) => rowState(d as never).tone;
    expect(tone({ ...base, status: 'pending_review' })).toBe('pending');
    expect(tone({ ...base, delivery_status: 'failed' })).toBe('failed');
    expect(['done', 'muted']).toContain(tone(base));
    expect(tone(null)).toBe('muted');
  });
});
