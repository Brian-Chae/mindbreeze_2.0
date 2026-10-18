import type {
  ClassSummaryDto, ClassDetailDto, ClassSessionDto, CounselingSummaryDto, CounselingDetailDto,
  CounselingSessionDto, ClassListResponse, CounselingListResponse, SessionBriefDto, ProgressDto,
} from '../api/class-structure';
import {
  asClassId, asRelationshipId, asSessionId, displayField,
  type ClassId, type RelationshipId, type SessionId, type DisplayField, type ReadState,
} from './read-model';

export interface SessionReadModel {
  id: SessionId;
  seq: DisplayField<number>;
  scheduledAt: DisplayField<string>;
  status: DisplayField<string>;
  hostName: DisplayField<string>;
  sessionKind: DisplayField<string>;
  hostState: DisplayField<string>;
  recordStatus: DisplayField<string>;
  reportStatus: DisplayField<string>;
}
export interface ClassReadModel {
  id: ClassId;
  title: DisplayField<string>;
  status: DisplayField<string>;
  scheduleMode: DisplayField<string>;
  plannedSessionCount: DisplayField<number>;
  sessionCount: DisplayField<number>;
  progress: DisplayField<ProgressDto>;
  nextSession: DisplayField<SessionReadModel>;
  hasOpenSession: DisplayField<boolean>;
  locationType: DisplayField<string>;
  locationAddress: DisplayField<string>;
  linkbandMode: DisplayField<string>;
  recordAudio: DisplayField<boolean>;
  capacity: DisplayField<number>;
  participantMode: DisplayField<string>;
  defaultDurationMin: DisplayField<number>;
  attendance: DisplayField<never>;
  completion: DisplayField<never>;
}
export interface HostClassReadModel extends ClassReadModel {
  hostView: { accessCode: DisplayField<string>; instructors: { userId: string; name: DisplayField<string>; role: string; status: string }[] } | null;
}
export interface CounselingReadModel {
  id: RelationshipId;
  title: '상담 일정';
  status: DisplayField<string>;
  counselorName: DisplayField<string>;
  clientDisplay: DisplayField<string>;
  modality: DisplayField<string>;
  sessionCount: DisplayField<number>;
  nextSession: DisplayField<SessionReadModel>;
  latestSession: DisplayField<SessionReadModel>;
  sessions: SessionReadModel[];
}
export interface HomeNextSchedule {
  area: 'meditation' | 'counseling';
  parentId: ClassId | RelationshipId;
  sessionId: SessionId;
  scheduledAt: string;
  seq: DisplayField<number>;
  title: DisplayField<string>;
  hostName: DisplayField<string>;
}
export interface MixedHomeModel {
  classes: ReadState<{ classes: ClassReadModel[]; total: number }>;
  counseling: ReadState<{ relationships: CounselingReadModel[]; total: number }>;
  next: DisplayField<HomeNextSchedule>;
  nextIsComplete: boolean;
}

const text = (value: string | null | undefined): DisplayField<string> => displayField(value?.trim() ? value : null);
function date(value: string | null | undefined): DisplayField<string> {
  return displayField(value && Number.isFinite(Date.parse(value)) ? value : null);
}
function session(row: SessionBriefDto, hostName?: string | null): SessionReadModel {
  return {
    id: asSessionId(row.id), seq: displayField(row.seq), scheduledAt: date(row.scheduled_at), status: text(row.status),
    hostName: text(hostName), sessionKind: displayField<string>(null), hostState: displayField<string>(null),
    recordStatus: displayField<string>(null), reportStatus: displayField<string>(null),
  };
}
export function adaptClassSessions(rows: readonly ClassSessionDto[]): SessionReadModel[] {
  return rows.map((row) => ({ ...session(row, row.host?.name), sessionKind: text(row.session_kind), hostState: text(row.host_state) }));
}
export function adaptMemberClass(row: ClassSummaryDto | ClassDetailDto): ClassReadModel {
  const detail = 'location_type' in row ? row : undefined;
  return {
    id: asClassId(row.id), title: text(row.title), status: text(row.status), scheduleMode: text(row.schedule_mode),
    plannedSessionCount: displayField(row.planned_session_count), sessionCount: displayField(row.session_count),
    progress: displayField(row.progress && Number.isFinite(row.progress.completed) && Number.isFinite(row.progress.total)
      ? { completed: row.progress.completed, total: row.progress.total } : null),
    nextSession: displayField(row.next_session ? session(row.next_session, row.next_session.host?.name) : null),
    hasOpenSession: displayField(row.has_open_session), locationType: text(detail?.location_type),
    locationAddress: text(detail?.location_address), linkbandMode: text(detail?.linkband_mode),
    recordAudio: displayField(detail?.record_audio), capacity: displayField(detail?.capacity),
    participantMode: text(detail?.participant_mode), defaultDurationMin: displayField(detail?.default_duration_min),
    attendance: displayField<never>(null), completion: displayField<never>(null),
  };
}
export function adaptHostClass(row: ClassSummaryDto | ClassDetailDto): HostClassReadModel {
  const view = 'host_view' in row ? row.host_view : null;
  return { ...adaptMemberClass(row), hostView: view ? {
    accessCode: text(view.access_code), instructors: view.instructors.map((item) => ({
      userId: item.user_id, name: text(item.name), role: item.role, status: item.status,
    })),
  } : null };
}
export function adaptCounseling(row: CounselingSummaryDto | CounselingDetailDto): CounselingReadModel {
  const rows = 'sessions' in row ? row.sessions : [];
  return {
    id: asRelationshipId(row.id), title: '상담 일정', status: text(row.status), counselorName: text(row.counselor?.name),
    clientDisplay: text(row.client_display), modality: text(row.modality_default), sessionCount: displayField(row.session_count),
    nextSession: displayField(row.next_session ? session(row.next_session, row.counselor?.name) : null),
    latestSession: displayField(row.latest_session ? session(row.latest_session, row.counselor?.name) : null),
    sessions: rows.map((item: CounselingSessionDto) => ({ ...session(item, row.counselor?.name),
      recordStatus: text(item.record_status), reportStatus: text(item.report_status) })),
  };
}
function mapState<T, R>(state: ReadState<T>, transform: (data: T) => R): ReadState<R> {
  return state.status === 'success' ? { status: 'success', data: transform(state.data) } : state;
}
/** 서버가 제공한 다음 일정만 비교하고 한쪽 실패를 전체 빈 상태로 바꾸지 않는다. */
export function adaptMixedHome(
  classes: ReadState<ClassListResponse>, counseling: ReadState<CounselingListResponse>, now = Date.now(),
): MixedHomeModel {
  const candidates: HomeNextSchedule[] = [];
  const add = (row: SessionBriefDto | null, candidate: Omit<HomeNextSchedule, 'sessionId' | 'scheduledAt' | 'seq'>) => {
    if (!row?.scheduled_at || ['completed', 'cancelled'].includes(row.status)) return;
    const at = Date.parse(row.scheduled_at);
    if (!Number.isFinite(at) || at < now) return;
    candidates.push({ ...candidate, sessionId: asSessionId(row.id), scheduledAt: row.scheduled_at, seq: displayField(row.seq) });
  };
  if (classes.status === 'success') for (const row of classes.data.classes) {
    add(row.next_session, { area: 'meditation', parentId: asClassId(row.id), title: text(row.title), hostName: text(row.next_session?.host?.name) });
  }
  if (counseling.status === 'success') for (const row of counseling.data.relationships) {
    add(row.next_session, { area: 'counseling', parentId: asRelationshipId(row.id), title: text('상담 일정'), hostName: text(row.counselor?.name) });
  }
  candidates.sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt));
  return {
    classes: mapState(classes, (data) => ({ classes: data.classes.map(adaptMemberClass), total: data.total })),
    counseling: mapState(counseling, (data) => ({ relationships: data.relationships.map(adaptCounseling), total: data.total })),
    next: displayField(candidates[0]), nextIsComplete: classes.status === 'success' && counseling.status === 'success'
      && classes.data.total === classes.data.classes.length
      && counseling.data.total === counseling.data.relationships.length,
  };
}
