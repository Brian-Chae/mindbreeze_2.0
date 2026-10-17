// SDD-209 H7 — 하니스용 로비 + 시작 확인(FH07) / 나가기·닫기(FH08) 시트 래퍼
import { useState } from 'react';
import { LOBBY_ADDRESS, LOBBY_START_TEXT, LOBBY_TITLE, buildLobbyFixture } from '../../../../lib/class/flow/host-lobby-fixtures';
import { LeaveCloseSheet, type LeaveStage } from './LeaveCloseSheet';
import { LobbyScreen } from './LobbyScreen';
import { StartConfirmSheet } from './StartConfirmSheet';

export type LobbyOverlaySpec =
  | { kind: 'start'; lobby: string; micOn: boolean; recordChecked: boolean; excluded: number; research: number }
  | { kind: 'leave'; lobby: string; stage: LeaveStage };

/** 하니스 데모 보관 기간. 실서비스 값은 서버 설정(RETENTION_RAW_DAYS)이며 화면은 받은 값을 그대로 보여 준다 */
const DEMO_RETENTION_DAYS = 90;

export function LobbyOverlayFixture({ spec, backdropSrc }: { spec: LobbyOverlaySpec; backdropSrc: string }) {
  const fixture = buildLobbyFixture(spec.lobby);
  const [startOpen, setStartOpen] = useState(spec.kind === 'start');
  const [leaveOpen, setLeaveOpen] = useState(spec.kind === 'leave');
  const [stage, setStage] = useState<LeaveStage>(spec.kind === 'leave' ? spec.stage : 'choose');
  const [micOn, setMicOn] = useState(spec.kind === 'start' ? spec.micOn : true);
  const [recordChecked, setRecordChecked] = useState(spec.kind === 'start' ? spec.recordChecked : true);
  const open = startOpen || leaveOpen;
  const sheet = (
    <>
      <StartConfirmSheet
        open={startOpen}
        model={fixture.model}
        ctx={fixture.ctx}
        micOn={micOn}
        recordChecked={recordChecked}
        excluded={spec.kind === 'start' ? spec.excluded : 0}
        research={spec.kind === 'start' ? spec.research : 0}
        retentionDays={DEMO_RETENTION_DAYS}
        address={LOBBY_ADDRESS}
        onClose={() => setStartOpen(false)}
        onStart={() => setStartOpen(false)}
        onToggleRecord={() => setRecordChecked((v) => !v)}
        onTurnOnMic={() => setMicOn(true)}
      />
      <LeaveCloseSheet
        open={leaveOpen}
        stage={stage}
        waiting={fixture.model.stats.inRoom}
        onLeave={() => setLeaveOpen(false)}
        onAskClose={() => setStage('confirm')}
        onConfirmClose={() => setLeaveOpen(false)}
        onContinue={() => setLeaveOpen(false)}
        onBackToChoose={() => setStage('choose')}
      />
    </>
  );
  return (
    <LobbyScreen
      {...fixture.ctx}
      title={LOBBY_TITLE}
      address={LOBBY_ADDRESS}
      startText={LOBBY_START_TEXT}
      model={fixture.model}
      backdropSrc={backdropSrc}
      sheetOpen={open}
      sheet={sheet}
      onBack={() => { setStage('choose'); setLeaveOpen(true); }}
      onStart={() => setStartOpen(true)}
      onInviteAdd={() => undefined}
      onInviteSheet={() => undefined}
      onDock={() => undefined}
    />
  );
}
