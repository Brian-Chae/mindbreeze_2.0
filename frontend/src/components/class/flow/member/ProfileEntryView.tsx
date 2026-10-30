// SDD-209 M0 — FM04b 개인정보 입력(이름·성별·생년월·이메일 + 재입력). 이메일 인증(OTP)은 없다.
// 로그인 회원은 계정 값을 읽기 전용으로 보여 주고 확인만 한다.
import type { ReactNode } from 'react';
import { BirthYearMonthWheel } from '../../../forms/birth-year-month-wheel';
import { CircleAlert, Clock, Mail, User } from 'lucide-react';
import { GENDER_OPTIONS, isProfilePristine, type EntryProfileDraft, type EntryProfileErrors, type EntryProfileMode } from '../../../../lib/class/flow/member-entry';
import { FlowButton, FlowCard } from '../shared/flow-primitives';
import { MemberFlowFrame } from './MemberFlowFrame';
import { RecordingConsentCheck } from './RecordingConsentCheck';

export interface EntrySummary {
  title: string;
  startLabel: string | null;
  hostName: string | null;
}

interface ProfileEntryViewProps {
  summary: EntrySummary;
  mode: EntryProfileMode;
  draft: EntryProfileDraft;
  errors: EntryProfileErrors;
  /** 서버 오류 원문은 보여 주지 않고 고정 문구만 쓴다 */
  submitError: string | null;
  submitting: boolean;
  backdropSrc?: string;
  onChange: (patch: Partial<EntryProfileDraft>) => void;
  onSubmit: () => void;
  onBack: () => void;
  /** SDD-220 F1 — 녹음·녹화 필수 동의. 넘기면 체크 전에는 입장 버튼이 비활성이다. */
  recordingConsent?: boolean;
  onRecordingConsentChange?: (checked: boolean) => void;
}

/** 라벨 줄 오른쪽에 붙는 인라인 오류 — 오류가 생겨도 폼 높이가 늘지 않아 하단 버튼을 밀지 않는다 */
function FieldError({ text }: { text: string | undefined }) {
  if (!text) return null;
  return <span className="fm-err" role="alert"><CircleAlert size={16} aria-hidden="true" />{text}</span>;
}

function FieldHead({ children, error }: { children: ReactNode; error: string | undefined }) {
  return <div className="fm-label-row">{children}<FieldError text={error} /></div>;
}

export function ProfileEntryView({ summary, mode, draft, errors, submitError, submitting, backdropSrc, onChange, onSubmit, onBack, recordingConsent, onRecordingConsentChange }: ProfileEntryViewProps) {
  const member = mode === 'member';
  const needsRecordingConsent = onRecordingConsentChange !== undefined && !recordingConsent;
  const disabled = submitting || needsRecordingConsent || (!member && isProfilePristine(draft));
  return (
    <MemberFlowFrame
      backdropSrc={backdropSrc}
      title="정보를 입력해 주세요"
      onBack={onBack}
      colClassName="fm-wide"
      foot={
        <>
          {submitError ? <div className="fm-err" role="alert"><CircleAlert size={16} aria-hidden="true" />{submitError}</div> : null}
          <FlowButton kind="primary" disabled={disabled} onClick={onSubmit}>입장하기</FlowButton>
        </>
      }
    >
      <FlowCard size="sm">
        <section className="fm-sum" aria-label="클래스 요약">
          <h2>{summary.title}</h2>
          <div className="fm-sum__meta">
            {summary.startLabel ? <span><Clock size={16} aria-hidden="true" />{summary.startLabel}</span> : null}
            {summary.hostName ? <span><User size={16} aria-hidden="true" />{summary.hostName} 코치</span> : null}
          </div>
        </section>
      </FlowCard>
      <FlowCard size="sm">
        <section className="fm-form" aria-label="정보 입력">
          <div className="fm-field">
            <FieldHead error={errors.name}><label className="fl-label" htmlFor="fm-name">이름</label></FieldHead>
            <input
              className="fm-input" id="fm-name" type="text" autoComplete="off" placeholder="이름을 입력해 주세요"
              aria-describedby={!member ? 'fm-name-hint' : undefined} value={draft.name} readOnly={member} aria-invalid={errors.name ? true : undefined}
              onChange={(e) => onChange({ name: e.target.value })}
            />
            {!member ? <p className="fm-ft" id="fm-name-hint">실명이 아니어도 됩니다(별명·반 번호 가능)</p> : null}
          </div>
          <div className="fm-field">
            <FieldHead error={errors.gender}><span className="fl-label" id="fm-gender-label">성별</span></FieldHead>
            <div className="fm-seg" role="radiogroup" aria-labelledby="fm-gender-label">
              {GENDER_OPTIONS.map((option) => (
                <button
                  key={option.value} type="button" role="radio" aria-checked={draft.gender === option.value} disabled={member}
                  onClick={() => onChange({ gender: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="fm-field">
            <FieldHead error={errors.birth}><label className="fl-label" htmlFor="fm-birth">{member ? '생년월일' : '생년월'}</label></FieldHead>
            {member ? <input className="fm-input" id="fm-birth" type="text" value={draft.birth} readOnly /> :
              <BirthYearMonthWheel id="fm-birth" value={draft.birth} invalid={Boolean(errors.birth)} onChange={(birth) => onChange({ birth })} />}
          </div>
          <div className="fm-field">
            <FieldHead error={errors.email}><label className="fl-label" htmlFor="fm-email">이메일</label></FieldHead>
            <input
              className="fm-input" id="fm-email" type="email" inputMode="email" autoComplete="off" placeholder="name@example.com"
              value={draft.email} readOnly={member} aria-invalid={errors.email ? true : undefined}
              onChange={(e) => onChange({ email: e.target.value })}
            />
          </div>
          {member ? null : (
            <div className="fm-field">
              <FieldHead error={errors.emailConfirm}><label className="fl-label" htmlFor="fm-email2">이메일 확인</label></FieldHead>
              <input
                className="fm-input" id="fm-email2" type="email" inputMode="email" autoComplete="off" placeholder="이메일을 한 번 더 입력해 주세요"
                value={draft.emailConfirm} aria-invalid={errors.emailConfirm ? true : undefined}
                onChange={(e) => onChange({ emailConfirm: e.target.value })}
              />
              </div>
          )}
          <div className={`fm-fnote left${member ? ' span2' : ''}`}><Mail size={16} aria-hidden="true" />리포트는 입력한 이메일로 보내 드려요</div>
        </section>
      </FlowCard>
      {onRecordingConsentChange ? (
        <FlowCard size="sm">
          <RecordingConsentCheck checked={Boolean(recordingConsent)} onChange={onRecordingConsentChange} />
        </FlowCard>
      ) : null}
    </MemberFlowFrame>
  );
}
