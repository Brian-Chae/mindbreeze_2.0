// SDD-209 M0 — FM04 코드 입력(몰입형, 로그인 없음). 이 화면에는 개인정보 입력이 없다.
// 오류 문구는 없는/틀린/종료 코드를 구분하지 않고 하나만 쓴다.
import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { CircleAlert, CircleCheck, Clock, Key, LogIn, User } from 'lucide-react';
import { CODE_LENGTH, sanitizeCodeInput } from '../../../../lib/class/flow/member-entry';
import { MemberBrandMark } from '../../player/member/MemberBrandMark';
import { FlowButton, FlowCard, FlowH1, FlowSub } from '../shared/flow-primitives';
import { MemberFlowFrame } from './MemberFlowFrame';

/** error = 없는/틀린/종료 코드(구분 없음) · throttled = 시도 제한 · unavailable = 서버·네트워크 문제(코드 탓이 아님) */
export type CodeEntryStatus = 'idle' | 'verifying' | 'error' | 'throttled' | 'unavailable';

interface CodeEntryViewProps {
  digits: string;
  status: CodeEntryStatus;
  /** 로그인 회원이면 표시 이름 — 다음 단계를 계정 정보로 채운다 */
  memberName: string | null;
  backdropSrc?: string;
  onChange: (digits: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

function Hint({ digits, status, memberName }: { digits: string; status: CodeEntryStatus; memberName: string | null }) {
  if (status === 'error') {
    return <div className="fm-hint" data-bad="true" role="alert"><CircleAlert size={16} aria-hidden="true" />코드를 확인해 주세요</div>;
  }
  if (status === 'throttled') {
    return <div className="fm-hint" data-bad="true" role="alert"><Clock size={16} aria-hidden="true" />잠시 후 다시 시도해 주세요</div>;
  }
  if (status === 'unavailable') {
    return <div className="fm-hint" data-bad="true" role="alert"><CircleAlert size={16} aria-hidden="true" />잠시 문제가 생겼어요. 다시 시도해 주세요</div>;
  }
  if (memberName) {
    return <div className="fm-hint"><User size={16} aria-hidden="true" />내 계정 정보로 다음 단계를 채워 드려요</div>;
  }
  if (digits.length === CODE_LENGTH) {
    return <div className="fm-hint"><CircleCheck size={16} aria-hidden="true" />4자리를 모두 입력했어요</div>;
  }
  return <div className="fm-hint"><Key size={16} aria-hidden="true" />숫자 4자리를 모두 입력하면 확인할 수 있어요</div>;
}

export function CodeEntryView({ digits, status, memberName, backdropSrc, onChange, onSubmit, onBack }: CodeEntryViewProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const locked = status === 'throttled' || status === 'verifying';
  const bad = status === 'error';
  const activeIndex = Math.min(digits.length, CODE_LENGTH - 1);

  const focusCell = (index: number): void => {
    const next = refs.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))];
    next?.focus();
  };

  const handleCell = (index: number, raw: string): void => {
    const clean = sanitizeCodeInput(raw);
    if (clean === '') {
      onChange(digits.slice(0, index) + digits.slice(index + 1));
      return;
    }
    // 한 칸에 한 자리면 그 칸만 바꾸고, 여러 자리가 들어오면(자동완성) 그 칸부터 이어서 채운다
    const after = clean.length === 1 ? digits.slice(index + 1) : '';
    onChange(sanitizeCodeInput(digits.slice(0, index) + clean + after));
    focusCell(index + clean.length);
  };

  const handleKey = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace' && digits.charAt(index) === '' && index > 0) {
      event.preventDefault();
      onChange(digits.slice(0, index - 1));
      focusCell(index - 1);
    } else if (event.key === 'Enter' && digits.length === CODE_LENGTH && !locked) {
      onSubmit();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    const clean = sanitizeCodeInput(event.clipboardData.getData('text'));
    onChange(clean);
    focusCell(clean.length);
  };

  const disabled = digits.length < CODE_LENGTH || locked;
  return (
    <MemberFlowFrame
      backdropSrc={backdropSrc}
      title="코드로 입장"
      onBack={onBack}
      foot={
        <>
          <div className="fm-fnote">
            {memberName ? <User size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}
            {memberName ? `${memberName}님으로 이어서 입장해요` : '로그인 없이 입장할 수 있어요'}
          </div>
          <FlowButton kind="primary" disabled={disabled} onClick={onSubmit}>코드 확인</FlowButton>
        </>
      }
    >
      <FlowCard strong>
        <section className="fm-code-card" aria-label="코드 입력">
          <MemberBrandMark className="fm-logo" />
          <FlowH1>입장 코드를 입력해 주세요</FlowH1>
          <FlowSub>상담사가 알려 준 숫자 4자리예요</FlowSub>
          <div className="fm-codebox" role="group" aria-label="입장 코드 4자리">
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <span key={i} data-active={!bad && !locked && activeIndex === i ? 'true' : undefined} data-bad={bad ? 'true' : undefined}>
                <input
                  ref={(el) => { refs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={CODE_LENGTH}
                  autoComplete="off"
                  aria-label={`${i + 1}번째 숫자`}
                  aria-invalid={bad ? true : undefined}
                  value={digits.charAt(i)}
                  disabled={status === 'throttled'}
                  onChange={(e) => handleCell(i, e.target.value)}
                  onKeyDown={(e) => handleKey(i, e)}
                  onPaste={handlePaste}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </span>
            ))}
          </div>
          <Hint digits={digits} status={status} memberName={memberName} />
        </section>
      </FlowCard>
    </MemberFlowFrame>
  );
}
