/* global React, AppShell, StrokeIcon, ICONS, useNav, useModal */
const { useState: useS_dash } = React;

function MiniCalendar({ selectedDay, onSelect }) {
  // Calendar grid mirrors preview/components-calendar.html: 7-col grid,
  // muted leading days, .today pill, .selected purple chip, .dot mark for booked.
  const dotsOn = new Set([2, 5, 9, 12, 15, 20, 21, 23]);
  // 2026.05 starts on Friday (1 May = Friday). Leading muted: 27 28 29 30
  const muted = [27, 28, 29, 30];
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const today = 20;
  const cells = [
    ...muted.map(n => ({ n, muted: true })),
    ...days.map(n => ({ n, muted: false })),
  ];

  const Day = ({ n, muted: m }) => {
    const isToday = !m && n === today;
    const isSel = !m && n === selectedDay;
    const dot = !m && dotsOn.has(n);
    return (
      <button
        onClick={() => !m && onSelect(n)}
        style={{
          aspectRatio: "1 / 1",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--mb-font-sans)", fontWeight: 500, fontSize: 14,
          color: isSel ? "#FFFFFF" : isToday ? "#5F0080" : m ? "#C2C3CE" : "#1F1F1F",
          background: isSel ? "#5F0080" : isToday ? "#F5EDFC" : "transparent",
          borderRadius: 10, border: 0, cursor: m ? "default" : "pointer", position: "relative",
          fontWeight: isSel || isToday ? 700 : 500,
        }}
      >
        {n}
        {dot && (
          <span style={{
            position: "absolute", bottom: 5, left: "50%", transform: "translateX(-50%)",
            width: 4, height: 4, borderRadius: "50%",
            background: isSel ? "rgba(255,255,255,0.7)" : "#B373EF",
          }} />
        )}
      </button>
    );
  };

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #DDDEE7", borderRadius: 20, padding: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 19, letterSpacing: "-0.014em", color: "#1F1F1F" }}>2026년 5월</div>
        <div style={{ display: "flex", gap: 6 }}>
          {["‹", "오늘", "›"].map((l, i) => (
            <button key={i} style={{
              minWidth: 32, height: 32, padding: "0 10px", borderRadius: 10, border: 0,
              background: l === "오늘" ? "#5F0080" : "#F5EDFC",
              color: l === "오늘" ? "#FFFFFF" : "#5F0080",
              cursor: "pointer", fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 13,
            }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {["일","월","화","수","목","금","토"].map(d => (
          <div key={d} style={{
            fontFamily: "var(--mb-font-mono)", fontSize: 10, textTransform: "uppercase",
            letterSpacing: "0.08em", textAlign: "center", color: "#6F6F6F", padding: "4px 0",
          }}>{d}</div>
        ))}
        {cells.map((c, i) => <Day key={i} {...c} />)}
      </div>
    </div>
  );
}

function DaySchedule({ day }) {
  const sessions = [
    { time: "09:30", title: "아침 마음챙김 · 정기반", tag: "오프라인", count: 8 },
    { time: "14:00", title: "사내 워크숍 · 라온건강원", tag: "온라인",   count: 14 },
    { time: "19:00", title: "바디스캔 입문 · 1:1",     tag: "오프라인", count: 1 },
  ];
  const tagColor = { 오프라인: { bg: "#F5EDFC", fg: "#5F0080" }, 온라인: { bg: "#E6F8F3", fg: "#1F8A5B" } };
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #DDDEE7", borderRadius: 20, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 17, color: "#1F1F1F", letterSpacing: "-0.012em" }}>5월 {day}일 · 목</div>
        <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F" }}>세션 {sessions.length}건</div>
      </div>
      {sessions.map(s => (
        <div key={s.time} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: "#F8F4FC" }}>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontWeight: 700, fontSize: 13, color: "#5F0080", width: 56, flex: "none" }}>{s.time}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 14, color: "#1F1F1F" }}>{s.title}</div>
            <div style={{ fontFamily: "var(--mb-font-text)", fontSize: 11, color: "#6F6F6F", marginTop: 2 }}>참여자 {s.count}명</div>
          </div>
          <span style={{
            display: "inline-flex", padding: "4px 10px", borderRadius: 9999,
            background: tagColor[s.tag].bg, color: tagColor[s.tag].fg,
            fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 10, letterSpacing: "0.04em",
          }}>{s.tag}</span>
        </div>
      ))}
      <button className="mb-btn mb-btn--soft" style={{ height: 40, marginTop: 4 }}>이 날 모든 세션 보기 →</button>
    </div>
  );
}

function MiniStat({ label, value, delta, tone = "up" }) {
  const tones = {
    up:   { c: "#1F8A5B", a: "↓" },
    down: { c: "#D33F3F", a: "↑" },
    flat: { c: "#6F6F6F", a: "·" },
  }[tone];
  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid #DDDEE7", borderRadius: 18,
      padding: "18px 20px", display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6F6F6F" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 32, color: "#1F1F1F", letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
        {delta && (
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 13, color: tones.c }}>
            {tones.a}{delta}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityFeed() {
  const items = [
    { who: "김민지", what: "측정을 완료했습니다", when: "방금 전",  tone: "purple" },
    { who: "정수아", what: "리포트가 발급되었습니다", when: "12분 전", tone: "green" },
    { who: "박서준", what: "세션 예약을 변경했습니다", when: "1시간 전", tone: "orange" },
    { who: "이도윤", what: "프로그램을 일시 중지했습니다", when: "어제", tone: "gray" },
  ];
  const dot = { purple: "#5F0080", green: "#1F8A5B", orange: "#E6593D", gray: "#A2A3AD" };
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #DDDEE7", borderRadius: 18, padding: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 15, color: "#1F1F1F" }}>최근 활동</div>
        <a style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 12, color: "#5F0080", textDecoration: "none", cursor: "pointer" }}>전체</a>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot[it.tone], marginTop: 6, flex: "none", boxShadow: `0 0 0 3px ${dot[it.tone]}22` }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--mb-font-text)", fontSize: 13, color: "#1F1F1F", lineHeight: "19px" }}>
                <strong style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700 }}>{it.who}</strong>{"  "}{it.what}
              </div>
              <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#A2A3AD", marginTop: 2 }}>{it.when}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard() {
  const [day, setDay] = useS_dash(21);
  const { go } = useNav();
  return (
    <AppShell
      title="안녕하세요, 김지수 지도사님"
      sub="2026.05 · 5월 셋째 주"
      rightSlot={
        <button className="mb-btn" style={{ height: 44, padding: "0 18px", borderRadius: 22, display: "inline-flex", alignItems: "center", gap: 8 }} onClick={() => go("session-running")}>
          <StrokeIcon d={ICONS.play} size={16} color="#FFFFFF" />
          진행 중인 세션 열기
        </button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 20 }}>
        <MiniCalendar selectedDay={day} onSelect={setDay} />
        <DaySchedule day={day} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginTop: 18 }}>
        <MiniStat label="이번 주 세션"  value="11" delta="3"   tone="up" />
        <MiniStat label="활동중 참여자" value="42" delta="5"   tone="up" />
        <MiniStat label="평균 휴식도"   value="72" delta="8"   tone="up" />
        <MiniStat label="대기 리포트"   value="3"  delta="2"   tone="down" />
      </div>
      <div style={{ marginTop: 18 }}>
        <ActivityFeed />
      </div>
    </AppShell>
  );
}

window.Dashboard = Dashboard;
