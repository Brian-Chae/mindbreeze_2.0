/* global React */
function CTASection() {
  return (
    <section style={{ padding: "0 32px 96px", background: "#FFFFFF" }}>
      <div style={{
        maxWidth: 1280,
        margin: "0 auto",
        background: "#5F0080",
        borderRadius: 48,
        padding: "80px 60px",
        position: "relative",
        overflow: "hidden",
        color: "#FFFFFF",
      }}>
        <img
          src="../../assets/logo_symbol_dark.svg"
          alt=""
          style={{
            position: "absolute",
            right: -60,
            bottom: -80,
            width: 520,
            opacity: 0.18,
            filter: "brightness(0) invert(1)",
            transform: "rotate(-8deg)",
          }}
        />
        <div style={{ position: "relative", maxWidth: 720 }}>
          <span className="mb-eyebrow" style={{ background: "#191A1E", color: "#C6AEF6" }}>
            지도사를 위한 도구
          </span>
          <h2 style={{
            fontFamily: "var(--mb-font-sans)",
            fontWeight: 800,
            fontSize: 48,
            lineHeight: "60px",
            letterSpacing: "-0.03em",
            color: "#FFFFFF",
            margin: "24px 0 16px",
          }}>
            과학적인 명상 클래스를<br />여러분의 공간에서 시작하세요
          </h2>
          <p style={{
            fontFamily: "var(--mb-font-text)",
            fontWeight: 500,
            fontSize: 17,
            lineHeight: "28px",
            color: "#C6AEF6",
            margin: 0,
            maxWidth: 560,
          }}>
            기관 단위로 도입할 수 있습니다. 도입 절차, LINK BAND 패키지, 지도사 교육까지 한 번에 안내합니다.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 36 }}>
            <button className="mb-btn" style={{
              background: "#FFFFFF",
              color: "#5F0080",
              height: 52,
              padding: "0 28px",
              fontSize: 16,
              borderRadius: 14,
            }}>도입 문의</button>
            <button className="mb-btn mb-btn--ghost" style={{
              border: "1px solid rgba(255,255,255,0.4)",
              color: "#FFFFFF",
              background: "transparent",
              height: 52,
              padding: "0 22px",
              fontSize: 16,
              borderRadius: 14,
            }}>지도사 안내서 다운로드</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ background: "#191A1E", color: "#FFFFFF", padding: "60px 32px 40px" }}>
      <div style={{
        maxWidth: 1280,
        margin: "0 auto",
        display: "grid",
        gridTemplateColumns: "2fr 1fr 1fr 1fr",
        gap: 40,
        alignItems: "start",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="../../assets/logo_symbol_dark.svg" width="28" height="13" alt="" style={{ filter: "brightness(0) invert(1)" }} />
            <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 18 }}>mind&nbsp;breeze</span>
          </div>
          <p style={{ fontFamily: "var(--mb-font-text)", fontSize: 13, lineHeight: "22px", color: "#A2A3AD", margin: "14px 0 0", maxWidth: 360 }}>
            ⓒ Looxid Labs Inc.<br />
            서울특별시 성동구 · contact@looxidlabs.com
          </p>
        </div>
        {[
          { title: "서비스", items: ["클래스 소개", "AI 리포트", "도입 문의", "고객 사례"] },
          { title: "회사", items: ["룩시드랩스", "보도자료", "채용", "개인정보 처리방침"] },
          { title: "지원", items: ["고객센터", "지도사 가이드", "FAQ", "이용약관"] },
        ].map(col => (
          <div key={col.title}>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14, color: "#FFFFFF", marginBottom: 14 }}>{col.title}</div>
            {col.items.map(it => (
              <div key={it} style={{ fontFamily: "var(--mb-font-text)", fontSize: 13, lineHeight: "26px", color: "#A2A3AD" }}>{it}</div>
            ))}
          </div>
        ))}
      </div>
    </footer>
  );
}

window.CTASection = CTASection;
window.Footer = Footer;
