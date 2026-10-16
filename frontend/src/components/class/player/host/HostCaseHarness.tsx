// SDD-208 — 케이스 하니스(/design/class-player)용 상담사 화면 래퍼. 픽스처 입력을 로컬 상태로 들고 있어 시안처럼 눌러 볼 수 있다.
// 서버·소켓·LiveKit 을 전혀 쓰지 않으므로 케이스를 결정적으로 렌더·측정한다. 발언권 패널은 실제 SpeakingRightsPanel 을 그대로 쓴다.
import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Send } from 'lucide-react';
import type { SessionLiveMetric } from '../../../../lib/api/session';
import {
  HOST_SELF_BAND_NONE,
  deriveHostCase,
  type HostCaseSpec,
  type HostChatMessage,
  type HostParticipant,
  type HostSelfBand,
} from '../../../../lib/class/host-player-case';
import type { MicUi } from '../../../../lib/class/player-case';
import type { PlayerCaseContext } from '../../../../lib/class/player-harness';
import { SpeakingRightsPanel } from '../../../session/SpeakingRightsPanel';
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
  const [participants, setParticipants] = useState<readonly HostParticipant[]>(spec.input.participants);
  const [mic, setMic] = useState<MicUi>(spec.input.mic);
  const [selfBand, setSelfBand] = useState<HostSelfBand | null>(spec.input.selfBand);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [messages, setMessages] = useState<readonly HostChatMessage[]>(spec.meta.chat);
  const [codeCopied, setCodeCopied] = useState(false);

  const hostCase = useMemo(
    () => deriveHostCase({ ...spec.input, participants, mic, selfBand, handsFirst: ui.handsFirst, filter: ui.filter }),
    [spec.input, participants, mic, selfBand, ui.handsFirst, ui.filter],
  );

  const setSpeaking = useCallback((id: string, speaking: boolean) => {
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, speaking, hand: false } : p)));
  }, []);

  const actions: HostLiveActions = useMemo(() => ({
    close: () => undefined,
    end: () => undefined,
    retryNetwork: () => undefined,
    revoke: (id) => setSpeaking(id, false),
    toggleMic: () => setMic((prev) => (prev === 'on' ? 'off' : prev === 'off' ? 'on' : prev)),
    copyCode: () => {
      void navigator.clipboard?.writeText(spec.meta.accessCode);
      setCodeCopied(true);
    },
    connectSelfBand: () => setSelfBand({ ...HOST_SELF_BAND_NONE, state: 'connected', relaxation: 72, battery: 78, signalLabel: '신호 좋음', contactLabel: '정상' }),
    disconnectSelfBand: () => setSelfBand(HOST_SELF_BAND_NONE),
  }), [setSpeaking, spec.meta.accessCode]);

  const online = spec.input.loc === 'online';
  const speakingPanel: ReactNode | null = online && !spec.input.solo ? (
    <SpeakingRightsPanel
      participants={participants.map(toLiveRow)}
      busyId={null}
      onGrant={(id) => setSpeaking(id, true)}
      onRevoke={(id) => setSpeaking(id, false)}
    />
  ) : null;

  return (
    <HostLiveView
      hostCase={hostCase}
      participants={participants}
      ui={ui}
      uiActions={uiActions}
      meta={{ title: spec.meta.title, elapsedSec: spec.meta.elapsedSec, durationMin: spec.meta.durationMin, accessCode: spec.meta.accessCode }}
      queue={spec.input.queue}
      speakingPanel={speakingPanel}
      preCheckins={spec.meta.preCheckins}
      quietSignals={{ following: 0, difficult: 0, resting: 0 }}
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
      codeCopied={codeCopied}
      selfStream={null}
      actions={actions}
      backdropSrc={ctx.backdropSrc}
    />
  );
}
