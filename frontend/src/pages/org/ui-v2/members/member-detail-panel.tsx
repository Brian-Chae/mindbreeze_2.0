// SDD-323 F6 — 구성원 상세. 기관 내 클래스·담당 회원 요약, 최근 활동(기관 한정), 개인정보 수정(CounselorInfoEditor 재사용).
// 상담 본문·녹음·리포트 본문은 표시하지 않는다.
import { useEffect, useState } from 'react';
import CounselorInfoEditor from '../../../../components/counselor/counselor-info-editor';
import { getOrgCounselorProfile, patchOrgCounselorProfile } from '../../../../lib/api/counselor-info';
import { getCounselorActivity, orgErrorMessage, type CounselorActivity, type CounselorItem } from '../../../../lib/api/org';
import { sessionStatusLabel } from '../../../../lib/session-status';
import { formatDateTime } from '../ui-v2-org-format';
import { OrgDialog, Pill } from '../ui-v2-org-parts';
import { ACCOUNT_LABEL, accountChipOf, can, roleText } from './members-model';

export function MemberDetailPanel({
  orgId,
  member,
  onClose,
  onAction,
  onSaved,
}: {
  orgId: string;
  member: CounselorItem;
  onClose: () => void;
  onAction: (member: CounselorItem, action: 'promote' | 'remove') => void;
  onSaved: () => void;
}) {
  const [activity, setActivity] = useState<CounselorActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCounselorActivity(orgId, member.id)
      .then((a) => { if (!cancelled) setActivity(a); })
      .catch((err) => { if (!cancelled) setError(orgErrorMessage(err, '활동 정보를 불러오지 못했습니다.')); });
    return () => { cancelled = true; };
  }, [orgId, member.id]);

  const chip = accountChipOf(member);
  const classes = activity?.classes ?? [];

  return (
    <OrgDialog labelledBy="u2m-detail-title" wide onClose={onClose}>
      <div className="u2m-detail-head">
        <div>
          <h3 id="u2m-detail-title">{member.name}</h3>
          <p>{member.email}</p>
        </div>
        <button type="button" className="u2-btn-sm" onClick={onClose}>닫기</button>
      </div>
      <div className="u2m-chips">
        <Pill tone={chip === 'active' ? 'ok' : 'neutral'}>{ACCOUNT_LABEL[chip]}</Pill>
        {member.has_personal_office && <Pill tone="accent">개인 상담소</Pill>}
        <Pill tone="neutral">{roleText(member)}</Pill>
      </div>

      <dl className="u2-org-facts">
        <div><dt>기관 내 클래스</dt><dd>{member.class_count ?? classes.length}개</dd></div>
        <div><dt>담당 회원</dt><dd>{activity?.client_count != null ? `${activity.client_count}명` : '-'}</dd></div>
        <div><dt>최근 활동</dt><dd>{member.last_activity_at ? formatDateTime(member.last_activity_at) : '활동 없음'}</dd></div>
        <div><dt>코치 코드</dt><dd>{member.counselor_code ?? '-'}</dd></div>
      </dl>

      {error && <p className="u2-org-error" role="alert">{error}</p>}

      <div className="u2-row-actions u2m-detail-actions">
        {can(member, 'edit_profile') && !editing && <button type="button" className="u2-btn-sm" onClick={() => setEditing(true)}>개인정보 수정</button>}
        {can(member, 'promote') && <button type="button" className="u2-btn-sm" onClick={() => onAction(member, 'promote')}>관리자 지정</button>}
        {can(member, 'remove') && <button type="button" className="u2-btn-danger" onClick={() => onAction(member, 'remove')}>소속 해지</button>}
      </div>

      {editing && (
        <section className="u2-org-legacy" aria-label={`개인정보 수정 — ${member.name}`}>
          <p className="u2-muted">다른 소속에서도 같은 프로필을 사용합니다. 이메일은 변경할 수 없는 아이디입니다.</p>
          <CounselorInfoEditor
            load={() => getOrgCounselorProfile(orgId, member.id)}
            save={(payload) => patchOrgCounselorProfile(orgId, member.id, payload)}
            onCancel={() => setEditing(false)}
            onSaved={() => { setEditing(false); onSaved(); }}
          />
        </section>
      )}

      <h4 className="u2m-subhead">담당 클래스</h4>
      {activity == null && !error ? (
        <p className="u2-org-loading" role="status">불러오는 중…</p>
      ) : classes.length === 0 ? (
        <p className="u2-muted">이 기관에서 담당하는 클래스가 없습니다.</p>
      ) : (
        <ul className="u2m-list">
          {classes.map((c) => (
            <li key={c.id}><strong>{c.name}</strong><small>{sessionStatusLabel(c.status) || c.status} · 회원 {c.member_count}명</small></li>
          ))}
        </ul>
      )}

      <h4 className="u2m-subhead">최근 활동</h4>
      {activity == null && !error ? null : (activity?.sessions.length ?? 0) === 0 ? (
        <p className="u2-muted">활동 없음</p>
      ) : (
        <ul className="u2m-list">
          {activity!.sessions.map((s) => (
            <li key={s.id}><strong>{s.title || '제목 없음'}</strong><small>{formatDateTime(s.started_at ?? s.scheduled_at)} · {sessionStatusLabel(s.status) || s.status}</small></li>
          ))}
          <li className="u2m-footnote">이 기관의 세션 정보만 표시합니다.</li>
        </ul>
      )}
    </OrgDialog>
  );
}
