import { describe, expect, it } from 'vitest';
import type { ClassSummary } from '../src/lib/api/dashboard';
import { homeEntryAction } from '../src/lib/dashboard/counselor-home-model';

const base = { id: 's1', class_id: 'c1', area: 'meditation', type: 'meditation', status: 'open', participant_count: 0 } as unknown as ClassSummary;
const row = (patch: Partial<ClassSummary>): ClassSummary => ({ ...base, ...patch });

describe('homeEntryAction', () => {
  it('배정된 진행자는 열릴 수 있는 회차에서 입장하기 → player', () => {
    for (const status of ['ready', 'scheduled', 'open', 'in_progress'] as const) {
      expect(homeEntryAction(row({ status, viewer_is_host: true, host_state: 'assigned' }), 'counselor')).toEqual({ kind: 'enter', label: '입장하기', to: '/sessions/s1/player' });
    }
  });
  it('재배정·수락 대기 진행자는 입장 버튼 없음', () => {
    expect(homeEntryAction(row({ viewer_is_host: true, host_state: 'pending_ack' }), 'counselor').kind).toBe('none');
  });
  it('보조 강사·기관관리자: 열린 회차 + 서버가 허용하면 참관 입장하기', () => {
    for (const role of ['counselor', 'org_admin']) {
      expect(homeEntryAction(row({ can_observe: true }), role)).toMatchObject({ kind: 'observe', label: '참관 입장하기' });
    }
  });
  it('스위치 off 등 서버가 막으면 버튼 대신 안내', () => {
    expect(homeEntryAction(row({ can_observe: false, observe_blocked_reason: 'team_read_disabled' }), 'counselor')).toEqual({ kind: 'note', text: '참관 기능이 꺼져 있어요' });
    expect(homeEntryAction(row({ can_observe: false, observe_blocked_reason: 'no_members_yet' }), 'counselor')).toEqual({ kind: 'note', text: '회원이 입장하면 참관할 수 있어요' });
  });
  it('아직 안 열린 회차는 진행 코치 안내', () => {
    expect(homeEntryAction(row({ status: 'scheduled', host_name: '김코치' }), 'counselor')).toEqual({ kind: 'note', text: '진행: 김코치 코치 · 열리면 참관할 수 있어요' });
  });
  it('상담 회차·클래스 없는 회차는 버튼 없음', () => {
    expect(homeEntryAction(row({ area: 'counseling' }), 'counselor').kind).toBe('none');
  });
});
