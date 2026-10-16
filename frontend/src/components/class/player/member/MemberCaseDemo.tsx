// SDD-208 — 케이스 하니스(/design/class-player) 전용 래퍼. 서버·BLE 없이 픽스처 입력만으로 회원 뷰를 그리고,
// 시트 열기·지표 전환·마이크/카메라 토글 같은 화면 안 상호작용만 로컬 상태로 흉내 낸다(시안 member.html 의 동작).
import { useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import { MemberClassView } from './MemberClassView';
import type { MemberClassViewProps, MemberSheetKey } from './member-view-types';
import type { MemberCaseInput } from '../../../../lib/class/member-player-case';
import type { PlayerMetricKey } from '../../../../lib/class/player-case';
import './member-player.css';

interface DemoMessage {
  me: boolean;
  time: string;
  text: string;
}

const DEMO_MESSAGES: readonly DemoMessage[] = [
  { me: false, time: '14:02', text: '어서 오세요. 편안한 자세로 앉아 어깨의 힘을 풀어 볼게요.' },
  { me: false, time: '14:06', text: '몸의 긴장을 내려놓고 편안한 자세를 유지해 보세요.' },
  { me: true, time: '14:09', text: '네, 지금 많이 편안해요.' },
  { me: false, time: '14:11', text: '좋아요. 지금 흐름이 아주 좋아요.' },
  { me: false, time: '14:12', text: '남은 시간은 눈을 감고 편안히 머물러 보세요.' },
];

/** 채팅 시트 본문 데모(실제 앱은 ClassChatPanel embedded) */
export function MemberChatDemo() {
  const [messages, setMessages] = useState<readonly DemoMessage[]>(DEMO_MESSAGES);
  const [draft, setDraft] = useState('');
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { me: true, time: '14:13', text }]);
    setDraft('');
  };
  return (
    <div className="mp-chat">
      <ul className="mp-msgs" aria-live="polite">
        {messages.map((m, i) => (
          <li key={`${m.time}-${i}`} className={`mp-msg ${m.me ? 'mp-msg--me' : 'mp-msg--them'}`}>
            <span className="mp-msg__who">{m.me ? '나' : '채용욱 상담사'} · {m.time}</span>
            <p className="mp-msg__bub">{m.text}</p>
          </li>
        ))}
      </ul>
      <form className="mp-composer" onSubmit={submit} autoComplete="off">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="메시지 보내기" aria-label="메시지 입력" />
        <button type="submit" className="pz-circle-btn" data-variant="primary" aria-label="보내기">
          <span className="pz-circle-btn__icon"><Send size={20} strokeWidth={2} aria-hidden="true" /></span>
        </button>
      </form>
    </div>
  );
}

interface MemberCaseDemoProps {
  initial: MemberClassViewProps;
}

export function MemberCaseDemo({ initial }: MemberCaseDemoProps) {
  const [input, setInput] = useState<MemberCaseInput>(initial.input);
  const [sheet, setSheet] = useState<MemberSheetKey | null>(initial.sheet);
  const [hero, setHero] = useState<PlayerMetricKey>(initial.hero);
  const [sound, setSound] = useState(initial.sound);
  const patch = (partial: Partial<MemberCaseInput>): void => setInput((prev) => ({ ...prev, ...partial }));

  const actions: MemberClassViewProps['actions'] = {
    ...initial.actions,
    onSheetChange: setSheet,
    onHeroChange: setHero,
    onToggleMic: () => patch({ mic: input.mic === 'on' ? 'off' : 'on' }),
    onToggleCam: () => patch({ cam: input.cam === 'on' ? 'off' : 'on' }),
    onRaiseHand: () => patch({ hand: 'waiting' }),
    onEndSpeaking: () => patch({ hand: 'idle', mic: 'muted' }),
    onBandConnect: () => patch({ band: 'pending' }),
    onBandDisconnect: () => patch({ band: 'off' }),
    onBandCancel: () => patch({ band: 'off' }),
    onBandContinue: () => patch({ band: 'off' }),
    onBandRetry: () => patch({ band: 'on' }),
    onBandRecheck: () => patch({ band: 'on' }),
    onNetRetry: () => patch({ net: 'ok' }),
    onSpeakerChange: (on) => setSound((prev) => ({ ...prev, speakerOn: on })),
    onVolumeChange: (volume) => setSound((prev) => ({ ...prev, volume })),
  };

  return <MemberClassView {...initial} input={input} sheet={sheet} hero={hero} sound={sound} actions={actions} />;
}
