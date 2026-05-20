/* global React */
function FeatureCards() {
  return (
    <section style={{ background: "#EBE6E2", padding: "0 32px 96px" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ marginBottom: 32 }}>
          <span className="mb-eyebrow" style={{ background: "#FFFFFF", color: "#5F0080" }}>
            서비스 구성
          </span>
          <h2 style={{
            fontFamily: "var(--mb-font-sans)",
            fontWeight: 700,
            fontSize: 36,
            lineHeight: "46px",
            letterSpacing: "-0.028em",
            color: "#0A0A0A",
            margin: "16px 0 0",
            maxWidth: 720,
          }}>
            기기와 호흡, 두 가지로 완성되는 명상 클래스
          </h2>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 20,
        }}>
          {/* LINK BAND product card */}
          <article style={{
            background: "#FFFFFF",
            borderRadius: 28,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}>
            <div style={{ aspectRatio: "16 / 9", overflow: "hidden" }}>
              <img
                src="../../assets/images/feature_link_headbands.png"
                alt="LINK BAND 5종 컬러"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </div>
            <div style={{ padding: "32px 32px 36px" }}>
              <div style={{
                fontFamily: "var(--mb-font-mono)",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.12em",
                color: "#5F0080",
                textTransform: "uppercase",
              }}>HARDWARE · LINK BAND</div>
              <h3 style={{
                fontFamily: "var(--mb-font-sans)",
                fontWeight: 700,
                fontSize: 24,
                lineHeight: "32px",
                color: "#0A0A0A",
                margin: "10px 0 8px",
                letterSpacing: "-0.02em",
              }}>
                머리에 닿는 순간, 뇌파를 읽습니다
              </h3>
              <p style={{
                fontFamily: "var(--mb-font-text)",
                fontWeight: 500,
                fontSize: 15,
                lineHeight: "26px",
                color: "rgba(0,0,0,0.6)",
                margin: 0,
              }}>
                의료용 등급 센서를 헤드밴드 한 줄에 담았습니다.<br />
                5가지 컬러, 가벼운 무게로 누구나 부담 없이 착용합니다.
              </p>
            </div>
          </article>

          {/* Inhale meditation card */}
          <article style={{
            background: "#FFFFFF",
            borderRadius: 28,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}>
            <div style={{ aspectRatio: "16 / 9", overflow: "hidden" }}>
              <img
                src="../../assets/images/feature_inhale_mountain.png"
                alt="inhale — 호흡 가이드"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </div>
            <div style={{ padding: "32px 32px 36px" }}>
              <div style={{
                fontFamily: "var(--mb-font-mono)",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.12em",
                color: "#5F0080",
                textTransform: "uppercase",
              }}>EXPERIENCE · BREATH GUIDE</div>
              <h3 style={{
                fontFamily: "var(--mb-font-sans)",
                fontWeight: 700,
                fontSize: 24,
                lineHeight: "32px",
                color: "#0A0A0A",
                margin: "10px 0 8px",
                letterSpacing: "-0.02em",
              }}>
                들숨과 날숨에 맞춰<br />지도사의 손길이 닿습니다
              </h3>
              <p style={{
                fontFamily: "var(--mb-font-text)",
                fontWeight: 500,
                fontSize: 15,
                lineHeight: "26px",
                color: "rgba(0,0,0,0.6)",
                margin: 0,
              }}>
                실시간 뇌파 데이터를 기반으로 호흡 리듬을 안내하고,<br />
                AI 코치가 지도사의 진행을 도와줍니다.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

window.FeatureCards = FeatureCards;
