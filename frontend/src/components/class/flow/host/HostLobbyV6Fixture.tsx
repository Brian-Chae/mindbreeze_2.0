// SDD-307 — 서버 호출 없이 실제 준비 컨테이너·미디어 훅을 검증하는 전용 하니스.
import { useState } from 'react';
import { useHostPrepMedia } from '../../../../hooks/useHostPrepMedia';
import { ENDING_FIXTURES } from '../../../../lib/class/flow/host-ending-fixtures';
import type { LobbyPresenceEntry } from '../../../../lib/class/flow/host-lobby-model';
import { FlowButton, FlowSheet } from '../shared/flow-primitives';
import { HostPrepContainer } from './HostPrepContainer';

const noop = () => undefined;
export function HostLobbyV6Fixture({ scenario, backdropSrc }: { scenario: 'online' | 'offline' | 'ready' | 'empty'; backdropSrc: string }) {
  const offline = scenario === 'offline';
  const [phase, setPhase] = useState<'setup' | 'lobby'>('lobby');
  const media = useHostPrepMedia(!offline, 'sdd307-fixture');
  const [starts, setStarts] = useState(0);
  const [audio, setAudio] = useState('');
  const [copied, setCopied] = useState(false);
  const [invite, setInvite] = useState(false);
  const roster = Array.from({ length: 40 }, (_, i) => ({ participantId: `fixture-${i}`, name: `회원 ${String(i + 1).padStart(2, '0')}` }));
  const joined = scenario === 'empty' ? 0 : scenario === 'ready' ? 40 : 32;
  const presence: LobbyPresenceEntry[] = roster.slice(0, joined).map((row, i) => ({ ...row, nickname: row.name, readiness: { surveyDone: i >= 8 || scenario === 'ready' || i % (offline ? 2 : 3) !== 0, bandDone: i >= 8 || scenario === 'ready' || i % (offline ? 2 : 3) !== 1, deviceDone: i >= 8 || scenario === 'ready' || i % 3 !== 2, bandSkipped: i >= 8 && i % 5 === 0 } }));
  return <div data-start-count={starts} data-start-audio={audio}>
    <HostPrepContainer phase={phase} title="마음챙김 명상수업 · 4회차" startText="오늘 오후 3:00" address={offline ? '서울 명상실' : null}
      ctx={{ place: offline ? 'offline' : 'online', size: 'group', band: 'optional' }} accessCode="4729" capacity={40} joinUrl={`${window.location.origin}/class/sdd307-fixture/enter`} backdropSrc={backdropSrc}
      media={media} onOpen={() => setPhase('lobby')} onToggleMic={() => void media.toggleMic()} onToggleCamera={() => void media.toggleCamera()} onRecheck={() => void media.recheck()} onPlayTone={() => void media.playTestTone()}
      roster={roster} presence={presence} remindResults={new Map()} excluded={2} research={5} retentionDays={90} onRemind={noop}
      onInviteAdd={() => setInvite(true)} onCopyCode={() => { void navigator.clipboard?.writeText('4729').then(() => setCopied(true)); }} codeCopied={copied}
      sheets={{ bgm: { tracks: [], selectedId: null, playing: false, progress: 0, timeText: '00:00', volume: .5, onSelect: noop, onTogglePlay: noop, onVolume: noop }, band: { connected: false, leadOff: null, onConnect: noop, onDisconnect: noop }, speak: { raised: [], speaking: [], onAllow: noop, onStop: noop }, chat: { enabled: true, messages: [], onToggle: noop, onSend: noop } }}
      onStart={plan => { setStarts(n => n + 1); setAudio(plan); }} onLeave={() => setPhase('setup')} onCloseClass={noop}
      ending={ENDING_FIXTURES['end-ai']} headcount={40} onEnd={noop} onContinue={noop} onOpenRecord={noop} onStateAction={noop} />
    {invite && <div className="pz-root fh-lobby-v6"><div className="lobby-modal"><FlowSheet open title="회원 초대 · 하니스" onClose={() => setInvite(false)}><p>기존 회원 선택과 이메일 초대 연결 확인. 하니스는 발송하지 않아요.</p><FlowButton kind="soft" onClick={() => setInvite(false)}>닫기</FlowButton></FlowSheet></div></div>}
  </div>;
}
