/* global React, DocPage */
// Back cover — partnership CTA + contact info on the brand purple.
function BackCoverPage() {
  return (
    <DocPage hideChrome bleed bg="#5F0080" pageNo={null}>
      {/* Big watermark symbol bleeding off bottom-right */}
      <img src="../../assets/logo_symbol_dark.svg" alt=""
           style={{
             position: "absolute", right: -120, bottom: -160,
             width: 720, opacity: 0.12, filter: "brightness(0) invert(1)",
             transform: "rotate(-6deg)",
           }} />

      {/* Top logo */}
      <div style={{ position: "absolute", top: 48, left: 48, display: "flex", alignItems: "center", gap: 12 }}>
        <img src="../../assets/logo_symbol_dark.svg" alt=""
             style={{ width: 38, height: "auto", display: "block", filter: "brightness(0) invert(1)" }} />
        <span style={{
          fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 17,
          lineHeight: 0.85, letterSpacing: "-0.025em", color: "#FFFFFF",
        }}>Mind&nbsp;Breeze</span>
      </div>

      {/* Main copy */}
      <div style={{ position: "absolute", left: 48, top: 240, right: 280 }}>
        <span style={{
          display: "inline-flex", padding: "6px 12px", borderRadius: 9999,
          background: "rgba(255,255,255,0.16)", color: "#FFFFFF",
          fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 11, letterSpacing: "0.04em",
        }}>FOR INSTITUTIONS &amp; STUDIOS</span>
        <h2 style={{
          fontFamily: "var(--mb-font-sans)", fontWeight: 800,
          fontSize: 48, lineHeight: "60px", letterSpacing: "-0.03em",
          color: "#FFFFFF", margin: "20px 0 0",
        }}>
          과학적인 명상 클래스를<br />여러분의 공간에서<br />시작하세요
        </h2>
        <p style={{
          fontFamily: "var(--mb-font-text)", fontWeight: 500,
          fontSize: 15, lineHeight: "26px", color: "#E2C9F0",
          maxWidth: 460, margin: "20px 0 0",
        }}>
          기관 단위 도입, LINK BAND 패키지, 지도사 양성 프로그램까지
          한 번에 안내해 드립니다.
        </p>

        {/* CTA buttons */}
        <div style={{ display: "flex", gap: 10, marginTop: 32 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", height: 48, padding: "0 22px",
            borderRadius: 14, background: "#FFFFFF", color: "#5F0080",
            fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14,
          }}>도입 문의하기</span>
          <span style={{
            display: "inline-flex", alignItems: "center", height: 48, padding: "0 22px",
            borderRadius: 14, border: "1px solid rgba(255,255,255,0.4)", color: "#FFFFFF",
            fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 14,
          }}>지도사 안내서 받기 →</span>
        </div>
      </div>

      {/* Contact grid bottom-left */}
      <div style={{
        position: "absolute", left: 48, bottom: 48, right: 48,
        display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 32,
        color: "#FFFFFF", borderTop: "1px solid rgba(255,255,255,0.18)", paddingTop: 24,
      }}>
        <div>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#C6AEF6" }}>회사</div>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 15, marginTop: 8 }}>주식회사 룩시드랩스</div>
          <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12, lineHeight: "20px", color: "#E2C9F0", marginTop: 4 }}>
            서울특별시 성동구 성수일로 99<br />가나스튜디오 5층
          </div>
        </div>
        <div>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#C6AEF6" }}>연락처</div>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 15, marginTop: 8 }}>contact@looxidlabs.com</div>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontWeight: 500, fontSize: 12, color: "#E2C9F0", marginTop: 4 }}>+82 02-1234-5678</div>
        </div>
        <div>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#C6AEF6" }}>웹</div>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 15, marginTop: 8 }}>mindbreeze.kr</div>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontWeight: 500, fontSize: 12, color: "#E2C9F0", marginTop: 4 }}>looxidlabs.com</div>
        </div>
      </div>

      {/* Edition mark */}
      <div style={{
        position: "absolute", top: 48, right: 48, textAlign: "right", color: "#FFFFFF",
      }}>
        <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.14em", color: "#C6AEF6" }}>PRODUCT BROCHURE</div>
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 13, marginTop: 4 }}>2026 · Edition 01</div>
      </div>
    </DocPage>
  );
}
window.BackCoverPage = BackCoverPage;
