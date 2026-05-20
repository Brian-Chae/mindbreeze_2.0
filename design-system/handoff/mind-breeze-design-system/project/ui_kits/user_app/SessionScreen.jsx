/* global React, UserShell, TopBar, ICONS_user */

// In-session breathing screen — radial brand gradient, animated breath
// circle with pulsing rings, time + step indicator at top, controls
// docked at bottom.

function SessionScreen({ tab, onTab, onExit }) {
  return (
    <div style={{
      width: 402, height: 874, position: "relative", overflow: "hidden",
      background: "radial-gradient(120% 80% at 50% 35%, #C297E0 0%, #5F0080 70%, #2B0042 100%)",
      fontFamily: "var(--mb-font-sans)", color: "#FFFFFF",
    }}>
      {/* Top status bar absolute is drawn by IOSDevice if used directly,
          but this screen sits inside UserShell so we paint our own. */}

      {/* Top chrome */}
      <div style={{
        position: "absolute", top: 56, left: 16, right: 16,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        zIndex: 5,
      }}>
        <button onClick={onExit} style={{
          width: 40, height: 40, borderRadius: 20,
          background: "rgba(255,255,255,0.18)", border: 0, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(8px)",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round">
            {ICONS_user.close.map((d, i) => <path key={i} d={d} />)}
          </svg>
        </button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", color: "rgba(255,255,255,0.7)" }}>STEP 2 / 4</div>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14, marginTop: 2 }}>호흡 정리</div>
        </div>
        <button style={{
          width: 40, height: 40, borderRadius: 20,
          background: "rgba(255,255,255,0.18)", border: 0, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", color: "#FFFFFF",
          backdropFilter: "blur(8px)",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
        </button>
      </div>

      {/* Breath circle — three concentric rings with pulsing animation */}
      <div style={{
        position: "absolute", top: 160, left: 0, right: 0, height: 320,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {/* outermost rings */}
        <div style={{
          position: "absolute", width: 320, height: 320, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.0) 56%, rgba(255,255,255,0.10) 72%, rgba(255,255,255,0.0) 100%)",
          animation: "mbBreath 8s ease-in-out infinite",
        }} />
        <div style={{
          position: "absolute", width: 240, height: 240, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.0) 50%, rgba(255,255,255,0.16) 76%, rgba(255,255,255,0.0) 100%)",
          animation: "mbBreath 8s ease-in-out infinite",
          animationDelay: "0.4s",
        }} />
        <div style={{
          position: "absolute", width: 168, height: 168, borderRadius: "50%",
          background: "rgba(255,255,255,0.92)",
          boxShadow: "0 12px 40px rgba(255,255,255,0.18), inset 0 0 60px rgba(195,151,224,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column",
          animation: "mbBreath 8s ease-in-out infinite",
        }}>
          <div style={{
            fontFamily: "var(--mb-font-mono)", fontSize: 10, fontWeight: 700,
            color: "#5F0080", letterSpacing: "0.16em", textTransform: "uppercase",
          }}>INHALE</div>
          <div style={{
            fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 36,
            color: "#5F0080", marginTop: 4, letterSpacing: "-0.02em",
          }}>들숨</div>
          <div style={{
            fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "rgba(95,0,128,0.6)", marginTop: 6,
          }}>4초 동안 천천히</div>
        </div>
      </div>

      {/* Live EEG wave + brain rest meter */}
      <div style={{
        position: "absolute", top: 530, left: 24, right: 24,
        background: "rgba(255,255,255,0.12)", backdropFilter: "blur(14px)",
        borderRadius: 18, padding: "14px 18px",
        display: "flex", alignItems: "center", gap: 14,
        border: "1px solid rgba(255,255,255,0.16)",
      }}>
        <div>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>실시간 휴식도</div>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 28, color: "#FFFFFF", letterSpacing: "-0.02em", lineHeight: 1, marginTop: 4 }}>78</div>
        </div>
        <svg viewBox="0 0 180 36" style={{ flex: 1, height: 36 }}>
          <path d="M0,18 L12,16 L20,22 L28,10 L38,18 L46,6 L58,16 L70,8 L82,14 L92,4 L104,12 L116,8 L128,18 L138,10 L150,16 L162,8 L172,14 L180,10"
                fill="none" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
          <path d="M0,18 L12,16 L20,22 L28,10 L38,18 L46,6 L58,16 L70,8 L82,14 L92,4 L104,12 L116,8"
                fill="none" stroke="#01F0C8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="116" cy="8" r="3" fill="#01F0C8" />
        </svg>
      </div>

      {/* Bottom progress + controls */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        padding: "0 24px 60px",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "rgba(255,255,255,0.7)",
          marginBottom: 8,
        }}>
          <span>04:32</span>
          <span style={{ color: "#FFFFFF", fontWeight: 700 }}>저녁의 호흡 정리</span>
          <span>12:00</span>
        </div>
        <div style={{ height: 4, background: "rgba(255,255,255,0.22)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ width: "38%", height: "100%", background: "linear-gradient(90deg, #FFFFFF, #01F0C8)" }} />
        </div>
        <div style={{
          marginTop: 22, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
        }}>
          <button style={{
            width: 56, height: 56, borderRadius: 28,
            background: "rgba(255,255,255,0.16)", border: 0, cursor: "pointer", color: "#FFFFFF",
            display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>
            </svg>
          </button>
          <button style={{
            width: 80, height: 80, borderRadius: 40,
            background: "#FFFFFF", color: "#5F0080", border: 0, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 1px 1px rgba(25,26,30,0.06)",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              {ICONS_user.pause.map((d, i) => <path key={i} d={d} />)}
            </svg>
          </button>
          <button style={{
            width: 56, height: 56, borderRadius: 28,
            background: "rgba(255,255,255,0.16)", border: 0, cursor: "pointer", color: "#FFFFFF",
            display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes mbBreath {
          0%, 100% { transform: scale(0.92); opacity: 0.95; }
          50%      { transform: scale(1.05); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

window.SessionScreen = SessionScreen;
