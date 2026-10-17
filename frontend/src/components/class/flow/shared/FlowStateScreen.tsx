// SDD-209 I2 — 공용 상태 화면(FM10 참가자 · FH10 상담사). verify FL5: 하나의 컴포넌트가 제목·한 줄 설명·정보 카드·주 버튼 1 + 보조 1 을 렌더한다.
// 두 모양을 한 컴포넌트가 받는다:
//  - 카드형(참가자): 상단 바 없이 로고 + 아이콘 + 제목/설명 + 정보 쌍(0~2) + 안내 한 줄 (`bar` 없음)
//  - 바형(상담사): 상단 바(뒤로 + 제목/보조) + 아이콘 행 목록 (`bar` 있음)
// 서버 오류 원문은 받지 않는다 — 문구는 호출부가 종류별 표에서만 만든다.
import type { ReactNode } from 'react';
import { MemberBrandMark } from '../../player/member/MemberBrandMark';
import { MemberFullFrame } from '../member/MemberFlowFrame';
import { HostFlowFrame, type HostFrameLeft } from '../host/HostFlowFrame';
import { FlowButton, FlowH1 } from './flow-primitives';

export interface FlowStateInfoPair {
  label: string;
  value: string;
}

export interface FlowStateRow {
  icon: ReactNode;
  title: string;
  sub: string;
}

export interface FlowStateAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

export interface FlowStateScreenProps {
  /** 상단 바. 있으면 바형(상담사), 없으면 카드형(참가자) */
  bar?: { title: string; sub?: string; left: HostFrameLeft };
  icon: ReactNode;
  warn: boolean;
  heading: string;
  lead: ReactNode;
  /** 카드형: 정보 쌍(0~2) */
  info?: readonly FlowStateInfoPair[];
  /** 바형: 아이콘 행 */
  rows?: readonly FlowStateRow[];
  /** 카드형: 버튼 위 안내 한 줄 */
  note?: string;
  primary: FlowStateAction;
  secondary: FlowStateAction;
  backdropSrc?: string;
}

function Actions({ primary, secondary }: Pick<FlowStateScreenProps, 'primary' | 'secondary'>) {
  return (
    <>
      <FlowButton kind="primary" onClick={primary.onClick}>{primary.icon}{primary.label}</FlowButton>
      <FlowButton kind="soft" onClick={secondary.onClick}>{secondary.icon}{secondary.label}</FlowButton>
    </>
  );
}

export function FlowStateScreen(props: FlowStateScreenProps) {
  const { bar, icon, warn, heading, lead, info = [], rows = [], note, primary, secondary, backdropSrc } = props;
  if (bar) {
    return (
      <HostFlowFrame
        title={bar.title}
        sub={bar.sub}
        backdropSrc={backdropSrc}
        left={bar.left}
        foot={<Actions primary={primary} secondary={secondary} />}
      >
        <div className="fhb-scene" role={warn ? 'alert' : undefined}>
          <span className={warn ? 'fhb-ico lg warn' : 'fhb-ico lg'}>{icon}</span>
          <h1 className="fl-h1">{heading}</h1>
          <p className="fl-sub">{lead}</p>
        </div>
        {rows.map((row) => (
          <div className="fhb-row" key={row.title}>
            <span className="fhb-ico">{row.icon}</span>
            <div className="fhb-rt"><b>{row.title}</b><span>{row.sub}</span></div>
          </div>
        ))}
      </HostFlowFrame>
    );
  }
  return (
    <MemberFullFrame backdropSrc={backdropSrc}>
      <section className="fm-fv" role="alert" aria-labelledby="fm-state-title">
        <MemberBrandMark className="fm-logo" />
        <span className="fm-ficon" data-tone={warn ? 'warn' : undefined}>{icon}</span>
        <div className="fm-ftx">
          <span id="fm-state-title"><FlowH1>{heading}</FlowH1></span>
          <p>{lead}</p>
        </div>
        <div className="fm-finfo">
          {info.map((pair) => (
            <div key={pair.label}><span>{pair.label}</span><b>{pair.value}</b></div>
          ))}
        </div>
        {note ? <p className="fm-fnote2">{note}</p> : null}
        <div className="fm-fbtns">
          <Actions primary={primary} secondary={secondary} />
        </div>
      </section>
    </MemberFullFrame>
  );
}
