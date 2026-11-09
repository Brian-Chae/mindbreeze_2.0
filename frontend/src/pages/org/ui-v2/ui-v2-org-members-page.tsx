// SDD-323 F2 — 기관 구성원 관리. 4탭(코치/기관 관리자/초대·가입 현황/가입 요청). 탭·검색·필터·그룹핑·선택 행은 URL 쿼리에 보관한다.
// 버튼 노출은 서버가 내려준 allowed_actions·blocked_reasons 만 본다. 정지·재활성은 이 화면에 없다(플랫폼 관리자 전용).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CounselorInviteSection from '../../../components/org/counselor-invite-section';
import { UiV2OrgShell } from '../../../components/ui-v2/ui-v2-org-shell';
import { getOrgDashboard } from '../../../lib/api/dashboard';
import {
  getCounselorsEtag,
  listCounselors,
  listOrgJoinRequests,
  orgCodeMessage,
  removeCounselor,
  transferPrimaryAdmin,
  updateCounselor,
  type CounselorItem,
  type CounselorRole,
  type MemberAction,
  type OrgJoinRequest,
} from '../../../lib/api/org';
import { OrgDialog } from './ui-v2-org-parts';
import { AdminsTab } from './members/admins-tab';
import { CoachesTab, type TabFilters } from './members/coaches-tab';
import { InvitesTab } from './members/invites-tab';
import { RequestsTab } from './members/requests-tab';
import { ActionDialog, BlockedDialog } from './members/member-action-dialogs';
import { MemberDetailPanel } from './members/member-detail-panel';
import { MEMBER_TABS, type ActionKind, adminsOf, can, coachesOf, invitesOf, inviteStateOf, parseGroup, parseTab, type MemberTab } from './members/members-model';
import '../../../styles/ui-v2-org-members.css';

type Pending = { kind: ActionKind; member: CounselorItem } | null;

const ACTION_TO_KIND: Partial<Record<MemberAction, ActionKind>> = {
  promote: 'promote',
  revoke_admin: 'revoke_admin',
  remove: 'remove',
  transfer_primary: 'transfer_primary',
};

export function UiV2OrgMembersPage() {
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const filters: TabFilters = { q: params.get('q') ?? '', status: params.get('status') ?? '', group: parseGroup(params.get('group')) };
  const selectedId = params.get('member');

  const [orgId, setOrgId] = useState<string | null>(null);
  const [items, setItems] = useState<CounselorItem[]>([]);
  const [requests, setRequests] = useState<OrgJoinRequest[]>([]);
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; kind: 'ok' | 'error' } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [blocked, setBlocked] = useState<{ title: string; message: string } | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteRole, setInviteRole] = useState<CounselorRole>('counselor');
  const [showPromotePicker, setShowPromotePicker] = useState(false);
  const inviteTrigger = useRef<HTMLButtonElement | null>(null);

  const patchParams = useCallback((patch: Record<string, string | null>, replace = true): void => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    }, { replace });
  }, [setParams]);

  const refresh = useCallback(async (targetOrgId: string): Promise<void> => {
    const [list, reqs] = await Promise.all([
      listCounselors(targetOrgId),
      listOrgJoinRequests(targetOrgId).then((r) => ({ ok: true as const, r })).catch(() => ({ ok: false as const, r: [] as OrgJoinRequest[] })),
    ]);
    setItems(list);
    setRequests(reqs.r);
    setRequestsFailed(!reqs.ok);
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const dash = await getOrgDashboard();
      setOrgId(dash.org_id);
      await refresh(dash.org_id);
    } catch (err) {
      setLoadError(err instanceof Error && err.message ? err.message : '구성원 목록을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => { void load(); }, [load]);

  const reload = useCallback(async (): Promise<void> => {
    if (orgId) await refresh(orgId).catch(() => undefined);
  }, [orgId, refresh]);

  const showNotice = useCallback((message: string, kind: 'ok' | 'error'): void => setNotice({ message, kind }), []);

  const counts = useMemo<Record<MemberTab, number>>(() => ({
    coaches: coachesOf(items).length,
    admins: adminsOf(items).length,
    invites: invitesOf(items).filter((c) => inviteStateOf(c) !== 'joined').length,
    requests: requests.filter((r) => r.status === 'pending').length,
  }), [items, requests]);

  const selected = selectedId ? items.find((c) => c.id === selectedId) ?? null : null;
  const promotable = coachesOf(items).filter((c) => can(c, 'promote'));

  const setFilters = (patch: Partial<TabFilters>): void => {
    const next = { ...filters, ...patch };
    patchParams({ q: next.q || null, status: next.status || null, group: next.group || null });
  };

  const goTab = (id: MemberTab): void => patchParams({ tab: id === 'coaches' ? null : id, q: null, status: null, group: null, member: null }, false);

  const handleAction = (member: CounselorItem, action: MemberAction | 'open_detail'): void => {
    if (action === 'open_detail') {
      patchParams({ member: member.id }, false);
      return;
    }
    const kind = ACTION_TO_KIND[action];
    if (!kind) return;
    const code = member.blocked_reasons?.[action];
    if (code) {
      setBlocked({
        title: kind === 'remove' ? '소속을 해지할 수 없습니다' : kind === 'revoke_admin' ? '권한을 회수할 수 없습니다' : '지금은 진행할 수 없습니다',
        message: orgCodeMessage(code) ?? '현재 조건에서는 진행할 수 없습니다.',
      });
      return;
    }
    setPending({ kind, member });
  };

  const submitPending = async (reason: string): Promise<void> => {
    if (!orgId || !pending) return;
    const { kind, member } = pending;
    if (kind === 'promote') await updateCounselor(orgId, member.id, { role: 'org_admin', reason });
    else if (kind === 'revoke_admin') await updateCounselor(orgId, member.id, { role: 'counselor', reason });
    else if (kind === 'remove') await removeCounselor(orgId, member.id, reason);
    else if (kind === 'transfer_primary') {
      const current = items.find((c) => c.is_primary_admin);
      const version = await getCounselorsEtag(orgId);
      await transferPrimaryAdmin(orgId, { target_user_id: member.id, expected_primary_admin_id: current?.id ?? '', reason }, version);
    }
    setPending(null);
    if (kind === 'remove') patchParams({ member: null });
    showNotice(
      kind === 'promote' ? `${member.name} 님을 기관 관리자로 지정했습니다.`
        : kind === 'revoke_admin' ? `${member.name} 님의 관리자 권한을 회수했습니다.`
          : kind === 'remove' ? `${member.name} 님의 소속을 해지했습니다.`
            : `${member.name} 님을 대표 관리자로 지정했습니다.`,
      'ok',
    );
    await reload();
  };

  const closeInvite = (): void => {
    setShowInvite(false);
    window.setTimeout(() => inviteTrigger.current?.focus(), 0);
  };

  return (
    <UiV2OrgShell
      title="구성원"
      subtitle="코치와 관리자, 초대와 가입 요청을 한곳에서 관리합니다."
      actions={orgId ? (
        <button ref={inviteTrigger} type="button" data-header-action="primary" className="u2-primary" onClick={() => setShowInvite(true)}>+ 구성원 초대</button>
      ) : undefined}
    >
      {loadError ? (
        <div className="u2-org-error" role="alert">
          {loadError}{' '}
          <button type="button" className="u2-btn-sm" onClick={() => void load()}>다시 시도</button>
        </div>
      ) : null}
      {notice && <div className={notice.kind === 'ok' ? 'u2m-feedback' : 'u2-org-error'} role={notice.kind === 'ok' ? 'status' : 'alert'}>{notice.message}</div>}

      {loading ? (
        <div role="status" className="u2-org-loading">불러오는 중...</div>
      ) : orgId ? (
        <div className="u2-org-stack u2m-page">
          <nav className="u2m-tabs" aria-label="구성원 분류">
            {MEMBER_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={tab === t.id ? 'page' : undefined}
                className={tab === t.id ? 'is-active' : ''}
                onClick={() => goTab(t.id)}
              >
                {t.label} <b>{counts[t.id]}</b>
              </button>
            ))}
          </nav>

          {tab === 'coaches' && <CoachesTab items={items} filters={filters} onFilters={setFilters} onAction={handleAction} />}
          {tab === 'admins' && (
            <AdminsTab
              items={items}
              filters={filters}
              onFilters={setFilters}
              onAction={handleAction}
              onPickPromote={promotable.length > 0 ? () => setShowPromotePicker(true) : null}
            />
          )}
          {tab === 'invites' && <InvitesTab orgId={orgId} items={items} filters={filters} onFilters={setFilters} onChanged={reload} onNotice={showNotice} />}
          {tab === 'requests' && <RequestsTab orgId={orgId} requests={requests} loadError={requestsFailed} filters={filters} onFilters={setFilters} onChanged={reload} onNotice={showNotice} />}
        </div>
      ) : null}

      {selected && orgId && !pending && (
        <MemberDetailPanel
          key={selected.id}
          orgId={orgId}
          member={selected}
          onClose={() => patchParams({ member: null }, false)}
          onAction={(m, a) => handleAction(m, a)}
          onSaved={() => { showNotice('개인정보를 수정했습니다.', 'ok'); void reload(); }}
        />
      )}

      {pending && <ActionDialog kind={pending.kind} target={pending.member} onClose={() => setPending(null)} onSubmit={submitPending} />}
      {blocked && <BlockedDialog title={blocked.title} message={blocked.message} onClose={() => setBlocked(null)} />}

      {showPromotePicker && (
        <PromotePicker
          options={promotable}
          onClose={() => setShowPromotePicker(false)}
          onPick={(member) => { setShowPromotePicker(false); setPending({ kind: 'promote', member }); }}
        />
      )}

      {showInvite && orgId && (
        <OrgDialog labelledBy="u2m-invite-title" wide onClose={closeInvite}>
          <h3 id="u2m-invite-title">구성원 초대</h3>
          <label className="u2-dialog-label">
            역할
            <select className="u2-org-field" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as CounselorRole)} aria-label="초대 역할">
              <option value="counselor">코치</option>
              <option value="org_admin">기관 관리자</option>
            </select>
          </label>
          <div className="u2-org-legacy" style={{ padding: 0, marginTop: 14 }}>
            <CounselorInviteSection orgId={orgId} inviteList={[]} showList={false} inviteRole={inviteRole} onRefresh={reload} />
          </div>
          <div className="u2-dialog-actions"><button type="button" className="u2-secondary" onClick={closeInvite}>닫기</button></div>
        </OrgDialog>
      )}
    </UiV2OrgShell>
  );
}

function PromotePicker({ options, onPick, onClose }: { options: CounselorItem[]; onPick: (m: CounselorItem) => void; onClose: () => void }) {
  const [id, setId] = useState(options[0]?.id ?? '');
  return (
    <OrgDialog labelledBy="u2m-promote-title" onClose={onClose}>
      <h3 id="u2m-promote-title">기존 코치 지정</h3>
      <p>관리자로 지정할 코치를 선택하세요.</p>
      <label className="u2-dialog-label">
        대상 코치
        <select className="u2-org-field" value={id} onChange={(e) => setId(e.target.value)} aria-label="대상 코치">
          {options.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.email}</option>)}
        </select>
      </label>
      <div className="u2-dialog-actions">
        <button type="button" className="u2-secondary" onClick={onClose}>취소</button>
        <button type="button" className="u2-primary" disabled={!id} onClick={() => { const m = options.find((o) => o.id === id); if (m) onPick(m); }}>다음</button>
      </div>
    </OrgDialog>
  );
}
