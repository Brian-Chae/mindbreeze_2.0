// SDD-209 M8 — FM09 종료·리포트. 리포트 반영 선택(서버 값)에 따라 회원 1탭 신청 / 비회원 자동 발송 안내 / 제외 안내로 갈린다.
// 이메일 입력·인증(OTP) 요소는 없다. 점수·퍼센트로 환원하지 않는다.
import { CheckCircle, CircleAlert, Info, Mail, Smile } from 'lucide-react';
import { SAM_AXES, type AxisKey, type SamValue } from '../../../../lib/api/checkin';
import { surveyHasValue, type SurveyDraft } from '../../../../lib/class/flow/member-survey';
import { MemberBrandMark } from '../../player/member/MemberBrandMark';
import { FlowButton, FlowH1, FlowSheet } from '../shared/flow-primitives';
import { MemberFullFrame } from './MemberFlowFrame';

export type EndReportMode = 'member' | 'guest' | 'excluded';
export type EndSheet = 'none' | 'report' | 'reportsent' | 'checkin';

export interface EndViewProps {
  place: 'online' | 'offline';
  title: string;
  /** `30분` — 서버 시각 차이. 모르면 null */
  duration: string | null;
  reportMode: EndReportMode;
  /** 앞 2글자만 보이는 이메일. 모르면 null */
  maskedEmail: string | null;
  checkinDone: boolean;
  sheet: EndSheet;
  checkinDraft: SurveyDraft;
  working: boolean;
  errorText: string | null;
  backdropSrc?: string;
  onOpenReport: () => void;
  onOpenCheckin: () => void;
  onCloseSheet: () => void;
  onRequestReport: () => void;
  onSelectAxis: (axis: AxisKey, value: SamValue) => void;
  onNote: (note: string) => void;
  onSubmitCheckin: () => void;
  onHome: () => void;
}

function Scale({ axis, label, steps, value, onSelect }: { axis: AxisKey; label: string; steps: Record<SamValue, string>; value: SamValue | null; onSelect: (axis: AxisKey, value: SamValue) => void }) {
  return (
    <div className="fm-scale">
      <span className="fl-label">{label}</span>
      <div className="row" role="radiogroup" aria-label={label}>
        {([1, 2, 3, 4, 5] as const).map((step) => (
          <button key={step} type="button" role="radio" aria-checked={value === step} onClick={() => onSelect(axis, step)}>{steps[step]}</button>
        ))}
      </div>
    </div>
  );
}

function Alert({ text }: { text: string }) {
  return <div className="fm-err" role="alert"><CircleAlert size={16} aria-hidden="true" />{text}</div>;
}

export function EndView(props: EndViewProps) {
  const { place, title, duration, reportMode, maskedEmail, checkinDone, sheet, checkinDraft, working, errorText, backdropSrc } = props;
  const excluded = reportMode === 'excluded';
  const guest = reportMode === 'guest';
  const lead = excluded
    ? '이번 클래스는 내 기록이 리포트에 반영되지 않아요'
    : guest
      ? (maskedEmail ? `리포트를 ${maskedEmail} 로 보내 드려요` : '리포트를 입력한 이메일로 보내 드려요')
      : '리포트는 준비되면 메일로 보내 드려요.';
  const reportRow = excluded ? '보낼 리포트가 없어요' : guest ? '상담사 확인 후 메일 발송' : '준비되면 메일 발송';
  const note = excluded
    ? '종료 전에는 설정에서 바꿀 수 있어요. 종료 뒤에는 상담사에게 요청해 주세요.'
    : guest
      ? '상담사가 확인하면 자동으로 보내져요.'
      : 'AI 기록과 리포트를 만드는 데 몇 분 걸릴 수 있어요.';
  const checkinPrimary = excluded || guest;

  let sheetNode = null;
  if (sheet === 'report') {
    sheetNode = (
      <FlowSheet open title="리포트 받기" onClose={props.onCloseSheet}>
        <div className="fm-stack">
          <div className="fm-field">
            <span className="fl-label">받는 이메일</span>
            <div className="fm-ro">{maskedEmail ?? '계정 이메일'}</div>
          </div>
          <p className="fm-sheet-sub">리포트는 상담사가 확인한 뒤 계정 이메일로 보내 드려요. 영업일 기준 1~2일 걸릴 수 있어요.</p>
          {errorText ? <Alert text={errorText} /> : null}
          <FlowButton kind="primary" disabled={working} onClick={props.onRequestReport}><Mail size={20} aria-hidden="true" />리포트 신청하기</FlowButton>
        </div>
      </FlowSheet>
    );
  } else if (sheet === 'reportsent') {
    sheetNode = (
      <FlowSheet open title="리포트 받기" onClose={props.onCloseSheet}>
        <div className="fm-stack">
          <div className="fm-center" style={{ padding: '16px 0' }}>
            <span className="fm-ficon" data-tone="ok"><CheckCircle size={28} aria-hidden="true" /></span>
            <b>신청했어요</b>
            <span className="d">상담사가 확인하면 이메일로 보내 드려요.</span>
          </div>
          <FlowButton kind="primary" onClick={props.onCloseSheet}>확인</FlowButton>
        </div>
      </FlowSheet>
    );
  } else if (sheet === 'checkin') {
    sheetNode = (
      <FlowSheet
        open
        title="오늘 상태 남기기"
        onClose={props.onCloseSheet}
        footer={
          <div className="fm-fbtns">
            <FlowButton kind="primary" disabled={working || !surveyHasValue(checkinDraft)} onClick={props.onSubmitCheckin}>남기기</FlowButton>
            <FlowButton kind="ghost" disabled={working} onClick={props.onCloseSheet}>건너뛰기</FlowButton>
          </div>
        }
      >
        <div className="fm-stack" style={{ gap: 8 }}>
          <p className="fm-sheet-sub">뇌파를 측정하지 않아도 이 기록은 리포트에 남아요.</p>
          {SAM_AXES.map((axis) => (
            <Scale key={axis.key} axis={axis.key} label={axis.label} steps={axis.steps} value={checkinDraft.answers[axis.key]} onSelect={props.onSelectAxis} />
          ))}
          <div className="fm-field">
            <label className="fl-label" htmlFor="fm-onel">한 줄 소감 (선택)</label>
            <input id="fm-onel" className="fm-input" placeholder="예: 한결 가벼워졌어요" maxLength={200} value={checkinDraft.note} onChange={(e) => props.onNote(e.target.value)} />
          </div>
          {errorText ? <Alert text={errorText} /> : null}
        </div>
      </FlowSheet>
    );
  }

  return (
    <MemberFullFrame place={place} backdropSrc={backdropSrc} sheet={sheetNode} sheetOpen={sheetNode !== null}>
      <section className="fm-fv" aria-labelledby="fm-end-title">
        <MemberBrandMark className="fm-logo" />
        <span className="fm-ficon" data-tone={excluded ? undefined : 'ok'}>
          {excluded ? <Info size={28} aria-hidden="true" /> : <CheckCircle size={28} aria-hidden="true" />}
        </span>
        <div className="fm-ftx">
          <span id="fm-end-title"><FlowH1>수고하셨어요</FlowH1></span>
          <p>{lead}</p>
        </div>
        <div className="fm-finfo">
          <div><span>클래스</span><b>{title}</b></div>
          <div><span>함께한 시간</span><b>{duration ?? '-'}</b></div>
          <div><span>리포트</span><b>{reportRow}</b></div>
        </div>
        <p className="fm-fnote2">{note}</p>
        <div className="fm-fbtns">
          {excluded || guest ? null : <FlowButton kind="primary" onClick={props.onOpenReport}><Mail size={20} aria-hidden="true" />리포트 받기</FlowButton>}
          {checkinDone ? (
            <FlowButton kind="soft" disabled><CheckCircle size={20} aria-hidden="true" />오늘 상태를 남겼어요</FlowButton>
          ) : (
            <FlowButton kind={checkinPrimary ? 'primary' : 'soft'} onClick={props.onOpenCheckin}><Smile size={20} aria-hidden="true" />오늘 상태 남기기</FlowButton>
          )}
          <FlowButton kind="ghost" onClick={props.onHome}>홈으로</FlowButton>
        </div>
      </section>
    </MemberFullFrame>
  );
}
