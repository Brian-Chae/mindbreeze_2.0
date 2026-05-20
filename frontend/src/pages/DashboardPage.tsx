import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import { useAuthStore } from '../stores/authStore';

interface SessionItem {
  time: string;
  title: string;
  tag: '오프라인' | '온라인';
  count: number;
}

interface ClientItem {
  name: string;
  note: string;
  when: string;
}

const TAG_STYLES: Record<SessionItem['tag'], string> = {
  오프라인: 'bg-[#F5EDFC] text-[#5F0080]',
  온라인: 'bg-[#E6F8F3] text-[#1F8A5B]',
};

function MiniCalendar({
  selectedDay,
  onSelect,
}: {
  selectedDay: number;
  onSelect: (day: number) => void;
}) {
  const today = 20;
  const muted = [27, 28, 29, 30];
  const dotsOn = useMemo(() => new Set([2, 5, 9, 12, 15, 20, 21, 23]), []);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const cells = [
    ...muted.map((n) => ({ n, muted: true })),
    ...days.map((n) => ({ n, muted: false })),
  ];

  return (
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-[22px]">
      <div className="flex justify-between items-center mb-4">
        <div className="font-bold text-[19px] tracking-tight text-[#1F1F1F]">
          2026년 5월
        </div>
        <div className="flex gap-1.5">
          {['‹', '오늘', '›'].map((l) => (
            <button
              key={l}
              type="button"
              className={`min-w-[32px] h-8 px-2.5 rounded-[10px] font-semibold text-[13px] ${
                l === '오늘'
                  ? 'bg-[#5F0080] text-white'
                  : 'bg-[#F5EDFC] text-[#5F0080]'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['일', '월', '화', '수', '목', '금', '토'].map((d) => (
          <div
            key={d}
            className="font-mono text-[10px] uppercase tracking-wider text-center text-[#6F6F6F] py-1"
          >
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          const isToday = !c.muted && c.n === today;
          const isSel = !c.muted && c.n === selectedDay;
          const dot = !c.muted && dotsOn.has(c.n);
          return (
            <button
              key={i}
              type="button"
              disabled={c.muted}
              onClick={() => !c.muted && onSelect(c.n)}
              className={`aspect-square flex items-center justify-center rounded-[10px] text-sm relative ${
                isSel
                  ? 'bg-[#5F0080] text-white font-bold'
                  : isToday
                  ? 'bg-[#F5EDFC] text-[#5F0080] font-bold'
                  : c.muted
                  ? 'text-[#C2C3CE] cursor-default'
                  : 'text-[#1F1F1F] hover:bg-[#F8F4FC]'
              }`}
            >
              {c.n}
              {dot && (
                <span
                  className={`absolute bottom-[5px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                    isSel ? 'bg-white/70' : 'bg-[#B373EF]'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TodaySessions({ day }: { day: number }) {
  const navigate = useNavigate();
  const sessions: SessionItem[] = [
    { time: '09:30', title: '아침 마음챙김 · 정기반', tag: '오프라인', count: 8 },
    { time: '14:00', title: '사내 워크숍 · 라온건강원', tag: '온라인', count: 14 },
    { time: '19:00', title: '바디스캔 입문 · 1:1', tag: '오프라인', count: 1 },
  ];

  return (
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-[22px] flex flex-col gap-3">
      <div className="flex justify-between items-baseline">
        <div className="font-bold text-[17px] text-[#1F1F1F] tracking-tight">
          오늘의 세션 · 5월 {day}일
        </div>
        <div className="font-mono text-[11px] text-[#6F6F6F]">
          세션 {sessions.length}건
        </div>
      </div>
      {sessions.map((s) => (
        <div
          key={s.time}
          className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-[#F8F4FC]"
        >
          <div className="font-mono font-bold text-[13px] text-[#5F0080] w-14 shrink-0">
            {s.time}
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm text-[#1F1F1F]">{s.title}</div>
            <div className="text-[11px] text-[#6F6F6F] mt-0.5">
              참여자 {s.count}명
            </div>
          </div>
          <span
            className={`inline-flex px-2.5 py-1 rounded-full font-semibold text-[10px] tracking-wider ${TAG_STYLES[s.tag]}`}
          >
            {s.tag}
          </span>
        </div>
      ))}
      <button
        type="button"
        onClick={() => navigate('/sessions')}
        className="h-10 mt-1 rounded-xl bg-[#F5EDFC] text-[#5F0080] font-semibold text-sm hover:bg-[#EBDEF7] transition-colors"
      >
        모든 세션 보기 →
      </button>
    </div>
  );
}

function RecentClients() {
  const navigate = useNavigate();
  const clients: ClientItem[] = [
    { name: '김민지', note: '측정을 완료했습니다', when: '방금 전' },
    { name: '정수아', note: '리포트가 발급되었습니다', when: '12분 전' },
    { name: '박서준', note: '세션 예약을 변경했습니다', when: '1시간 전' },
    { name: '이도윤', note: '프로그램을 일시 중지했습니다', when: '어제' },
  ];

  return (
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-[22px]">
      <div className="flex justify-between items-baseline mb-3.5">
        <div className="font-bold text-[15px] text-[#1F1F1F]">최근 내담자</div>
        <button
          type="button"
          onClick={() => navigate('/clients')}
          className="font-semibold text-[12px] text-[#5F0080] hover:underline"
        >
          전체
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {clients.map((c) => (
          <div key={c.name} className="flex gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#5F0080] mt-1.5 shrink-0 ring-4 ring-[#5F0080]/15" />
            <div className="flex-1">
              <div className="text-[13px] text-[#1F1F1F] leading-tight">
                <strong className="font-bold">{c.name}</strong> {c.note}
              </div>
              <div className="font-mono text-[10px] text-[#A2A3AD] mt-0.5">
                {c.when}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [day, setDay] = useState(21);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  return (
    <AppShell
      title={`안녕하세요, ${user?.name ?? '상담사'}님`}
      sub="2026.05 · 5월 셋째 주"
      rightSlot={
        <button
          type="button"
          onClick={() => navigate('/sessions')}
          className="h-11 px-[18px] rounded-full bg-[#5F0080] text-white font-semibold text-sm hover:bg-[#4B0066] transition-colors"
        >
          세션 시작하기
        </button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr] gap-5">
        <MiniCalendar selectedDay={day} onSelect={setDay} />
        <TodaySessions day={day} />
      </div>
      <div className="mt-[18px]">
        <RecentClients />
      </div>
    </AppShell>
  );
}
