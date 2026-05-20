/* global React, DocPage */
// Chapter 02 — Product (LINK BAND). Big product photo + spec callouts +
// what's-in-the-experience strip at the bottom.
function ContentPage() {
  const specs = [
    { k: "센서",     v: "건식 EEG 4채널 + 가속도계" },
    { k: "착용감",   v: "전체 무게 38g · 헤드 사이즈 자동 조정" },
    { k: "배터리",   v: "1회 충전 8시간 · USB-C 30분 급속" },
    { k: "연결",     v: "BLE 5.2 · 최대 8대 동시 측정" },
    { k: "데이터",   v: "256Hz 원본 + 1Hz 지표 스트림" },
    { k: "지원",     v: "iOS · Android · macOS · Windows" },
  ];
  return (
    <DocPage chapter="02 · Product" pageNo={4}>
      <div style={{
        fontFamily: "var(--mb-font-mono)", fontSize: 11, letterSpacing: "0.14em",
        color: "#5F0080", fontWeight: 700,
      }}>HARDWARE · LINK BAND</div>
      <h2 style={{
        fontFamily: "var(--mb-font-sans)", fontWeight: 700,
        fontSize: 36, lineHeight: "44px", letterSpacing: "-0.024em",
        color: "#1F1F1F", margin: "10px 0 8px",
      }}>
        머리에 닿는 순간,<br />뇌파를 읽습니다
      </h2>
      <p style={{
        fontFamily: "var(--mb-font-text)", fontWeight: 500,
        fontSize: 14, lineHeight: "24px", color: "rgba(0,0,0,0.66)",
        margin: 0, maxWidth: 540,
      }}>
        의료용 등급 센서를 헤드밴드 한 줄에 담았습니다. 5가지 컬러, 가벼운 무게로
        누구나 부담 없이 착용합니다.
      </p>

      {/* Hero product image */}
      <div style={{ marginTop: 26, borderRadius: 22, overflow: "hidden" }}>
        <img src="../../assets/images/feature_link_headbands.png" alt=""
             style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", display: "block" }} />
      </div>

      {/* Spec sheet */}
      <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 0 }}>
        {specs.map((s, i) => (
          <div key={s.k} style={{
            display: "grid", gridTemplateColumns: "84px 1fr", gap: 14,
            padding: "14px 0",
            borderTop: "1px solid #E8E4F0",
            borderRight: i % 2 === 0 ? "1px solid #E8E4F0" : "0",
            paddingRight: i % 2 === 0 ? 24 : 0,
            paddingLeft:  i % 2 === 1 ? 24 : 0,
          }}>
            <span style={{
              fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.12em",
              textTransform: "uppercase", color: "#6F6F6F", paddingTop: 3,
            }}>{s.k}</span>
            <span style={{
              fontFamily: "var(--mb-font-sans)", fontWeight: 600,
              fontSize: 13, color: "#1F1F1F", letterSpacing: "-0.008em",
              lineHeight: "20px",
            }}>{s.v}</span>
          </div>
        ))}
      </div>

      {/* Bottom callout — pairs with the experience */}
      <div style={{
        marginTop: "auto",
        background: "#F5EDFC", borderRadius: 16, padding: 18,
        display: "flex", alignItems: "center", gap: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14, color: "#5F0080" }}>
            함께 제공되는 명상 콘텐츠 200+
          </div>
          <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12, color: "rgba(0,0,0,0.7)", marginTop: 4, lineHeight: "18px" }}>
            마음챙김 입문 · 직장인 스트레스 케어 · 수면 호흡 · 청소년 집중력 등 8개 카테고리
          </div>
        </div>
        <span style={{
          fontFamily: "var(--mb-font-mono)", fontSize: 11,
          color: "#5F0080", fontWeight: 700, letterSpacing: "0.06em",
        }}>→ p.06</span>
      </div>
    </DocPage>
  );
}
window.ContentPage = ContentPage;
