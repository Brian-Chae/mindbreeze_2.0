/* global React, UserShell, TopBar, ICONS_user */

function ClassScreen({ tab, onTab }) {
  const upcoming = [
    { dow: "금", num: "22", title: "아침 마음챙김 · 5회차", who: "김지수 지도사 · 청담센터", time: "09:30",  type: "오프라인" },
    { dow: "월", num: "25", title: "수면을 위한 호흡 명상",   who: "박재은 지도사 · 라이브",  time: "21:00",  type: "온라인" },
    { dow: "수", num: "27", title: "직장인 스트레스 케어",   who: "이도연 지도사 · 라이브",  time: "12:30",  type: "온라인" },
    { dow: "금", num: "29", title: "아침 마음챙김 · 6회차", who: "김지수 지도사 · 청담센터", time: "09:30",  type: "오프라인" },
  ];

  const top = (
    <TopBar
      eyebrow="2026.05 · 5월 셋째 주"
      title="클래스"
      right={
        <button style={{
          width: 38, height: 38, borderRadius: 19,
          background: "rgba(255,255,255,0.7)", border: 0, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(8px)",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F1F1F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
        </button>
      }
    />
  );

  return (
    <UserShell tab={tab} onTab={onTab} top={top} bg="#F5EDFC">
      {/* Featured class card */}
      <div style={{ padding: "0 16px 16px" }}>
        <div style={{
          borderRadius: 22, overflow: "hidden", position: "relative", height: 200,
        }}>
          <img src="../../assets/images/feature_inhale_mountain.png" alt=""
               style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%)" }} />
          <div style={{ position: "absolute", top: 14, left: 16, display: "flex", gap: 6 }}>
            <span style={{
              padding: "5px 10px", borderRadius: 9999,
              background: "rgba(255,255,255,0.92)", color: "#5F0080",
              fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 10, letterSpacing: "0.04em",
            }}>NEW</span>
            <span style={{
              padding: "5px 10px", borderRadius: 9999,
              background: "rgba(255,255,255,0.2)", color: "#FFFFFF",
              fontFamily: "var(--mb-font-mono)", fontWeight: 600, fontSize: 10, letterSpacing: "0.04em",
              backdropFilter: "blur(8px)",
            }}>8주 프로그램</span>
          </div>
          <div style={{ position: "absolute", left: 18, right: 18, bottom: 16, color: "#FFFFFF" }}>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 21, letterSpacing: "-0.018em", lineHeight: "26px" }}>
              산속의 호흡
            </div>
            <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 4 }}>
              자연의 리듬으로 마음을 정리하는 8주 코스
            </div>
          </div>
        </div>
      </div>

      {/* Section title */}
      <div style={{ padding: "0 20px 8px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 16, color: "#1F1F1F", letterSpacing: "-0.012em" }}>예정된 클래스</div>
        <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F" }}>4건</div>
      </div>

      {/* Upcoming list */}
      <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        {upcoming.map((u, i) => {
          const onTone = u.type === "오프라인"
            ? { bg: "#F5EDFC", fg: "#5F0080" }
            : { bg: "#E6F8F3", fg: "#1F8A5B" };
          return (
            <div key={i} style={{
              background: "#FFFFFF", borderRadius: 18, padding: 14,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 52, height: 56, borderRadius: 12,
                background: "#F5EDFC", color: "#5F0080",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: "none",
              }}>
                <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em" }}>{u.dow}</div>
                <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 19, letterSpacing: "-0.02em" }}>{u.num}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{
                    padding: "3px 8px", borderRadius: 9999,
                    background: onTone.bg, color: onTone.fg,
                    fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 9, letterSpacing: "0.04em",
                  }}>{u.type}</span>
                  <span style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, fontWeight: 600, color: "#5F0080" }}>{u.time}</span>
                </div>
                <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14, color: "#1F1F1F", marginTop: 4, letterSpacing: "-0.012em" }}>{u.title}</div>
                <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 11, color: "#6F6F6F", marginTop: 2 }}>{u.who}</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A2A3AD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICONS_user.chevronR.map((d, i) => <path key={i} d={d} />)}
              </svg>
            </div>
          );
        })}
      </div>

      <div style={{ height: 8 }} />
    </UserShell>
  );
}

window.ClassScreen = ClassScreen;
