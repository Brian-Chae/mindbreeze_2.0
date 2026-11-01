// SDD-261: 설정 화면의 클래스·회차 선택(권한 있는 목록만 기존 API 로 조회). platform_admin 은 기관을 먼저 고른다.
// 접근 범위는 서버가 보장한다(프런트 필터만으로 막지 않는다).
import { useEffect, useState } from 'react';
import { getClasses, getClassSessions, type ClassSessionDto, type ClassSummaryDto } from '../../lib/api/class-structure';
import { listAdminOrganizations, type AdminOrganizationDto } from '../../lib/api/admin';
import { dataCenterGet } from '../../lib/api/data-center';
import { useAuthStore } from '../../stores/authStore';

export interface PickerOption { id: string; label: string }
const field = 'min-h-11 min-w-0 rounded-xl border border-[#E8E2ED] bg-white px-3 text-[14px]';
const sessionLabel = (seq: number | null, host: string | null | undefined) => `${seq ?? '?'}회차${host ? ` · ${host} 코치` : ''}`;

function useOptions<T>(load: ((signal: AbortSignal) => Promise<T[]>) | null, deps: unknown[]): { items: T[]; failed: boolean } {
  const [state, setState] = useState<{ items: T[]; failed: boolean }>({ items: [], failed: false });
  useEffect(() => {
    setState({ items: [], failed: false });
    if (!load) return undefined;
    const c = new AbortController();
    load(c.signal).then((items) => { if (!c.signal.aborted) setState({ items, failed: false }); }, () => { if (!c.signal.aborted) setState({ items: [], failed: true }); });
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

interface DcClass { class_id: string; title: string | null }
interface DcSession { session_id: string; seq: number | null; status: string }
interface DcPage<T> { items: T[] }
interface DcSessions { sessions: DcPage<DcSession> }

export function UploadStatusPicker({ mode, onChange }: { mode: 'member' | 'platform'; onChange: (sel: { classId: string | null; sessionId: string | null }) => void }) {
  const [orgId, setOrgId] = useState('');
  const [classId, setClassId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const platform = mode === 'platform';
  const me = useAuthStore((s) => s.user);
  // 담당 코치는 본인이 host 인 회차만 노출한다(서버가 최종 판정, 비담당은 403).
  const onlyMine = me?.role === 'counselor' ? me.id : null;
  const orgs = useOptions<AdminOrganizationDto>(platform ? () => listAdminOrganizations('active') : null, [platform]);
  const classes = useOptions<PickerOption>(
    platform ? (orgId ? (signal) => dataCenterGet<DcPage<DcClass>>('/classes', { org_id: orgId, limit: 100 }, signal).then((r) => r.items.map((c) => ({ id: c.class_id, label: c.title ?? '이름 없는 클래스' }))) : null)
      : (signal) => getClasses({ limit: 100 }, signal).then((r) => r.classes.filter((c: ClassSummaryDto) => c.area === 'meditation').map((c) => ({ id: c.id, label: c.title ?? '이름 없는 클래스' }))),
    [platform, orgId]);
  const sessions = useOptions<PickerOption & { host?: string | null }>(
    classId ? (signal) => platform
      ? dataCenterGet<DcSessions>(`/classes/${encodeURIComponent(classId)}/sessions`, { org_id: orgId, limit: 100 }, signal).then((r) => r.sessions.items.map((s) => ({ id: s.session_id, label: sessionLabel(s.seq, null) })))
      : getClassSessions(classId as never, signal).then((r) => r.sessions.filter((s: ClassSessionDto) => !onlyMine || s.host?.id === onlyMine).map((s: ClassSessionDto) => ({ id: s.id, label: sessionLabel(s.seq, s.host?.name) })))
      : null,
    [platform, orgId, classId, onlyMine]);

  useEffect(() => { onChange({ classId: classId || null, sessionId: sessionId || null }); }, [classId, sessionId, onChange]);
  const pickOrg = (v: string) => { setOrgId(v); setClassId(''); setSessionId(''); };
  const pickClass = (v: string) => { setClassId(v); setSessionId(''); };

  return (
    <div className="flex flex-wrap gap-2" aria-label="클래스·회차 선택">
      {platform && (
        <label className="flex flex-col gap-1 text-[12px] text-[#776D7B]">기관 · platform_admin
          <select aria-label="기관 선택" className={field} value={orgId} onChange={(e) => pickOrg(e.target.value)}>
            <option value="">기관 선택</option>{orgs.items.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-[12px] text-[#776D7B]">클래스
        <select aria-label="클래스 선택" className={field} value={classId} disabled={platform && !orgId} onChange={(e) => pickClass(e.target.value)}>
          <option value="">클래스 선택</option>{classes.items.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-[#776D7B]">회차
        <select aria-label="회차 선택" className={field} value={sessionId} disabled={!classId} onChange={(e) => setSessionId(e.target.value)}>
          <option value="">회차 선택</option>{sessions.items.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {platform && !orgId && <p className="basis-full text-[13px] text-[#776D7B]">기관 선택 후 해당 기관의 클래스·회차를 조회해요.</p>}
      {(classes.failed || sessions.failed || orgs.failed) && <p role="alert" className="basis-full text-[13px] text-amber-900">목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
    </div>
  );
}
