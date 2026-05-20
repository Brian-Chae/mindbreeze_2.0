/* global React */
function Cover({ name = "채이서", date = "2024.12.04", session = "마음챙김 입문 · 4주차", score = 74 }) {
  // Hero cover: deep brand purple, big score, mint accent.
  // Replaces the earlier muted cream cover — this is the first surface
  // the participant sees on opening the report, so it leads with the
  // headline number and brand presence.
  return (
    <div style={{
      position: "relative",
      width: "100%",
      borderRadius: 28,
      overflow: "hidden",
      background:
        "radial-gradient(120% 80% at 80% 0%, #7D3399 0%, #5F0080 45%, #3A004F 100%)",
      padding: "32px 28px 28px",
      color: "#FFFFFF",
      boxShadow: "0 12px 30px rgba(95,0,128,0.18)",
    }}>
      {/* Decorative symbol — large, faded, anchored bottom-right */}
      <img
        src="../../assets/logo_symbol_dark.svg"
        alt=""
        style={{
          position: "absolute",
          right: -64, bottom: -80,
          width: 360,
          opacity: 0.10,
          filter: "brightness(0) invert(1)",
          transform: "rotate(-6deg)",
          pointerEvents: "none",
        }}
      />

      {/* Header row: brand mark + date */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src="../../assets/logo_symbol_dark.svg" width="28" height="13" alt="" style={{ filter: "brightness(0) invert(1)" }} />
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase" }}>MIND&nbsp;BREEZE</div>
        </div>
        <div style={{
          fontFamily: "var(--mb-font-mono)", fontWeight: 500, fontSize: 11,
          color: "#C6AEF6", letterSpacing: "0.08em",
        }}>{date}</div>
      </div>

      {/* Title */}
      <div style={{ position: "relative", marginTop: 28 }}>
        <div style={{
          fontFamily: "var(--mb-font-mono)", fontWeight: 600, fontSize: 11,
          color: "#C6AEF6", letterSpacing: "0.12em", textTransform: "uppercase",
        }}>AI brain wellness report</div>
        <h1 style={{
          fontFamily: "var(--mb-font-sans)",
          fontWeight: 800,
          fontSize: 34,
          lineHeight: "42px",
          letterSpacing: "-0.028em",
          color: "#FFFFFF",
          margin: "10px 0 0",
        }}>
          {name}님의<br />두뇌건강 리포트
        </h1>
      </div>

      {/* Hero score */}
      <div style={{
        position: "relative",
        marginTop: 28,
        display: "flex",
        alignItems: "flex-end",
        gap: 14,
      }}>
        <div style={{
          fontFamily: "var(--mb-font-sans)",
          fontWeight: 800,
          fontSize: 96,
          lineHeight: "84px",
          letterSpacing: "-0.06em",
          color: "#FFFFFF",
        }}>{score}</div>
        <div style={{ paddingBottom: 14 }}>
          <div style={{
            fontFamily: "var(--mb-font-mono)", fontSize: 10,
            color: "#C6AEF6", letterSpacing: "0.1em", textTransform: "uppercase",
          }}>brain wellness</div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            marginTop: 6,
            padding: "5px 10px", borderRadius: 9999,
            background: "#01F0C8", color: "#1A2E2A",
            fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 12,
          }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 14 12 8 18 14"/></svg>
            평균 +10
          </div>
        </div>
      </div>

      {/* Footer row: session info */}
      <div style={{
        position: "relative",
        marginTop: 28,
        paddingTop: 18,
        borderTop: "1px solid rgba(198,174,246,0.25)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#C6AEF6", letterSpacing: "0.08em", textTransform: "uppercase" }}>session</div>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14, color: "#FFFFFF", marginTop: 4 }}>{session}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#C6AEF6", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "#01F0C8", display: "inline-block" }}></span>
          AI 분석 완료
        </div>
      </div>
    </div>
  );
}

function Section({ eyebrow, title, body, children, tone = "light" }) {
  const isDark = tone === "dark";
  return (
    <section style={{
      width: "100%",
      borderRadius: 24,
      padding: "28px 24px",
      background: isDark ? "#191A1E" : "#FFFFFF",
      color: isDark ? "#FFFFFF" : "#1F1F1F",
      border: isDark ? "none" : "1px solid #EFEFEF",
      boxShadow: isDark ? "none" : "0 4px 12px rgba(0,0,0,0.04)",
    }}>
      <div style={{
        fontFamily: "var(--mb-font-mono)",
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: isDark ? "#C6AEF6" : "#875EB3",
      }}>{eyebrow}</div>
      <h2 style={{
        fontFamily: "var(--mb-font-sans)",
        fontWeight: 700,
        fontSize: 22,
        lineHeight: "30px",
        letterSpacing: "-0.018em",
        margin: "10px 0 0",
        color: isDark ? "#FFFFFF" : "#1F1F1F",
      }}>{title}</h2>
      {body && (
        <p style={{
          fontFamily: "var(--mb-font-text)",
          fontWeight: 500,
          fontSize: 14,
          lineHeight: "22px",
          color: isDark ? "#C6AEF6" : "#6F6F6F",
          margin: "12px 0 0",
        }}>{body}</p>
      )}
      {children && <div style={{ marginTop: 22 }}>{children}</div>}
    </section>
  );
}

window.Cover = Cover;
window.Section = Section;
