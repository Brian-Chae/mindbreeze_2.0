/* global React */
const { useState } = React;

function Nav() {
  const [active, setActive] = useState("서비스");
  const items = ["서비스", "AI 리포트", "고객 사례", "고객센터"];
  return (
    <nav style={{
      position: "sticky",
      top: 0,
      zIndex: 50,
      background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid #EFEFEF",
    }}>
      <div style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: "18px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 32,
      }}>
        <a href="#" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
          <img src="../../assets/logo_symbol_dark.svg" width="28" height="13" alt="" />
          <span style={{
            fontFamily: "var(--mb-font-sans)",
            fontWeight: 800,
            fontSize: 19,
            color: "#5F0080",
            letterSpacing: "-0.02em",
          }}>mind&nbsp;breeze</span>
        </a>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {items.map(label => (
            <button
              key={label}
              onClick={() => setActive(label)}
              style={{
                background: "transparent",
                border: 0,
                padding: "10px 18px",
                fontFamily: "var(--mb-font-sans)",
                fontWeight: active === label ? 700 : 500,
                fontSize: 15,
                color: active === label ? "#5F0080" : "#1F1F1F",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="mb-btn mb-btn--ghost" style={{ height: 40, padding: "0 16px", fontSize: 14, whiteSpace: "nowrap" }}>
            지도사 로그인
          </button>
          <button className="mb-btn" style={{ height: 40, padding: "0 18px", fontSize: 14, whiteSpace: "nowrap" }}>
            서비스 신청
          </button>
        </div>
      </div>
    </nav>
  );
}

window.Nav = Nav;
