// SDD-209 SH6 — FH04 상담사 클래스 상세 본문 뷰(순수 props). 히어로(다음 할 일) → 정보 카드(입장 코드 표시·공유) → 이메일 초대 현황 → 참여자.
// 장소 수정기·참가자 선택기는 슬롯으로 받는다(기존 컴포넌트 재사용).
import type { ReactNode } from 'react';
import { CalendarDays, Copy, DoorClosed, DoorOpen, FileText, Link as LinkIcon, Mail, Pencil, Play, Send, UserPlus, Users, X, Clock, TriangleAlert } from 'lucide-react';
import { heroBackdrop } from './shell-data';
import type { HostDetailData, HostNextIcon, MailInviteRow } from './host-shell-data';
import type { ClassActionKind } from './ClassActionSheet';
import { MethodChips } from './MethodChips';
import { HOST_CHIP_TONES } from './shell-icons';
import { StatusChip } from './StatusChip';
import './shell-kit.css';

const NEXT_ICONS: Readonly<Record<HostNextIcon, typeof Clock>> = {
  'door-open': DoorOpen, clock: Clock, users: Users, play: Play, file: FileText, copy: Copy,
};

interface HostDetailViewProps {
  data: HostDetailData;
  /** 히어로 id(배경 사진 고정용) */
  heroId?: string;
  onCta: () => void;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onEditPlace: () => void;
  onRequestAction: (kind: ClassActionKind) => void;
  onInvite: () => void;
  onRemove: (userId: string) => void;
  onResend: (id: string) => void;
  /** 방금 복사한 항목 표시 */
  copied?: 'code' | 'link' | null;
  /** 장소 수정 중이면 정보 카드의 장소 줄을 이 슬롯으로 바꾼다 */
  placeEditor?: ReactNode;
  /** 참여자 초대 패널(선택기) */
  invitePanel?: ReactNode;
}

function MailRows({ rows, onResend }: { rows: MailInviteRow[]; onResend: (id: string) => void }) {
  return (
    <section className="sh-card" aria-label="이메일 초대" data-testid="mail-invites">
      <div className="sh-phead"><h3>이메일 초대 {rows.length}명</h3></div>
      {rows.map((row) => (
        <div className="sh-person" key={row.key}>
          <span className="sh-person__av"><Mail size={20} aria-hidden="true" /></span>
          <div>
            <div className="sh-person__nm">{row.email}</div>
            <div className="sh-person__st">
              <span className={`sh-chip ${row.tone}`}>{row.label}</span>
            </div>
            {row.waitText ? <div className="sh-dim2">{row.waitText}</div> : null}
          </div>
          <div>
            {row.again === 'gone' ? null : (
              <button type="button" className="sh-smbtn" data-testid="resend-mail" disabled={row.again === 'wait'} onClick={() => onResend(row.key)}>
                {row.again === 'wait' ? <Clock size={20} aria-hidden="true" /> : <Send size={20} aria-hidden="true" />}다시 보내기
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

export function HostDetailView({
  data, heroId = 'detail', onCta, onCopyCode, onCopyLink, onEditPlace, onRequestAction, onInvite, onRemove, onResend, copied = null, placeEditor, invitePanel,
}: HostDetailViewProps) {
  const NextIcon = NEXT_ICONS[data.next.icon];
  const CtaIcon = NEXT_ICONS[data.next.icon === 'users' || data.next.icon === 'play' || data.next.icon === 'clock' ? 'door-open' : data.next.icon];
  const { code, people } = data;
  return (
    <>
      <section className="sh-hero sh-dhero" data-testid="host-detail-hero">
        <div className="sh-hero__bg" style={{ backgroundImage: `url(${heroBackdrop(heroId)})` }} aria-hidden="true" />
        <div className="sh-hero__in">
          <div className="sh-line"><StatusChip chip={data.chip} dark tone={HOST_CHIP_TONES[data.chip]} /></div>
          <h2 className="sh-live__title">{data.title}</h2>
          <span className="sh-wait"><CalendarDays size={20} aria-hidden="true" />{data.whenLabel}</span>
          <div className="sh-next">
            <NextIcon size={20} aria-hidden="true" />
            <div className="sh-next__tx"><b>{data.next.title}</b><span>{data.next.sub}</span></div>
          </div>
          <button type="button" className="sh-hcta" data-testid="detail-cta" onClick={onCta}>
            <CtaIcon size={20} aria-hidden="true" />{data.next.cta}
          </button>
        </div>
      </section>

      <section className="sh-card" aria-label="클래스 정보">
        <div className="sh-kv">
          <span className="sh-kv__k">입장 코드</span>
          <div className="sh-kv__v">
            {code.state === 'closed' ? <span>코드가 닫혔어요</span>
              : code.state === 'none' ? <span className="sh-dim2">클래스를 열면 코드가 만들어져요</span>
                : (
                  <>
                    <span className="sh-codeval" aria-label="입장 코드 4자리">{code.value}</span>
                    <button type="button" className="sh-smbtn" data-testid="copy-code" disabled={code.state !== 'active'} onClick={onCopyCode}>
                      <Copy size={20} aria-hidden="true" />{copied === 'code' ? '복사했어요' : '코드 복사'}
                    </button>
                    {code.state === 'wait' ? <span className="sh-dim2">열리면 사용할 수 있어요</span> : null}
                  </>
                )}
          </div>
        </div>
        <div className="sh-kv">
          <span className="sh-kv__k">초대</span>
          <div className="sh-kv__v">
            <span>{data.inviteText}</span>
            {data.showLinkCopy ? (
              <button type="button" className="sh-smbtn" data-testid="copy-link" onClick={onCopyLink}>
                <LinkIcon size={20} aria-hidden="true" />{copied === 'link' ? '복사했어요' : '링크 복사'}
              </button>
            ) : null}
          </div>
        </div>
        <div className="sh-kv">
          <span className="sh-kv__k">방식</span>
          <div className="sh-kv__v"><span className="sh-kv__chips"><MethodChips place={data.place} mode={data.mode} band={data.band} /></span></div>
        </div>
        <div className="sh-kv">
          <span className="sh-kv__k">장소</span>
          <div className="sh-kv__v">
            {placeEditor ?? (
              <>
                <span>{data.placeText}</span>
                {data.canEditPlace ? (
                  <button type="button" className="sh-smbtn" data-testid="edit-place" onClick={onEditPlace}><Pencil size={20} aria-hidden="true" />수정</button>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="sh-kv">
          <span className="sh-kv__k">기록</span>
          <div className="sh-kv__v"><span>{data.recordText}</span></div>
        </div>
        {data.cancelRow ? (
          <button type="button" className="sh-cancelrow" data-testid="cancel-row" onClick={() => onRequestAction(data.cancelRow!.kind)}>
            {data.cancelRow.kind === 'close' ? <DoorClosed size={20} aria-hidden="true" /> : <X size={20} aria-hidden="true" />}{data.cancelRow.label}
          </button>
        ) : null}
      </section>

      {data.mailInvites.length > 0 ? <MailRows rows={data.mailInvites} onResend={onResend} /> : null}

      <section className="sh-card" aria-label="참여자">
        <div className="sh-phead">
          <h3>참여자 {people.total}/{people.max}명</h3>
          {people.canInvite || invitePanel ? (
            <button type="button" className="sh-smbtn line" data-testid="invite-open" disabled={!people.canInvite} onClick={onInvite}>
              <UserPlus size={20} aria-hidden="true" />초대
            </button>
          ) : null}
        </div>
        {people.items.length === 0 && people.waitlist.length === 0 ? <p className="sh-dim2">아직 참여자가 없어요</p> : null}
        {[...people.items, ...people.waitlist].map((person) => (
          <div className="sh-person" key={person.key}>
            <span className="sh-person__av">{person.initial}</span>
            <div>
              <div className="sh-person__nm">{person.name}</div>
              <div className="sh-person__st">
                {person.chip === 'waitlist'
                  ? <span className="sh-chip warn"><TriangleAlert size={16} aria-hidden="true" />{person.waitLabel}</span>
                  : <span className="sh-chip mute"><Send size={16} aria-hidden="true" />초대됨</span>}
              </div>
            </div>
            <div>
              {person.removable && person.userId ? (
                <button type="button" className="sh-xbtn" data-testid="remove-participant" aria-label={`${person.name} 제거`} onClick={() => onRemove(person.userId!)}>
                  <X size={20} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {invitePanel ? <div className="sh-inline-panel">{invitePanel}</div> : null}
      </section>
    </>
  );
}
