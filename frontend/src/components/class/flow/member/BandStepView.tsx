import { isNativeApp } from '../../../../lib/native/platform';
import { PermissionGuide } from '../../../native/permission-guide';
// SDD-209 M4 — FM06c LINK BAND 단계. 어떤 모드·상태에서도 참가를 막지 않는다(`LINK BAND 없이 계속하기`는 항상 있다).
// 전극 LED 카드는 접촉 불량일 때만 띄운다. 연결 중은 회전 스피너 대신 3점 순차 페이드.
import { Activity, Battery, Bluetooth, CircleAlert, Globe, Info, Power, RefreshCw, User } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LeadOffStatus } from '../../../../lib/eeg/types/eeg';
import type { BandStepUi } from '../../../../lib/class/band-step';
import { isLowBattery } from '../../../../lib/session-live/signal-status';
import type { FlowBandMode } from '../../../../lib/class/flow/types';
import { FlowButton, FlowCard, FlowChip, FlowH1, FlowSub } from '../shared/flow-primitives';
import { ElectrodeLeds } from '../shared/ElectrodeLeds';
import { MemberFlowFrame, type MemberFlowSteps } from './MemberFlowFrame';
import { StartedSheet } from './StartedSheet';

export interface BandStepViewProps {
  state: BandStepUi;
  /** none 은 이 단계가 없다 — opt(선택) · req(권장) */
  bandMode: Exclude<FlowBandMode, 'none'>;
  leadOff: LeadOffStatus | null;
  /** 0~100. 모르면 null */
  battery: number | null;
  steps: MemberFlowSteps;
  place?: 'online' | 'offline';
  backdropSrc?: string;
  /** 시작 후 시트 — 남은 준비 이름들 */
  startedRemaining?: readonly string[] | null;
  onConnect: () => void;
  onDisconnect: () => void;
  /** 연결된 채(또는 접촉을 확인하며) 다음 단계로 */
  onNext: () => void;
  /** LINK BAND 없이 다음 단계로 */
  onSkip: () => void;
  onStartedEnterNow?: () => void;
  onStartedContinue?: () => void;
  onBack: () => void;
  onExit: () => void;
}

function Li({ icon, tone, small, children }: { icon: ReactNode; tone?: 'warn' | undefined; small?: boolean; children: ReactNode }) {
  return (
    <li className={small ? 'fm-li sm' : 'fm-li'} data-tone={tone}>
      {icon}
      <span>{children}</span>
    </li>
  );
}

function batteryView(battery: number | null): { word: string; segs: number; warn: boolean } {
  if (battery === null) return { word: '확인 중', segs: 0, warn: false };
  if (isLowBattery(battery)) return { word: '충전이 필요해요', segs: 1, warn: true };
  return { word: '넉넉해요', segs: battery >= 75 ? 4 : 3, warn: false };
}

export function BandStepView({
  state, bandMode, leadOff, battery, steps, place = 'online', backdropSrc, startedRemaining = null,
  onConnect, onDisconnect, onNext, onSkip, onStartedEnterNow, onStartedContinue, onBack, onExit,
}: BandStepViewProps) {
  const req = bandMode === 'req';
  const native = isNativeApp();
  const lead = state === 'leadoffl' || state === 'leadoffr' || state === 'leadoff';
  const bat = batteryView(battery);

  // 선택 모드의 미지원은 조치가 필요한 상태가 아니다 — 경고색(코랄)을 쓰지 않는다(verify P10)
  const unsupportedTone = req ? ('warn' as const) : undefined;
  const head = lead
    ? { icon: <CircleAlert size={28} />, tone: 'warn' as const, chip: <FlowChip tone="warn" icon={<CircleAlert size={16} />}>접촉 불량</FlowChip> }
    : state === 'connected'
      ? { icon: <Bluetooth size={28} />, tone: 'ok' as const, chip: <FlowChip tone="ok" icon={<Bluetooth size={16} />}>연결됨</FlowChip> }
      : state === 'connecting'
        ? { icon: <Bluetooth size={28} />, tone: undefined, chip: <FlowChip tone="live" icon={<Bluetooth size={16} />}>연결 중</FlowChip> }
        : state === 'unsupported'
          ? { icon: <Globe size={28} />, tone: unsupportedTone, chip: <FlowChip tone={unsupportedTone} icon={<CircleAlert size={16} />}>지원 안 됨</FlowChip> }
          : { icon: <Bluetooth size={28} />, tone: undefined, chip: <FlowChip icon={<Bluetooth size={16} />}>연결 안 됨</FlowChip> };

  let body: ReactNode;
  if (state === 'idle') {
    body = (
      <ul className="fm-bb">
        <Li icon={<Power size={20} aria-hidden="true" />}>LINK BAND의 전원을 켜요</Li>
        <Li icon={<User size={20} aria-hidden="true" />}>이마 중앙에 밴드를 맞춰요</Li>
        <Li icon={<Bluetooth size={20} aria-hidden="true" />}>아래 버튼으로 연결해요</Li>
      </ul>
    );
  } else if (state === 'connecting') {
    body = (
      <div className="fm-bb">
        <div className="fm-center" role="status">
          <span className="fm-dots" aria-hidden="true"><i /><i /><i /></span>
          <b>연결하고 있어요</b>
          <span className="d">LINK BAND를 가까이에 두고 잠시만 기다려 주세요.</span>
        </div>
      </div>
    );
  } else if (state === 'connected') {
    body = (
      <div className="fm-bb">
        <div className="fm-tiles">
          <div className="fm-tile" data-tone={bat.warn ? 'warn' : undefined}>
            <span className="l"><Battery size={20} aria-hidden="true" />배터리</span>
            <span className="v">{bat.word}</span>
            <div className="fm-segbar" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => <i key={i} className={i < bat.segs ? 'on' : undefined} />)}
            </div>
          </div>
          <div className="fm-tile">
            <span className="l"><Activity size={20} aria-hidden="true" />전극</span>
            <FlowChip tone="ok" icon={<Bluetooth size={16} />}>접촉 양호</FlowChip>
          </div>
        </div>
        <Li icon={<Info size={20} aria-hidden="true" />}>이마에서 밴드가 움직이면 접촉이 흐트러질 수 있어요</Li>
      </div>
    );
  } else if (lead) {
    body = (
      <div className="fm-bb top">
        <ElectrodeLeds leadOff={leadOff} />
        <ul className="fm-bb top" style={{ minHeight: 0 }}>
          <Li small icon={<User size={20} aria-hidden="true" />}>밴드를 이마 중앙에 맞춰 전극이 피부에 밀착되게 조여요</Li>
          <Li small icon={<RefreshCw size={20} aria-hidden="true" />}>머리카락이나 땀이 전극을 가리지 않게 정리해요</Li>
          <Li small icon={<Bluetooth size={20} aria-hidden="true" />}>다시 착용해요. 그래도 안 되면 벗었다가 다시 써요</Li>
        </ul>
      </div>
    );
  } else {
    body = (
      <ul className="fm-bb">
        <Li tone={unsupportedTone} icon={<CircleAlert size={20} aria-hidden="true" />}>{native ? '기기 설정에서 Bluetooth 권한을 확인해 주세요' : '이 브라우저는 LINK BAND 연결을 지원하지 않아요'}</Li>
        <Li icon={<Globe size={20} aria-hidden="true" />}>{native ? 'Bluetooth를 켜고 앱 권한을 허용한 뒤 다시 시도해 주세요' : 'Chrome 또는 Edge에서 열면 연결할 수 있어요'}</Li>
        <Li icon={<Info size={20} aria-hidden="true" />}>밴드 없이도 클래스에 함께할 수 있어요</Li>
      </ul>
    );
  }

  const noBand = <FlowButton kind="ghost" onClick={onSkip}>LINK BAND 없이 계속하기</FlowButton>;
  let foot: ReactNode;
  if (state === 'idle') {
    foot = <><PermissionGuide kind="bluetooth" onContinue={onConnect}>{request => <FlowButton kind="primary" onClick={request}><Bluetooth size={20} aria-hidden="true" />LINK BAND 연결하기</FlowButton>}</PermissionGuide>{noBand}</>;
  } else if (state === 'connecting') {
    foot = <><FlowButton kind="primary" disabled>연결하고 있어요</FlowButton>{noBand}</>;
  } else if (state === 'connected') {
    foot = (
      <>
        <FlowButton kind="primary" onClick={onNext}>다음</FlowButton>
        {req ? noBand : <FlowButton kind="ghost" onClick={onDisconnect}>연결 해제하기</FlowButton>}
      </>
    );
  } else if (lead) {
    foot = <><FlowButton kind="primary" onClick={onNext}>{req ? '접촉을 확인해 주세요' : '다음'}</FlowButton>{noBand}</>;
  } else {
    foot = (
      <>
        <FlowButton kind="primary" onClick={onSkip}>LINK BAND 없이 계속하기</FlowButton>
        <p className="fl-note fm-slot">{native ? '기기 설정에서 Bluetooth를 허용한 뒤 다시 시도해 주세요.' : 'Chrome 또는 Edge에서 열면 연결할 수 있어요.'}</p>
      </>
    );
  }

  const sheet = startedRemaining ? (
    <StartedSheet open remaining={startedRemaining} onEnterNow={onStartedEnterNow ?? onNext} onContinue={onStartedContinue ?? onNext} />
  ) : null;

  return (
    <MemberFlowFrame
      wizard
      place={place}
      backdropSrc={backdropSrc}
      steps={steps}
      onBack={onBack}
      onExit={onExit}
      sheet={sheet}
      sheetOpen={startedRemaining !== null}
      foot={foot}
    >
      <div className="fm-head">
        <FlowH1>LINK BAND를 연결해요</FlowH1>
        <FlowSub>{req ? 'LINK BAND 사용을 권장해요. 없어도 참가할 수 있어요' : '연결하면 뇌파도 함께 기록해요. 지금 연결하지 않아도 괜찮아요.'}</FlowSub>
      </div>
      <FlowCard>
        <section className="fm-band" aria-label="LINK BAND">
          <div className="fm-bh">
            <span className="fm-bi" data-tone={head.tone}>{head.icon}</span>
            <div className="fm-bt">
              <b>LINK BAND <span className="fm-tag" data-tone={req ? 'req' : undefined}>{req ? '권장' : '선택'}</span></b>
              {head.chip}
            </div>
          </div>
          {body}
        </section>
      </FlowCard>
    </MemberFlowFrame>
  );
}
