// SDD-323 F5 — 기관이 받은 가입 요청(승인/거절). 본인 신청 내역(ui-v2-org-requests-page)과 별개 화면이다.
import { useState } from 'react';
import { handleRequest, orgErrorMessage, type OrgJoinRequest } from '../../../../lib/api/org';
import { formatDateTime } from '../ui-v2-org-format';
import { Pill, type PillTone } from '../ui-v2-org-parts';
import { ActionDialog } from './member-action-dialogs';
import { filterRequests } from './members-model';
import { MemberToolbar } from './member-toolbar';
import type { TabFilters } from './coaches-tab';

const LABEL = { pending: '대기', approved: '승인됨', rejected: '거절됨' } as const;
const TONE: Record<OrgJoinRequest['status'], PillTone> = { pending: 'warn', approved: 'ok', rejected: 'danger' };
const nameOf = (r: OrgJoinRequest): string => r.user_name || r.applicant_name || '신청자';

export function RequestsTab({
  orgId,
  requests,
  loadError,
  filters,
  onFilters,
  onChanged,
  onNotice,
}: {
  orgId: string;
  requests: OrgJoinRequest[];
  loadError: boolean;
  filters: TabFilters;
  onFilters: (patch: Partial<TabFilters>) => void;
  onChanged: () => Promise<void>;
  onNotice: (message: string, kind: 'ok' | 'error') => void;
}) {
  const [rejecting, setRejecting] = useState<OrgJoinRequest | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = filterRequests(requests, filters.q, filters.status);

  const approve = async (r: OrgJoinRequest): Promise<void> => {
    if (busyId) return;
    setBusyId(r.id);
    try {
      await handleRequest(orgId, r.id, { status: 'approved' });
      onNotice(`${nameOf(r)} 님의 가입 요청을 승인했습니다.`, 'ok');
      await onChanged();
    } catch (err) {
      onNotice(orgErrorMessage(err, '가입 요청을 승인하지 못했습니다.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const buttons = (r: OrgJoinRequest) =>
    r.status === 'pending' ? (
      <div className="u2-row-actions">
        <button type="button" className="u2-btn-ok" onClick={() => void approve(r)} disabled={busyId === r.id} aria-label={`${nameOf(r)} 승인`}>승인</button>
        <button type="button" className="u2-btn-danger" onClick={() => setRejecting(r)} disabled={busyId === r.id} aria-label={`${nameOf(r)} 거절`}>거절</button>
      </div>
    ) : (
      <span className="u2-muted">{r.handled_at ? formatDateTime(r.handled_at) : '처리됨'}</span>
    );

  return (
    <section aria-labelledby="u2m-tab-title">
      <div className="u2m-sectionhead"><div><h2 id="u2m-tab-title">가입 요청</h2><p>기관 코드로 접수된 요청입니다.</p></div></div>
      <MemberToolbar
        filters={filters}
        onFilters={onFilters}
        statusOptions={[['pending', '대기'], ['approved', '승인됨'], ['rejected', '거절됨']]}
        groupOptions={[]}
        searchLabel="이름 또는 이메일 검색"
      />
      {loadError ? (
        <div className="u2-org-error" role="alert">가입 요청을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</div>
      ) : requests.length === 0 ? (
        <div className="u2-org-empty">접수된 가입 요청이 없습니다.</div>
      ) : rows.length === 0 ? (
        <div className="u2-org-empty">검색 조건에 맞는 요청이 없습니다.</div>
      ) : (
        <>
          <div className="u2-table-card u2m-table">
            <table className="u2-table">
              <thead><tr>{['이름 · 이메일', '상태', '신청일', ''].map((h, i) => <th key={`${h}${i}`} scope="col">{h || <span className="u2m-sr">처리</span>}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-request-id={r.id}>
                    <td><div className="u2m-identity"><span className="u2m-avatar" aria-hidden="true">{nameOf(r).slice(-2)}</span><div><strong>{nameOf(r)}</strong><small>{(r.user_email || r.applicant_email) ?? ''}</small></div></div></td>
                    <td><Pill tone={TONE[r.status]}>{LABEL[r.status]}</Pill>{r.status === 'rejected' && r.reason && <small className="u2m-reason">사유: {r.reason}</small>}</td>
                    <td className="u2-cell-muted">{formatDateTime(r.created_at)}</td>
                    <td>{buttons(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="u2m-cards">
            {rows.map((r) => (
              <article key={r.id} className="u2m-card" data-request-id={r.id}>
                <div className="u2m-card-head">
                  <div className="u2m-identity"><span className="u2m-avatar" aria-hidden="true">{nameOf(r).slice(-2)}</span><div><strong>{nameOf(r)}</strong><small>{(r.user_email || r.applicant_email) ?? ''}</small></div></div>
                  <Pill tone={TONE[r.status]}>{LABEL[r.status]}</Pill>
                </div>
                <p className="u2m-role">신청일 {formatDateTime(r.created_at)}</p>
                {r.status === 'rejected' && r.reason && <small className="u2-muted">사유: {r.reason}</small>}
                <div className="u2m-card-foot"><span />{buttons(r)}</div>
              </article>
            ))}
          </div>
        </>
      )}
      {rejecting && (
        <ActionDialog
          kind="reject_request"
          target={{ name: nameOf(rejecting) }}
          onClose={() => setRejecting(null)}
          onSubmit={async (reason) => {
            await handleRequest(orgId, rejecting.id, { status: 'rejected', reason });
            setRejecting(null);
            onNotice(`${nameOf(rejecting)} 님의 가입 요청을 거절했습니다.`, 'ok');
            await onChanged();
          }}
        />
      )}
    </section>
  );
}
