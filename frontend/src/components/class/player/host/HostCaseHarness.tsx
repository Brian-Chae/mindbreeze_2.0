// SDD-208 — 케이스 하니스(/design/class-player)용 상담사 화면 래퍼. 픽스처 입력을 로컬 상태로 들고 있어 시안처럼 눌러 볼 수 있다.
// 서버·소켓·LiveKit 을 전혀 쓰지 않으므로 케이스를 결정적으로 렌더·측정한다. 발언권·녹음·마커는 실제 컴포넌트를 그대로 쓴다.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Send } from 'lucide-react';
import type { SessionLiveMetric } from '../../../../lib/api/session';
import {
  HOST_SELF_BAND_NONE,
  deriveHostCase,
  type HostCaseSpec,
  type HostChatMessage,
  type HostParticipant,
  type HostRec,
  type HostSelfBand,
} from '../../../../lib/class/host-player-case';
import type { CamUi, MicUi, NetUi } from '../../../../lib/class/player-case';
import { registerCasePatch, type PlayerCaseContext } from '../../../../lib/class/player-harness';
import { EndSessionModal } from '../../../player/EndSessionModal';
import { MarkerButton } from '../../../session/MarkerButton';
import { SpeakingRightsPanel } from '../../../session/SpeakingRightsPanel';
import { HostSignalToastPolicy, type SignalSnapshot, type SignalToast } from './host-signal-toast';
import type { SignalMap } from '../../../../lib/class/quiet-signal';
import { HostSignalToast } from './HostSignalToast';
import { HostEndingCard } from './HostEndingCard';
import type { HostMediaProps } from './HostMediaSheet';
import { HostLiveView, type HostLiveActions } from './HostLiveView';
import { useHostUi } from './useHostUi';

interface HostCaseHarnessProps {
  spec: HostCaseSpec;
  ctx: PlayerCaseContext;
}

function toLiveRow(p: HostParticipant): SessionLiveMetric {
  return {
    participant_id: p.id,
    display_name: p.name,
    is_guest: false,
    band_connected: p.band !== 'off' && p.band !== 'lost',
    device_status: p.band === 'leadoff' ? 'lead_off' : 'ok',
    band_battery: p.lowBattery ? 20 : 80,
    avg_efficiency: null,
    current_efficiency: null,
    upload_status: null,
    last_eeg_at: null,
    raise_hand: p.hand,
    speaking: p.speaking,
  };
}

function FakeChat({ messages, onSend }: { messages: readonly HostChatMessage[]; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };
  return (
    <>
      <div className="hp-chat__list">
        {messages.map((m, i) => (
          <div className="hp-msg" key={`${m.time}-${i}`} data-me={m.me ? 'true' : undefined}>
            <span className="hp-msg__meta">{m.me ? '나' : m.who} · {m.time}</span>
            <span className="hp-msg__bub">{m.text}</span>
          </div>
        ))}
      </div>
      <form className="hp-composer" onSubmit={submit}>
        <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="참가자에게 메시지 보내기" aria-label="메시지 입력" autoComplete="off" />
        <button type="submit" className="pz-circle-btn" data-variant="primary" aria-label="보내기"><Send size={24} strokeWidth={2} aria-hidden="true" /></button>
      </form>
    </>
  );
}

export function HostCaseHarness({ spec, ctx }: HostCaseHarnessProps) {
  const { ui, actions: uiActions } = useHostUi(spec.ui);
  const signalDemo = ctx.params.get('signalsDemo');
  const [participants, setParticipants] = useState<readonly HostParticipant[]>(() => signalDemo
    ? spec.input.participants.map((participant, index) => ({ ...participant, name: ['지은', '민수', '서연', '도윤', '하늘', '유진'][index] ?? '참가자', hand: ['hand', 'hand-one', 'hand-many', 'toast'].includes(signalDemo) && index < (signalDemo === 'hand-many' ? 3 : 1), speaking: false }))
    : spec.input.participants);
  const demoPolicy = useRef<HostSignalToastPolicy | null>(null);
  const [demoToast, setDemoToast] = useState<SignalToast | null>(null);
  const [quietSignalEntries] = useState<SignalMap>((): SignalMap => signalDemo && ['signals', 'toast', 'quiet'].includes(signalDemo) ? { a: { type: 'difficult', at: Date.now(), displayName: '지은' }, b: { type: 'difficult', at: Date.now(), displayName: '민수' }, c: { type: 'resting', at: Date.now() + 1, displayName: '서연' } } : {});
  useEffect(() => {
    if (!signalDemo) return;
    const policy = new HostSignalToastPolicy();
    demoPolicy.current = policy;
    const now = Date.now();
    const snapshot: SignalSnapshot = { sessionId: 'harness', connected: true, hands: [], queue: [], signals: {}, sheet: null, blocked: false };
    policy.update(snapshot, now);
    const next = { ...snapshot, hands: participants.filter(p => p.hand).map(p => p.id), handNames: Object.fromEntries(participants.map(p => [p.id, p.name])), speakingCount: 0, signals: quietSignalEntries };
    setDemoToast(policy.update(next, now + 2));
    const timer = setInterval(() => setDemoToast(policy.update(next, Date.now())), 200);
    return () => clearInterval(timer);
  }, [signalDemo, participants, quietSignalEntries]);
  const quietCounts = signalDemo && ['signals', 'toast', 'quiet'].includes(signalDemo)
    ? { following: 0, difficult: 2, resting: 1 }
    : { following: 0, difficult: 0, resting: 0 };
  const [mic, setMic] = useState<MicUi>(spec.input.mic);
  const [cam, setCam] = useState<CamUi>(spec.input.cam);
  const [rec, setRec] = useState<HostRec | null>(spec.input.rec);
  const [selfBand, setSelfBand] = useState<HostSelfBand | null>(spec.input.selfBand);
  const [net, setNet] = useState<NetUi>(spec.input.net);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [messages, setMessages] = useState<readonly HostChatMessage[]>(spec.meta.chat);
  const [codeCopied, setCodeCopied] = useState(false);
  // 종료 단계(C17): 확인 모달 → 리포트 생성 중 카드
  const [endOpen, setEndOpen] = useState(spec.input.phase === 'confirm');
  const [ending, setEnding] = useState(spec.input.phase === 'ending');
  // 회원이 카메라를 켠 상태(1:1) — 실제 카메라 없이 캔버스 스트림으로 흉내 낸다
  const [memberStream] = useState<MediaStream | null>(() => {
    if (!spec.memberVideo) return null;
    const canvas = document.createElement('canvas');
    return typeof canvas.captureStream === 'function' ? canvas.captureStream() : null;
  });

  // 측정 스크립트(P11)가 같은 화면에서 mic·cam·rec·net 만 바꿔 자리 변위를 잰다
  useEffect(() => registerCasePatch((partial) => {
    if (partial.mic !== undefined) setMic(partial.mic as MicUi);
    if (partial.cam !== undefined) setCam(partial.cam as CamUi);
    if (partial.rec !== undefined) setRec(partial.rec === 'none' || partial.rec === null ? null : (partial.rec as HostRec));
    if (partial.net !== undefined) setNet(partial.net as NetUi);
  }), []);

  const hostCase = useMemo(
    () => deriveHostCase({ ...spec.input, participants, mic, cam, rec, net, selfBand, handsFirst: ui.handsFirst, filter: ui.filter }),
    [spec.input, participants, mic, cam, rec, net, selfBand, ui.handsFirst, ui.filter],
  );

  const setSpeaking = useCallback((id: string, speaking: boolean) => {
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, speaking, hand: false } : p)));
  }, []);

  const actions: HostLiveActions = useMemo(() => ({
    close: () => undefined,
    end: () => setEndOpen(true),
    retryNetwork: () => undefined,
    revoke: (id) => setSpeaking(id, false),
    toggleMic: () => setMic((prev) => (prev === 'on' ? 'off' : prev === 'off' ? 'on' : prev)),
    toggleCam: () => setCam((prev) => (prev === 'on' ? 'off' : prev === 'off' ? 'on' : prev)),
    recheckPermission: () => undefined,
    copyCode: () => {
      void navigator.clipboard?.writeText(spec.meta.accessCode);
      setCodeCopied(true);
    },
    connectSelfBand: () => setSelfBand({ ...HOST_SELF_BAND_NONE, state: 'connected', relaxation: 72, battery: 78, signalLabel: '신호 좋음', contactLabel: '정상' }),
    disconnectSelfBand: () => setSelfBand(HOST_SELF_BAND_NONE),
  }), [setSpeaking, spec.meta.accessCode]);

  const media: HostMediaProps = {
    recording: {
      state: rec === 'rec' ? 'recording' : rec === 'paused' ? 'paused' : 'idle',
      elapsedSec: spec.input.recElapsedSec,
      onStart: () => setRec('rec'),
      onPause: () => setRec('paused'),
      onResume: () => setRec('rec'),
      onStop: () => setRec(null),
    },
    video: null,
    marker: <MarkerButton sessionId="harness" startedAt={0} />,
  };

  const online = spec.input.loc === 'online';
  const speakingPanel: ReactNode | null = online && !spec.input.solo ? (
    <SpeakingRightsPanel
      participants={participants.map(toLiveRow)}
      busyId={null}
      onLowerHand={(id) => setParticipants((previous) => previous.map((participant) => participant.id === id ? { ...participant, hand: false } : participant))}
      onGrant={(id) => setSpeaking(id, true)}
      onRevoke={(id) => setSpeaking(id, false)}
    />
  ) : null;

  if (ending) {
    return (
      <HostEndingCard
        progress={null}
        steps={[{ label: '기록 정리', state: 'done' }, { label: 'AI 요약', state: 'doing' }, { label: '리포트 생성', state: 'wait' }]}
        backdropSrc={ctx.backdropSrc}
        onViewRecord={() => undefined}
        onGoList={() => undefined}
      />
    );
  }

  return (
    <>
    <div className="hp-modal-passthrough">
      <EndSessionModal open={endOpen} ending={false} onConfirm={() => { setEndOpen(false); setEnding(true); }} onCancel={() => setEndOpen(false)} />
    </div>
    <HostLiveView
      hostCase={hostCase}
      participants={participants}
      ui={ui}
      uiActions={uiActions}
      meta={{ title: spec.meta.title, elapsedSec: spec.meta.elapsedSec, durationMin: spec.meta.durationMin, accessCode: spec.meta.accessCode }}
      queue={spec.input.queue}
      speakingPanel={speakingPanel}
      preCheckins={spec.meta.preCheckins}
      quietSignals={quietCounts}
      quietSignalEntries={quietSignalEntries}
      signalToast={demoToast ? <HostSignalToast toast={demoToast} onOpen={(topic) => { demoPolicy.current?.dismiss(topic); setDemoToast(null); uiActions.openSheet(topic); }} onDismiss={(topic) => { demoPolicy.current?.dismiss(topic); setDemoToast(null); }} onPause={() => demoPolicy.current?.pause(Date.now())} onResume={() => demoPolicy.current?.resume(Date.now())} /> : null}
      selfBand={selfBand ?? HOST_SELF_BAND_NONE}
      chat={{
        unread: spec.meta.unread,
        enabled: chatEnabled,
        busy: false,
        onToggleEnabled: () => setChatEnabled((on) => !on),
        render: (collapsed) => (collapsed ? null : (
          <FakeChat messages={messages} onSend={(text) => setMessages((prev) => [...prev, { who: '나', me: true, time: '12:34', text }])} />
        )),
      }}
      media={media}
      codeCopied={codeCopied}
      selfStream={null}
      memberStream={memberStream}
      trendOf={spec.trendOf}
      actions={actions}
      backdropSrc={ctx.backdropSrc}
    />
    </>
  );
}
