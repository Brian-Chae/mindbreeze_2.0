// SDD-323 F3 — 코치/관리자 탭 공용 목록. PC(≥1024)=표, 모바일=카드. 행 버튼은 allowed_actions 에 있는 것만 렌더(숨김).
import { Fragment } from 'react';
import type { CounselorItem, MemberAction } from '../../../../lib/api/org';
import { formatDateTime } from '../ui-v2-org-format';
import { Pill } from '../ui-v2-org-parts';
import { ACCOUNT_LABEL, accountChipOf, can, roleText } from './members-model';

export type ListVariant = 'coaches' | 'admins';
export type RowHandler = (member: CounselorItem, action: MemberAction | 'open_detail') => void;

function Avatar({ name }: { name: string }) {
  return <span className="u2m-avatar" aria-hidden="true">{name.slice(-2)}</span>;
}

function Identity({ c }: { c: CounselorItem }) {
  return (
    <div className="u2m-identity">
      <Avatar name={c.name} />
      <div>
        <strong>{c.name}</strong>
        <small>{c.email}</small>
      </div>
    </div>
  );
}

function StatusChip({ c }: { c: CounselorItem }) {
  const chip = accountChipOf(c);
  return <Pill tone={chip === 'active' ? 'ok' : 'neutral'}>{ACCOUNT_LABEL[chip]}</Pill>;
}

const officeText = (c: CounselorItem): string => (c.has_personal_office ? '개인 상담소' : '기관 소속');
const activityText = (c: CounselorItem): string => (c.last_activity_at ? formatDateTime(c.last_activity_at) : '활동 없음');

function Actions({ c, variant, onAction }: { c: CounselorItem; variant: ListVariant; onAction: RowHandler }) {
  const btn = (action: MemberAction, label: string, cls = 'u2-btn-sm') =>
    can(c, action) ? (
      <button type="button" className={cls} onClick={() => onAction(c, action)} aria-label={`${c.name} ${label}`}>{label}</button>
    ) : null;
  return (
    <div className="u2-row-actions">
      {can(c, 'detail') && <button type="button" className="u2-btn-sm" onClick={() => onAction(c, 'open_detail')} aria-label={`${c.name} 상세`}>상세 →</button>}
      {variant === 'admins' && (
        <>
          {btn('revoke_admin', '권한 회수')}
          {btn('transfer_primary', '대표 지정')}
          {btn('remove', '소속 해지', 'u2-btn-danger')}
        </>
      )}
    </div>
  );
}

export function MemberList({ rows, variant, onAction }: { rows: CounselorItem[]; variant: ListVariant; onAction: RowHandler }) {
  const heads = variant === 'coaches' ? ['이름 · 이메일', '상태', '담당 클래스', '최근 활동', '활동 형태', ''] : ['이름 · 이메일', '상태', '역할', ''];
  return (
    <Fragment>
      <div className="u2-table-card u2m-table" data-testid="member-table">
        <table className="u2-table">
          <thead>
            <tr>{heads.map((h, i) => <th key={`${h}${i}`} scope="col">{h || <span className="u2m-sr">관리</span>}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} data-member-id={c.id}>
                <td><Identity c={c} /></td>
                <td><StatusChip c={c} /></td>
                {variant === 'coaches' ? (
                  <>
                    <td>{c.class_count ?? 0}개</td>
                    <td className="u2-cell-muted">{activityText(c)}</td>
                    <td>{c.has_personal_office ? <Pill tone="accent">개인 상담소</Pill> : officeText(c)}</td>
                  </>
                ) : (
                  <td>{roleText(c)}</td>
                )}
                <td><Actions c={c} variant={variant} onAction={onAction} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="u2m-cards" data-testid="member-cards">
        {rows.map((c) => (
          <article key={c.id} className="u2m-card" data-member-id={c.id}>
            <div className="u2m-card-head">
              <Identity c={c} />
              <StatusChip c={c} />
            </div>
            {variant === 'coaches' ? (
              <dl className="u2m-meta">
                <div><dt>담당 클래스</dt><dd>{c.class_count ?? 0}개</dd></div>
                <div><dt>최근 활동</dt><dd>{activityText(c)}</dd></div>
              </dl>
            ) : (
              <p className="u2m-role">{roleText(c)}</p>
            )}
            <div className="u2m-card-foot">
              {variant === 'coaches' ? (c.has_personal_office ? <Pill tone="accent">개인 상담소</Pill> : <span className="u2-muted">기관 소속</span>) : <span />}
              <Actions c={c} variant={variant} onAction={onAction} />
            </div>
          </article>
        ))}
      </div>
    </Fragment>
  );
}
