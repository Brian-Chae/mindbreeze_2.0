// SDD-209 H3 — 클래스 만들기 컨테이너: 마법사 상태 + 회원 검색 + 충돌 계산 + 제출(생성→초대) + 생성 완료 화면.
// `/sessions/new` 라우트에 연결돼 있다(App.tsx). 이 컴포넌트는 데이터 라우터(useBlocker) 안에서 쓴다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClassWizard } from '../../../../hooks/useClassWizard';
import { useWizardLeaveGuard } from '../../../../hooks/useWizardLeaveGuard';
import { getOrg } from '../../../../lib/api/org';
import { getCounselorProfile } from '../../../../lib/api/counselor';
import { listClients } from '../../../../lib/api/clients';
import { inviteByEmail, inviteMember } from '../../../../lib/api/class-flow-host';
import { createSession, listSessions, saveSessionAsTemplate, type SessionDto } from '../../../../lib/api/session';
import { findScheduleConflict, parseCsvEmails, type ConflictCandidate, type WizardMember } from '../../../../lib/class/class-wizard';
import { runCreate, retryInvite, type CreatedView, type HostCreateApi } from '../../../../lib/class/flow/host-create-flow';
import { getLocationAddressDefault } from '../../../../lib/class/session-location';
import { CreatedScreen, type TemplateState } from './CreatedScreen';
import { WizardView } from './CreateWizard';

const API: HostCreateApi = { createSession, inviteMember, inviteByEmail };
const INACTIVE: ReadonlySet<SessionDto['status']> = new Set(['completed', 'cancelled']);

function toCandidates(sessions: readonly SessionDto[]): ConflictCandidate[] {
  return sessions
    .filter((s) => !s.is_template && !INACTIVE.has(s.status))
    .map((s) => ({ title: s.title, scheduledAt: s.scheduled_at, durationMin: s.duration_min }));
}

export function CreateWizardContainer() {
  const navigate = useNavigate();
  const { state, dispatch, base, dirty } = useClassWizard();
  const [created, setCreated] = useState<CreatedView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ConflictCandidate[]>([]);
  const [members, setMembers] = useState<WizardMember[]>([]);
  const [membersState, setMembersState] = useState<'ok' | 'loading' | 'error'>('loading');
  const [copied, setCopied] = useState(false);
  const [templateState, setTemplateState] = useState<TemplateState>('idle');
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const { blocker, bypass } = useWizardLeaveGuard(dirty && created === null);
  const query = state.ui.memberQuery.trim();

  // 같은 시간대 충돌 계산용 기존 클래스(실패해도 만들기를 막지 않는다)
  useEffect(() => {
    let cancelled = false;
    void listSessions()
      .then((res) => { if (!cancelled) setCandidates(toCandidates(res.sessions)); })
      .catch(() => { if (!cancelled) setCandidates([]); });
    return () => { cancelled = true; };
  }, []);

  // 오프라인 기본 주소 사전 채움(직접 고친 뒤에는 덮어쓰지 않는다)
  useEffect(() => {
    let cancelled = false;
    void getCounselorProfile()
      .then(async (profile) => {
        const org = profile.org_id ? await getOrg(profile.org_id).catch(() => null) : null;
        const address = getLocationAddressDefault({ organizationAddress: org?.address, addressLine1: profile.address_line1, addressLine2: profile.address_line2 });
        if (!cancelled && address) dispatch({ type: 'patch', patch: { address } });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [dispatch]);

  // 회원 검색(서버)
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setMembersState('loading');
      void listClients({ q: query || undefined, size: 50 })
        .then((res) => {
          if (cancelled) return;
          setMembers(res.clients.map((c) => ({ id: c.id, name: c.name, email: c.email })));
          setMembersState('ok');
        })
        .catch(() => { if (!cancelled) setMembersState('error'); });
    }, query ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  const conflict = useMemo(() => findScheduleConflict(state.draft, base, candidates), [state.draft, base, candidates]);

  // 라우트 이탈이 가드에 걸리면 같은 나가기 시트를 연다
  useEffect(() => {
    if (blocker.state === 'blocked') dispatch({ type: 'openLeave' });
  }, [blocker.state, dispatch]);

  const leaveTo = useCallback((): void => {
    if (blocker.state === 'blocked') {
      blocker.proceed();
      return;
    }
    bypass();
    navigate('/sessions');
  }, [blocker, bypass, navigate]);

  const wrappedDispatch: typeof dispatch = useCallback((action) => {
    if (action.type === 'closeLeave' && blocker.state === 'blocked') blocker.reset();
    if (action.type === 'openLeave' && !dirty && blocker.state !== 'blocked') {
      leaveTo();
      return;
    }
    dispatch(action);
  }, [blocker, dirty, dispatch, leaveTo]);

  const submit = useCallback(async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const view = await runCreate(API, state.draft, base, conflict !== null);
      bypass();
      setCreated(view);
    } catch {
      setError('클래스를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  }, [state.draft, base, conflict, bypass]);

  const importCsv = useCallback((text: string): void => {
    const emails = parseCsvEmails(text);
    if (!emails) return;
    const wanted = new Set(emails);
    dispatch({ type: 'pickMembers', members: members.filter((m) => wanted.has(m.email.toLowerCase())) });
  }, [members, dispatch]);

  if (created) {
    return (
      <CreatedScreen
        view={created}
        copied={copied}
        templateState={templateState}
        retryingKey={retryingKey}
        onCopyCode={() => {
          if (!created.code) return;
          void navigator.clipboard.writeText(created.code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }).catch(() => setCopied(false));
        }}
        onOpenClass={() => navigate(`/sessions/${created.sessionId}/player`)}
        onDetail={() => navigate(`/sessions/${created.sessionId}`)}
        onList={() => navigate('/sessions')}
        onRetry={(key) => {
          setRetryingKey(key);
          void retryInvite(API, created, key).then(setCreated).finally(() => setRetryingKey(null));
        }}
        onSaveTemplate={() => {
          setTemplateState('saving');
          void saveSessionAsTemplate(created.sessionId).then(() => setTemplateState('saved')).catch(() => setTemplateState('error'));
        }}
      />
    );
  }

  return (
    <>
      <WizardView
        state={state}
        dispatch={wrappedDispatch}
        base={base}
        conflictTitle={conflict ? (conflict.title?.trim() || '다른 클래스') : null}
        members={members}
        membersState={membersState}
        onCsvText={importCsv}
        submitting={submitting}
        error={error}
        onSubmit={() => { void submit(); }}
        onExit={leaveTo}
      />
    </>
  );
}
