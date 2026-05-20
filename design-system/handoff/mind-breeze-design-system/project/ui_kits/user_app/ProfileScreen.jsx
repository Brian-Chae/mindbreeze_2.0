/* global React, UserShell, TopBar, ICONS_user */

function ProfileScreen({ tab, onTab }) {
  const top = (
    <TopBar
      eyebrow="Profile"
      title="내 정보"
      right={
        <button style={{
          width: 38, height: 38, borderRadius: 19,
          background: "rgba(255,255,255,0.7)", border: 0, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(8px)",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F1F1F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {ICONS_user.cog.map((d, i) => <path key={i} d={d} />)}
          </svg>
        </button>
      }
    />
  );

  const settingsItems = [
    { ico: "🔔", t: "알림 설정",          v: "세션 30분 전" },
    { ico: "📅", t: "수업 알림",          v: "켜짐" },
    { ico: "🎧", t: "재생 음향",          v: "자연음 · 60%" },
    { ico: "🩺", t: "LINK BAND 연결",     v: "LB-A02E1 · 88%" },
  ];

  return (
    <UserShell tab={tab} onTab={onTab} top={top} bg="#F5EDFC">
      {/* Profile hero card */}
      <div style={{ padding: "8px 16px 16px" }}>
        <div style={{
          background: "linear-gradient(135deg, #FFFFFF 0%, #F5EDFC 100%)",
          borderRadius: 22, padding: 22, position: "relative", overflow: "hidden",
        }}>
          <img src="../../assets/logo_symbol_dark.svg" alt=""
               style={{ position: "absolute", right: -28, bottom: -40, width: 160, opacity: 0.06, transform: "rotate(-8deg)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 14, position: "relative" }}>
            <div style={{
              width: 68, height: 68, borderRadius: "50%",
              background: "linear-gradient(135deg, #B373EF, #5F0080)",
              color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 24,
              border: "3px solid #FFFFFF", boxShadow: "0 1px 1px rgba(25,26,30,0.06)",
              flex: "none",
            }}>민</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 18, color: "#1F1F1F", letterSpacing: "-0.014em" }}>김민지</div>
              <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12, color: "#6F6F6F", marginTop: 4 }}>정기 8주 프로그램 · 4회차</div>
            </div>
          </div>

          {/* Program progress */}
          <div style={{ marginTop: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 12, color: "#1F1F1F" }}>프로그램 진척도</div>
              <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 12, color: "#5F0080" }}>50%</div>
            </div>
            <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: "#F0EBF6", overflow: "hidden" }}>
              <div style={{ width: "50%", height: "100%", background: "linear-gradient(90deg,#B373EF,#5F0080)", borderRadius: 4 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{
                  width: 26, height: 26, borderRadius: "50%",
                  background: i < 4 ? "#5F0080" : "#FFFFFF",
                  border: i < 4 ? "0" : "1.5px solid #DDDEE7",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--mb-font-mono)", fontWeight: 700, fontSize: 10,
                  color: i < 4 ? "#FFFFFF" : "#A2A3AD",
                }}>{i + 1}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick stat tiles */}
      <div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {[
          { l: "총 명상", v: "8시간", s: "32분" },
          { l: "최고 휴식도", v: "82", s: "5/11" },
          { l: "리포트", v: "12", s: "건" },
        ].map(s => (
          <div key={s.l} style={{ background: "#FFFFFF", borderRadius: 14, padding: "12px 12px" }}>
            <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 9, color: "#6F6F6F", letterSpacing: "0.08em", textTransform: "uppercase" }}>{s.l}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginTop: 4 }}>
              <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 20, color: "#1F1F1F", letterSpacing: "-0.02em", lineHeight: 1 }}>{s.v}</span>
              <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 10, color: "#6F6F6F" }}>{s.s}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Settings list */}
      <div style={{ padding: "0 16px 16px" }}>
        <div style={{ background: "#FFFFFF", borderRadius: 18 }}>
          {settingsItems.map((it, i) => (
            <div key={it.t} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
              borderBottom: i < settingsItems.length - 1 ? "1px solid #F5F5F8" : "0",
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: "#F5EDFC",
                display: "flex", alignItems: "center", justifyContent: "center", flex: "none", fontSize: 16,
              }}>{it.ico}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 14, color: "#1F1F1F" }}>{it.t}</div>
              </div>
              <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12, color: "#6F6F6F" }}>{it.v}</div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A2A3AD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICONS_user.chevronR.map((d, i) => <path key={i} d={d} />)}
              </svg>
            </div>
          ))}
        </div>
      </div>

      {/* Logout */}
      <div style={{ padding: "0 16px 16px" }}>
        <button className="mb-btn mb-btn--ghost" style={{ width: "100%", height: 48, fontSize: 13, borderRadius: 14, color: "#D33F3F", borderColor: "#FFD4D2" }}>로그아웃</button>
      </div>
    </UserShell>
  );
}

window.ProfileScreen = ProfileScreen;
