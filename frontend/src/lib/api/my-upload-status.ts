// SDD-262: 회원 본인 데이터 저장 현황 조회. participant_id 를 보내지 않아 서버가 JWT 본인 행만 확정한다(타인 지정 불가).
import { apiClient } from './client';
import { getClasses, getClassSessions } from './class-structure';
import type { MyFeatureSummary, MyRawSummary, SessionCandidateInput } from '../upload-status/member-view';

const sessionPath = (sessionId: string, tail: string): string => `/sessions/${encodeURIComponent(sessionId)}/${tail}`;

export async function getMyUploadSummaries(sessionId: string, signal?: AbortSignal): Promise<{ feature: MyFeatureSummary; raw: MyRawSummary }> {
  const [feature, raw] = await Promise.all([
    apiClient.get<MyFeatureSummary>(sessionPath(sessionId, 'features/summary'), { signal }),
    apiClient.get<MyRawSummary>(sessionPath(sessionId, 'biosignal-raw/summary'), { signal }),
  ]);
  return { feature, raw };
}

export interface MySessionOption extends SessionCandidateInput { classId: string }

/** 본인이 속한 명상 클래스의 회차 + 본인 attendance. 일부 클래스 조회가 실패해도 나머지는 보인다. */
export async function listMySessionOptions(signal?: AbortSignal): Promise<MySessionOption[]> {
  const { classes } = await getClasses({ limit: 100 }, signal);
  const perClass = await Promise.all(classes.filter((c) => c.area === 'meditation').map(async (c) => {
    try {
      const { sessions } = await getClassSessions(c.id as never, signal);
      return sessions.map((s): MySessionOption => ({
        id: s.id, seq: s.seq, scheduled_at: s.scheduled_at, status: s.status,
        attendance: (s as unknown as { attendance?: { entered_at: string | null } | null }).attendance,
        classTitle: c.title ?? '이름 없는 클래스', classId: c.id,
      }));
    } catch { return []; }
  }));
  return perClass.flat();
}
