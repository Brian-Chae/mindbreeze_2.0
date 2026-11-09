// SDD-323 F4 — 초대·가입 현황. 대기/만료/가입됨 필터, 재발송 쿨다운(서버 retry_after_sec) 비활성+남은 시간, 만료 정보가 없으면 '만료 정보 없음'.
import { useEffect, useState } from 'react';
import {
  apiErrorCode,
  inviteRetryAfterSec,
  orgErrorMessage,
  resendCounselorInvite,
  type CounselorItem,
} from '../../../../lib/api/org';
import { formatDateTime } from '../ui-v2-org-format';
import { Pill, type PillTone } from '../ui-v2-org-parts';
import { INVITE_LABEL, invitesOf, inviteStateOf, matchQuery, remainText, type InviteState, type MemberGroup } from './members-model';
import { MemberToolbar } from './member-toolbar';
import type { TabFilters } from './coaches-tab';

const TONE: Record<InviteState, PillTone> = { pending: 'warn', expired: 'danger', joined: 'ok' };
const roleOf = (c: CounselorItem): string => (c.role === 'org_admin' ? '기관 관리자' : '코치');

export function InvitesTab({
  orgId,
  items,
  filters,
  onFilters,
  onChanged,
  onNotice,
}: {
  orgId: string;
  items: CounselorItem[];
  filters: TabFilters;
  onFilters: (patch: Partial<TabFilters>) => void;
  onChanged: () => Promise<void>;
  onNotice: (message: string, kind: 'ok' | 'error') => void;
}) {
  const [cooldown, setCooldown] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (Object.keys(cooldown).length === 0) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  const all = invitesOf(items);
  const rows = all.filter((c) => matchQuery(c, filters.q) && (!filters.status || inviteStateOf(c) === filters.status));

  const remain = (id: string): number => Math.max(0, Math.ceil(((cooldown[id] ?? 0) - now) / 1000));

  const resend = async (c: CounselorItem): Promise<void> => {
    if (busyId) return;
    setBusyId(c.id);
    try {
      await resendCounselorInvite(orgId, c.id);
      onNotice(`${c.name} 님에게 초대 메일을 다시 보냈습니다.`, 'ok');
      await onChanged();
    } catch (err) {
      if (apiErrorCode(err) === 'INVITE_COOLDOWN') {
        const sec = inviteRetryAfterSec(err) ?? 60;
        const at = Date.now(); // 같은 시각을 기준으로 잡아 남은 시간이 1초 늘어나 보이지 않게 한다
        setNow(at);
        setCooldown((prev) => ({ ...prev, [c.id]: at + sec * 1000 }));
        onNotice(`잠시 후 다시 보낼 수 있습니다. (${remainText(sec)} 뒤)`, 'error');
      } else {
        onNotice(orgErrorMessage(err, '초대 메일을 다시 보내지 못했습니다.'), 'error');
      }
    } finally {
      setBusyId(null);
    }
  };

  const dateText = (c: CounselorItem): string => {
    const invited = c.invited_at ? formatDateTime(c.invited_at) : '-';
    const expire = c.invite_expires_at ? formatDateTime(c.invite_expires_at) : '만료 정보 없음';
    return inviteStateOf(c) === 'joined' ? `초대 ${invited}` : `초대 ${invited} / 만료 ${expire}`;
  };

  const action = (c: CounselorItem) => {
    if (inviteStateOf(c) === 'joined' || !c.allowed_actions?.includes('resend_invite')) return <span className="u2-muted">-</span>;
    const left = remain(c.id);
    return (
      <button type="button" className="u2-btn-sm" onClick={() => void resend(c)} disabled={left > 0 || busyId === c.id} aria-label={`${c.name} 재발송`}>
        {left > 0 ? `재발송 (${remainText(left)} 후)` : busyId === c.id ? '발송 중…' : '재발송'}
      </button>
    );
  };

  return (
    <section aria-labelledby="u2m-tab-title">
      <div className="u2m-sectionhead"><div><h2 id="u2m-tab-title">초대·가입 현황</h2><p>초대 상태를 확인하고 필요한 초대를 다시 보내세요.</p></div></div>
      <MemberToolbar
        filters={filters}
        onFilters={onFilters}
        statusOptions={[['pending', '대기'], ['expired', '만료'], ['joined', '가입됨']]}
        groupOptions={[['status', '상태별']]}
        searchLabel="이름 또는 이메일 검색"
      />
      {all.length === 0 ? (
        <div className="u2-org-empty">아직 보낸 초대가 없습니다. 상단의 '구성원 초대'로 시작해 보세요.</div>
      ) : rows.length === 0 ? (
        <div className="u2-org-empty">검색 조건에 맞는 초대가 없습니다.</div>
      ) : (
        <>
          <div className="u2-table-card u2m-table">
            <table className="u2-table">
              <thead>
                <tr>{['이름 · 이메일', '상태', '초대 역할', '초대일 / 만료일', ''].map((h, i) => <th key={`${h}${i}`} scope="col">{h || <span className="u2m-sr">관리</span>}</th>)}</tr>
              </thead>
              <tbody>
                {(filters.group === 'status' ? [...rows].sort((a, b) => inviteStateOf(a).localeCompare(inviteStateOf(b))) : rows).map((c) => {
                  const st = inviteStateOf(c);
                  return (
                    <tr key={c.id} data-member-id={c.id}>
                      <td><div className="u2m-identity"><span className="u2m-avatar" aria-hidden="true">{c.name.slice(-2)}</span><div><strong>{c.name}</strong><small>{c.email}</small></div></div></td>
                      <td><Pill tone={TONE[st]}>{INVITE_LABEL[st]}</Pill></td>
                      <td>{roleOf(c)}</td>
                      <td className="u2-cell-muted">{dateText(c)}</td>
                      <td>{action(c)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="u2m-cards">
            {rows.map((c) => {
              const st = inviteStateOf(c);
              return (
                <article key={c.id} className="u2m-card" data-member-id={c.id}>
                  <div className="u2m-card-head">
                    <div className="u2m-identity"><span className="u2m-avatar" aria-hidden="true">{c.name.slice(-2)}</span><div><strong>{c.name}</strong><small>{c.email}</small></div></div>
                    <Pill tone={TONE[st]}>{INVITE_LABEL[st]}</Pill>
                  </div>
                  <p className="u2m-role">{roleOf(c)} 초대</p>
                  <small className="u2-muted">{dateText(c)}</small>
                  <div className="u2m-card-foot"><span />{action(c)}</div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export type { MemberGroup };
