/* global React, UserShell, TopBar, ICONS_user */

function HomeScreen({ tab, onTab, goSession, goReport }) {
  const top = (
    <TopBar
      eyebrow="2026.05.21 · 목요일"
      title="안녕하세요, 민지님"
      right={
        <button style={{
          width: 38, height: 38, borderRadius: 19,
          background: "rgba(255,255,255,0.7)", border: 0, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(8px)",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F1F1F" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            {ICONS_user.bell.map((d, i) => <path key={i} d={d} />)}
          </svg>
        </button>
      }
    />
  );

  return (
    <UserShell tab={tab} onTab={onTab} top={top} bg="#F5EDFC">
      {/* Hero — today's recommended session */}
      <div style={{ padding: "0 16px 16px" }}>
        <button onClick={goSession} style={{
          width: "100%", border: 0, padding: 0, cursor: "pointer", textAlign: "left",
          background: "transparent", borderRadius: 24, overflow: "hidden",
          position: "relative", height: 200,
        }}>
          <img src="../../assets/images/portrait_06_woman_purple_sunset.png" alt=""
               style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.55) 100%)",
          }} />
          <div style={{ position: "absolute", top: 16, left: 18, display: "flex", gap: 6 }}>
            <span style={{
              display: "inline-flex", padding: "5px 10px", borderRadius: 9999,
              background: "rgba(255,255,255,0.92)", color: "#5F0080",
              fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 10, letterSpacing: "0.04em",
            }}>오늘의 추천</span>
            <span style={{
              display: "inline-flex", padding: "5px 10px", borderRadius: 9999,
              background: "rgba(255,255,255,0.2)", color: "#FFFFFF",
              fontFamily: "var(--mb-font-mono)", fontWeight: 600, fontSize: 10, letterSpacing: "0.04em",
              backdropFilter: "blur(8px)",
            }}>12분</span>
          </div>
          <div style={{ position: "absolute", left: 18, right: 18, bottom: 14, color: "#FFFFFF" }}>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 22, letterSpacing: "-0.018em", lineHeight: "26px" }}>
              저녁의 호흡 정리
            </div>
            <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 4 }}>
              하루를 마무리하는 4-7-8 호흡 명상
            </div>
            <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6,
              background: "#FFFFFF", color: "#5F0080",
              padding: "8px 14px", borderRadius: 9999,
              fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 12,
            }}>
              ▶ &nbsp;시작하기
            </div>
          </div>
        </button>
      </div>

      {/* Today stats row */}
      <div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 14 }}>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#6F6F6F", letterSpacing: "0.08em", textTransform: "uppercase" }}>이번 주 휴식도</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 }}>
            <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 28, color: "#5F0080", letterSpacing: "-0.02em" }}>72</span>
            <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 12, color: "#1F8A5B" }}>↓18%</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 22, marginTop: 8 }}>
            {[0.30, 0.48, 0.42, 0.65, 0.58, 0.78, 0.92].map((v, i) => {
              const tier = i < 2 ? "#E8D8F8" : i < 4 ? "#D7BCEC" : i < 6 ? "#A775D6" : "#5F0080";
              return <div key={i} style={{ flex: 1, height: `${v * 100}%`, background: tier, borderRadius: "3px 3px 2px 2px" }} />;
            })}
          </div>
        </div>
        <div style={{ background: "#FFFFFF", borderRadius: 16, padding: 14 }}>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#6F6F6F", letterSpacing: "0.08em", textTransform: "uppercase" }}>연속 명상</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 }}>
            <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 28, color: "#1F1F1F", letterSpacing: "-0.02em" }}>14</span>
            <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 12, color: "#6F6F6F" }}>일째</span>
          </div>
          <div style={{ display: "flex", gap: 2, marginTop: 8 }}>
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: 22, borderRadius: 3,
                background: i === 13 ? "#5F0080" : `rgba(95,0,128,${0.18 + 0.05 * (i / 14)})`,
              }} />
            ))}
          </div>
        </div>
      </div>

      {/* Next session card */}
      <div style={{ padding: "0 16px 16px" }}>
        <div style={{
          background: "#FFFFFF", borderRadius: 18, padding: 16,
          display: "flex", alignItems: "center", gap: 14,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: "#F5EDFC", color: "#5F0080",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            flex: "none",
          }}>
            <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em" }}>금</div>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>22</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: "var(--mb-font-mono)", fontSize: 10, fontWeight: 600,
              color: "#5F0080", letterSpacing: "0.08em", textTransform: "uppercase",
            }}>다음 클래스</div>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 15, color: "#1F1F1F", marginTop: 4, letterSpacing: "-0.012em" }}>
              아침 마음챙김 · 5회차
            </div>
            <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12, color: "#6F6F6F", marginTop: 2 }}>
              09:30 · 김지수 지도사 · 청담센터
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A2A3AD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {ICONS_user.chevronR.map((d, i) => <path key={i} d={d} />)}
          </svg>
        </div>
      </div>

      {/* Recent reports */}
      <div style={{ padding: "0 16px 16px" }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          padding: "0 4px 10px",
        }}>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 15, color: "#1F1F1F", letterSpacing: "-0.012em" }}>최근 리포트</div>
          <a onClick={goReport} style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 12, color: "#5F0080", textDecoration: "none", cursor: "pointer" }}>전체</a>
        </div>
        <div style={{ background: "#FFFFFF", borderRadius: 18, padding: "4px 4px" }}>
          {[
            { d: "5월 18일", t: "저녁의 호흡 정리",   sc: 72, dl: "+8" },
            { d: "5월 15일", t: "수면을 위한 명상",   sc: 65, dl: "+3" },
            { d: "5월 13일", t: "아침 마음챙김 4회차", sc: 61, dl: "—"  },
          ].map((r, i) => (
            <div key={i} onClick={goReport} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 12px",
              borderBottom: i < 2 ? "1px solid #F5F5F8" : "0",
              cursor: "pointer",
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: "50%",
                background: "conic-gradient(#5F0080 " + (r.sc * 3.6) + "deg, #F0EBF6 0)",
                display: "flex", alignItems: "center", justifyContent: "center", flex: "none",
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: "50%", background: "#FFFFFF",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 11, color: "#1F1F1F",
                }}>{r.sc}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 14, color: "#1F1F1F" }}>{r.t}</div>
                <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F", marginTop: 2 }}>{r.d}</div>
              </div>
              <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 12, color: r.dl === "—" ? "#A2A3AD" : "#1F8A5B" }}>{r.dl}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ height: 8 }} />
    </UserShell>
  );
}

window.HomeScreen = HomeScreen;
