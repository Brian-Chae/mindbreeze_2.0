/* global React, DocPage */
// Chapter 01 — Brand story. Full-bleed mountain breath image on top half,
// brand statement + 3 pillars on bottom half.
function SectionDividerPage() {
  return (
    <DocPage chapter="01 · Brand" pageNo={3}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

        {/* Image band */}
        <div style={{
          position: "relative", height: 360, borderRadius: 22, overflow: "hidden",
          marginBottom: 36,
        }}>
          <img src="../../assets/images/feature_inhale_mountain.png" alt=""
               style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.45) 100%)",
          }} />
          <div style={{
            position: "absolute", left: 24, bottom: 22, right: 24,
            color: "#FFFFFF",
          }}>
            <div style={{
              fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.14em",
              textTransform: "uppercase", opacity: 0.85,
            }}>Chapter 01</div>
            <div style={{
              fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 32,
              letterSpacing: "-0.022em", marginTop: 6,
            }}>마음의 풍경을 데이터로</div>
          </div>
        </div>

        {/* Lede */}
        <h2 style={{
          fontFamily: "var(--mb-font-sans)", fontWeight: 700,
          fontSize: 30, lineHeight: "40px", letterSpacing: "-0.022em",
          color: "#1F1F1F", margin: 0,
          maxWidth: 520,
        }}>
          MIND BREEZE는 명상의 효과를<br />
          <span style={{ color: "#5F0080" }}>객관적인 데이터</span>로 보여줍니다.
        </h2>
        <p style={{
          fontFamily: "var(--mb-font-text)", fontWeight: 500,
          fontSize: 14, lineHeight: "24px", color: "rgba(0,0,0,0.66)",
          margin: "16px 0 0", maxWidth: 600,
        }}>
          뇌과학 IT기업 룩시드랩스가 10년 동안 축적한 뇌파 분석 기술로,
          지도사와 참여자가 한 호흡, 한 회차의 변화를 함께 확인합니다.
        </p>

        {/* Three pillars */}
        <div style={{
          marginTop: "auto",
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14,
        }}>
          {[
            { n: "01", t: "MEASURE", k: "측정", b: "LINK BAND가 호흡과 함께 뇌파를 읽습니다." },
            { n: "02", t: "ANALYZE", k: "분석", b: "AI가 휴식·집중·균형의 지표를 해석합니다." },
            { n: "03", t: "GUIDE",   k: "안내", b: "지도사와 참여자에게 정확한 피드백을 전달합니다." },
          ].map(p => (
            <div key={p.n} style={{
              background: "#FAFAFB", borderRadius: 18, padding: 22, border: "1px solid #EFEFEF",
            }}>
              <div style={{
                fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.14em",
                color: "#5F0080", fontWeight: 700,
              }}>{p.n} · {p.t}</div>
              <div style={{
                fontFamily: "var(--mb-font-sans)", fontWeight: 700,
                fontSize: 20, color: "#1F1F1F", marginTop: 10, letterSpacing: "-0.014em",
              }}>{p.k}</div>
              <p style={{
                fontFamily: "var(--mb-font-text)", fontWeight: 500,
                fontSize: 12, lineHeight: "20px", color: "rgba(0,0,0,0.6)",
                margin: "8px 0 0",
              }}>{p.b}</p>
            </div>
          ))}
        </div>
      </div>
    </DocPage>
  );
}
window.SectionDividerPage = SectionDividerPage;
