/* global React, DocPage */
// Cover — modeled on the homepage Hero: full-bleed hero image up top
// (woman + sunset + baked-in stress / 휴식도 bubbles), cream "editorial"
// pad underneath with logo lockup, eyebrow chip, dual-tone headline,
// body copy, and the same 4-stat trust strip as the website.

function CoverPage() {
  return (
    <DocPage hideChrome bleed pageNo={null} bg="#EBE6E2">
      {/* Top 56% — hero landing image, fades into cream */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: "56%",
        overflow: "hidden",
      }}>
        <img
          src="../../assets/images/hero_landing.png"
          alt=""
          style={{
            width: "100%", height: "100%",
            objectFit: "cover", objectPosition: "60% 38%",
            display: "block",
          }}
        />
        {/* Bottom fade into cream so the seam disappears */}
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: -1, height: 140,
          background: "linear-gradient(180deg, rgba(235,230,226,0) 0%, #EBE6E2 100%)",
        }} />
      </div>

      {/* Top-left logo lockup over image */}
      <div style={{
        position: "absolute", top: 36, left: 48,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <img src="../../assets/logo_symbol_dark.svg" alt=""
             style={{ width: 32, height: "auto", display: "block" }} />
        <span style={{
          fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 16,
          lineHeight: 0.85, letterSpacing: "-0.025em", color: "#1F1F1F",
        }}>Mind&nbsp;Breeze</span>
      </div>

      {/* Top-right edition mark */}
      <div style={{
        position: "absolute", top: 36, right: 48,
        textAlign: "right",
      }}>
        <div style={{
          fontFamily: "var(--mb-font-mono)", fontSize: 9, fontWeight: 600,
          letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(0,0,0,0.5)",
        }}>Product Brochure</div>
        <div style={{
          fontFamily: "var(--mb-font-mono)", fontWeight: 700, fontSize: 11,
          letterSpacing: "0.1em", color: "#1F1F1F", marginTop: 3,
        }}>2026 · EDITION 01</div>
      </div>

      {/* Lower editorial pad — copy + stats */}
      <div style={{
        position: "absolute", left: 48, right: 48, bottom: 56,
        display: "flex", flexDirection: "column", gap: 0,
      }}>
        <span style={{
          alignSelf: "flex-start",
          display: "inline-flex", alignItems: "center",
          padding: "7px 13px", borderRadius: 9999,
          background: "#FFFFFF", color: "#5F0080",
          fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 11,
          letterSpacing: "0.04em", boxShadow: "0 1px 1px rgba(25,26,30,0.06)",
        }}>뇌과학 IT기업, 룩시드랩스</span>

        <h1 style={{
          fontFamily: "var(--mb-font-sans)", fontWeight: 700,
          fontSize: 44, lineHeight: "54px", letterSpacing: "-0.034em",
          color: "#0A0A0A", margin: "22px 0 0",
        }}>
          과학으로 증명하는<br />
          <span style={{ color: "#5F0080" }}>한 호흡의 변화</span>
        </h1>

        <p style={{
          fontFamily: "var(--mb-font-text)", fontWeight: 500,
          fontSize: 14, lineHeight: "24px", color: "rgba(0,0,0,0.66)",
          margin: "16px 0 0", maxWidth: 480,
        }}>
          LINK BAND가 뇌파를 측정하고, AI가 분석하여
          지도사와 참여자에게 명상의 효과를 정확하게 전달합니다.
        </p>

        {/* Trust stats strip — matches Hero.jsx */}
        <div style={{
          marginTop: 32, paddingTop: 22,
          borderTop: "1px solid rgba(0,0,0,0.12)",
          display: "flex", gap: 32, alignItems: "baseline",
        }}>
          {[
            { n: "14",    l: "건의 뇌파 특허" },
            { n: "27K",   l: "표준 뇌파 데이터" },
            { n: "10K",   l: "시간 기능 데이터" },
            { n: "CES 2×", l: "혁신상 수상" },
          ].map(s => (
            <div key={s.l}>
              <div style={{
                fontFamily: "var(--mb-font-sans)", fontWeight: 700,
                fontSize: 22, letterSpacing: "-0.022em",
                color: "#0A0A0A", lineHeight: "26px",
              }}>{s.n}</div>
              <div style={{
                fontFamily: "var(--mb-font-text)", fontWeight: 500,
                fontSize: 11, color: "rgba(0,0,0,0.55)",
                marginTop: 4, letterSpacing: 0,
              }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tiny bottom-corner colophon */}
      <div style={{
        position: "absolute", left: 48, bottom: 22,
        fontFamily: "var(--mb-font-mono)", fontSize: 9, letterSpacing: "0.14em",
        color: "rgba(0,0,0,0.4)", textTransform: "uppercase",
      }}>For meditation guides &amp; institutions · v2.0</div>
    </DocPage>
  );
}
window.CoverPage = CoverPage;
