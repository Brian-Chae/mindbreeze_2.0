// SDD-105 후속: 3단계 준비(설문·링크밴드·기기)를 모두 마친 뒤, 상담사가 아직 시작하지
// 않았을 때 보여주는 대기 화면 — 이전 자연 배경 위에 "잠시만 기다려주세요"와 명상 한마디를
// 띄워 잠시 명상을 하며 기다릴 수 있게 한다.
import { useEffect, useState } from 'react';
import { FadingImageBackground } from './FadingImageBackground';
import { LobbyBgmBar } from './LobbyBgmBar';
import type { useLobbyBgm } from '../../hooks/useLobbyBgm';

/** 명상과 관련된 짧은 지식·명언 — 8초마다 부드럽게 교체한다. */
const MEDITATION_QUOTES: readonly string[] = [
  '호흡은 지금 이 순간으로 돌아오는 가장 가까운 길입니다. 천천히 들이쉬고, 천천히 내쉬어 보세요.',
  '마음이 딴 곳에 가 있어도 괜찮습니다. 알아차렸다면, 다시 호흡으로 돌아오면 됩니다.',
  '어깨와 턱의 힘을 부드럽게 내려놓아 보세요. 몸이 이완되면 마음도 함께 느슨해집니다.',
  '지금 이 순간에 온전히 머무는 것, 그것이 바로 명상입니다.',
  '숨을 들이쉴 때 평온함을, 내쉴 때 긴장을 함께 내려놓는다고 상상해 보세요.',
  '생각을 붙잡지도 밀어내지도 마세요. 구름이 지나가듯 흘려보내면 됩니다.',
  '서두르지 않아도 됩니다. 오늘의 나를 그대로 만나는 것이 시작입니다.',
  '과거도 미래도 아닌, 바로 지금의 호흡 하나에 주의를 모아보세요.',
];

const QUOTE_INTERVAL_MS = 8000;
const FADE_MS = 450;

interface WaitingForStartProps {
  title: string | null;
  statusLabel: string;
  /** [나가기] — 코드 입력 단계로 복귀 */
  onLeave: () => void;
  /** [준비 다시 확인] — 3단계 준비 화면으로 돌아간다 */
  onRecheck: () => void;
  /** SDD-133(①-3): 시작 대기 중에도 BGM 볼륨/음소거 조절 */
  lobbyBgm?: ReturnType<typeof useLobbyBgm>;
}

export function WaitingForStart({
  title,
  statusLabel,
  onLeave,
  onRecheck,
  lobbyBgm,
}: WaitingForStartProps): React.ReactElement {
  const [quoteIndex, setQuoteIndex] = useState(() =>
    Math.floor(Math.random() * MEDITATION_QUOTES.length),
  );
  const [quoteVisible, setQuoteVisible] = useState(true);

  useEffect(() => {
    let hideTimer: number | undefined;
    const intervalId = window.setInterval(() => {
      setQuoteVisible(false);
      hideTimer = window.setTimeout(() => {
        setQuoteIndex((current) => (current + 1) % MEDITATION_QUOTES.length);
        setQuoteVisible(true);
      }, FADE_MS);
    }, QUOTE_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, []);

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#12081C] text-[#F7F4F0]">
      <FadingImageBackground />
      <div className="absolute inset-0 z-0" aria-hidden="true" style={{ background: 'linear-gradient(#190822D9, #12081CF2)' }} />

      <header className="relative z-10 mx-auto flex w-full max-w-[1200px] items-center gap-3 border-b border-white/10 px-4 py-5 sm:px-6">
        <button
          type="button"
          onClick={onLeave}
          className="min-h-11 rounded-lg px-2 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          나가기
        </button>
        <h1 className="truncate border-l border-white/10 px-4 text-sm font-medium text-white/80">
          {title ?? '클래스'}
        </h1>
        <span className="ml-auto shrink-0 rounded-full border border-[#dcb5ee]/20 bg-black/30 px-3 py-1 text-[12px] text-[#dcb5ee]">
          {statusLabel}
        </span>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-center justify-center px-6 pb-20 text-center">
        <p className="font-mono text-[12px] uppercase tracking-widest text-[#dcb5ee]">
          A MOMENT FOR YOURSELF
        </p>
        <h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          잠시만 기다려주세요
        </h2>
        <p className="mt-4 text-sm leading-6 text-white/70">
          상담사가 클래스를 시작하면 자동으로 입장됩니다.
        </p>

        <figure className="mt-12 max-w-xl">
          <p className="text-[12px] uppercase tracking-[0.25em] text-white/40">
            명상 한마디
          </p>
          <blockquote
            className={`mt-4 text-lg leading-8 text-[#F7F4F0] transition-opacity duration-500 sm:text-xl ${
              quoteVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            “{MEDITATION_QUOTES[quoteIndex]}”
          </blockquote>
        </figure>

        <button
          type="button"
          onClick={onRecheck}
          className="mt-14 min-h-11 rounded-xl border border-white/20 px-5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10"
        >
          준비 다시 확인하기
        </button>

        {lobbyBgm && (
          <div className="mt-8 w-full max-w-md">
            <LobbyBgmBar
              state={lobbyBgm.state}
              onVolumeChange={lobbyBgm.setVolume}
              onToggleMute={lobbyBgm.toggleMute}
              onResume={lobbyBgm.resume}
            />
          </div>
        )}
      </div>
    </main>
  );
}
