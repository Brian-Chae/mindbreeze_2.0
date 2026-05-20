/* global React, AppShell, StrokeIcon, ICONS, StatusPill, useNav */
function SeatTile({ n, state, name }) {
  const stateMap = {
    measuring: { bg: "#5F0080", color: "#FFFFFF", indicator: "#01F0C8", label: "측정 중" },
    paired:    { bg: "#D2AEFC", color: "#5F0080", indicator: "#5F0080", label: "연결됨" },
    waiting:   { bg: "#F5EDFC", color: "#5F0080", indicator: "#B373EF", label: "대기" },
    empty:     { bg: "#F2F3F8", color: "#A2A3AD", indicator: "#DDDEE7", label: "비어 있음" },
  };
  const s = stateMap[state];
  return (
    <div style={{
      background: s.bg, color: s.color,
      borderRadius: 16, padding: 14, height: 110,
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      fontFamily: "var(--mb-font-sans)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--mb-font-mono)", fontWeight: 700, fontSize: 18 }}>{String(n).padStart(2, "0")}</span>
        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 8, background: s.indicator, boxShadow: state === "measuring" ? "0 0 0 4px rgba(1,240,200,0.25)" : "none" }} />
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, lineHeight: "20px" }}>{name || "—"}</div>
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{s.label}</div>
      </div>
    </div>
  );
}

function SessionRunning() {
  const seats = [
    { n: 1,  state: "measuring", name: "채이서" },
    { n: 2,  state: "measuring", name: "박서연" },
    { n: 3,  state: "measuring", name: "김도윤" },
    { n: 4,  state: "paired",    name: "이하준" },
    { n: 5,  state: "measuring", name: "정유나" },
    { n: 6,  state: "waiting",   name: "송지호" },
    { n: 7,  state: "measuring", name: "조은서" },
    { n: 8,  state: "paired",    name: "한아윤" },
    { n: 9,  state: "measuring", name: "윤시우" },
    { n:10,  state: "measuring", name: "강민서" },
    { n:11,  state: "waiting",   name: "장하린" },
    { n:12,  state: "empty",     name: "" },
  ];
  return (
    <AppShell
      title="마음챙김 입문 · 4주차"
      sub="진행 중 · 청담센터 A 스튜디오 · 10:30"
      rightSlot={
        <>
          <StatusPill tone="primary" leading={<span style={{ display:"inline-block", width:8, height:8, borderRadius:8, background:"#01F0C8", boxShadow:"0 0 0 4px rgba(1,240,200,0.3)" }} />}>
            세션 진행 중 · 12:48
          </StatusPill>
          <StatusPill tone="soft" leading={<img src="../../assets/icons/ble_connected.svg" width="18" height="18" alt="" style={{filter:"invert(7%) sepia(99%) saturate(7472%) hue-rotate(283deg) brightness(67%) contrast(112%)"}}/>}>
            LB-A02E1
          </StatusPill>
        </>
      }
    >
      <div style={{ padding: "24px 32px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, height: "100%" }}>
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <span className="mb-eyebrow" style={{ background:"#191A1E", color:"#01F0C8" }}>LIVE</span>
            <span className="mb-eyebrow">12 / 12명 입실</span>
            <span className="mb-eyebrow">측정 중 8명 · 대기 2명</span>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 12,
          }}>
            {seats.map(s => <SeatTile key={s.n} {...s} />)}
          </div>

          <div style={{
            marginTop: 24, padding: 20, borderRadius: 20,
            background: "#F5EDFC", display: "flex", alignItems: "center", gap: 20,
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 32, background: "#5F0080",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <StrokeIcon d={ICONS.pause} size={24} color="#FFFFFF" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 17, color: "#1F1F1F" }}>호흡을 따라가는 명상 · 2단계</div>
              <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 12, color: "#6F6F6F", marginTop: 4 }}>12:48 / 20:00</div>
              <div style={{ height: 6, background: "#FFFFFF", borderRadius: 3, marginTop: 10, overflow: "hidden" }}>
                <div style={{ width: "64%", height: "100%", background: "linear-gradient(90deg,#5F0080,#B373EF)" }} />
              </div>
            </div>
            <button className="mb-btn" style={{ height: 44 }}>다음 단계</button>
          </div>
        </div>

        <aside style={{
          background: "#FFFFFF", border: "1px solid #EFEFEF", borderRadius: 20, padding: 20,
          display: "flex", flexDirection: "column", gap: 18,
        }}>
          <div>
            <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F", letterSpacing: "0.06em", textTransform: "uppercase" }}>실시간 평균</div>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 22, color: "#1F1F1F", marginTop: 4 }}>휴식도 지수</div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 56, color: "#5F0080", lineHeight: 1, letterSpacing: "-0.04em" }}>72</div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F" }}>지난 평균</div>
              <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 16, color: "#1F1F1F" }}>64</div>
              <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#59CE90", marginTop: 2 }}>▲ +8</div>
            </div>
          </div>

          {/* Mini chart */}
          <svg viewBox="0 0 280 80" style={{ width: "100%", height: 80 }}>
            <defs>
              <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%"  stopColor="#B373EF" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#B373EF" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <path d="M0 60 C 20 50, 40 55, 60 45 S 100 30, 130 38 S 180 18, 220 22 S 260 35, 280 28 L 280 80 L 0 80 Z" fill="url(#g)" />
            <path d="M0 60 C 20 50, 40 55, 60 45 S 100 30, 130 38 S 180 18, 220 22 S 260 35, 280 28" fill="none" stroke="#5F0080" strokeWidth="2.5" strokeLinecap="round" />
          </svg>

          <div style={{ borderTop: "1px solid #EFEFEF", paddingTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F" }}>주의력 (β)</div>
              <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 20, color: "#1F1F1F" }}>68</div>
            </div>
            <div>
              <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F" }}>이완 (α)</div>
              <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 20, color: "#1F1F1F" }}>74</div>
            </div>
            <div>
              <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F" }}>몰입 (γ)</div>
              <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 20, color: "#1F1F1F" }}>61</div>
            </div>
            <div>
              <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F" }}>균형도</div>
              <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 20, color: "#1F1F1F" }}>0.82</div>
            </div>
          </div>

          <button className="mb-btn mb-btn--ghost" style={{ width: "100%", height: 44, marginTop: "auto" }}>
            세션 종료 후 리포트 발급
          </button>
        </aside>
      </div>
    </AppShell>
  );
}

window.SessionRunning = SessionRunning;
