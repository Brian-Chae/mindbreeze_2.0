/* global React */
function Hero() {
  return (
    <section style={{
      position: "relative",
      minHeight: 720,
      overflow: "hidden",
      background: "#EBE6E2",
    }}>
      {/* Full-bleed landing image (woman + sunset + baked-in chat bubbles) */}
      <img
        src="../../assets/images/hero_landing.png"
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "right center",
          display: "block",
        }}
      />

      {/* Soft left protection gradient so copy stays legible on the pink/peach gradient */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: "linear-gradient(90deg, rgba(235,230,226,0.92) 0%, rgba(235,230,226,0.78) 28%, rgba(235,230,226,0.0) 52%)",
        pointerEvents: "none",
      }} />

      {/* Copy column */}
      <div style={{
        position: "relative",
        maxWidth: 1280,
        margin: "0 auto",
        padding: "120px 32px 96px",
      }}>
        <div style={{ maxWidth: 560 }}>
          <span className="mb-eyebrow" style={{ background: "#FFFFFF", color: "#5F0080" }}>
            뇌과학 IT기업, 룩시드랩스
          </span>
          <h1 style={{
            fontFamily: "var(--mb-font-sans)",
            fontWeight: 700,
            fontSize: 60,
            lineHeight: "72px",
            letterSpacing: "-0.034em",
            color: "#0A0A0A",
            margin: "28px 0 0",
          }}>
            과학으로 증명하는<br />
            <span style={{ color: "#5F0080" }}>한 호흡의 변화</span>
          </h1>
          <p style={{
            fontFamily: "var(--mb-font-text)",
            fontWeight: 500,
            fontSize: 18,
            lineHeight: "30px",
            color: "rgba(0,0,0,0.66)",
            maxWidth: 480,
            margin: "28px 0 0",
          }}>
            LINK BAND가 뇌파를 측정하고, AI가 분석하여<br />
            지도사와 참여자에게 명상의 효과를 정확하게 전달합니다.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 36, flexWrap: "wrap" }}>
            <button className="mb-btn" style={{ height: 52, padding: "0 28px", fontSize: 16, borderRadius: 14 }}>
              클래스 신청하기
            </button>
            <button className="mb-btn mb-btn--ghost" style={{ height: 52, padding: "0 22px", fontSize: 16, borderRadius: 14, background: "rgba(255,255,255,0.6)", backdropFilter: "blur(8px)" }}>
              샘플 리포트 보기 →
            </button>
          </div>

          {/* Trust stat strip */}
          <div style={{
            marginTop: 64,
            display: "flex",
            gap: 36,
            alignItems: "baseline",
            flexWrap: "wrap",
          }}>
            {[
              { n: "14", l: "건의 뇌파 특허" },
              { n: "27K", l: "표준 뇌파 데이터" },
              { n: "10K", l: "시간 기능 데이터" },
              { n: "CES 2×", l: "혁신상 수상" },
            ].map(s => (
              <div key={s.l}>
                <div style={{
                  fontFamily: "var(--mb-font-sans)",
                  fontWeight: 700,
                  fontSize: 28,
                  letterSpacing: "-0.02em",
                  color: "#0A0A0A",
                  lineHeight: "32px",
                }}>{s.n}</div>
                <div style={{
                  fontFamily: "var(--mb-font-text)",
                  fontWeight: 500,
                  fontSize: 13,
                  color: "rgba(0,0,0,0.6)",
                  marginTop: 4,
                  letterSpacing: 0,
                }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

window.Hero = Hero;
