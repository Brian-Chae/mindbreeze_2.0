/* global React, AppShell, StrokeIcon, ICONS */
function SignIn() {
  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      <img src="../../assets/images/thumbnail3.jpg" alt=""
           style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 100%)" }} />
      <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18 }}>
        <img src="../../assets/logo_symbol_dark.svg" width="84" height="38" alt="" style={{ filter: "brightness(0) invert(1)" }} />
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 32, color: "#FFFFFF", letterSpacing: "-0.02em" }}>mind&nbsp;breeze</div>
        <div style={{ fontFamily: "var(--mb-font-text)", fontSize: 15, color: "rgba(255,255,255,0.86)", marginBottom: 28 }}>지도사 전용 · MIND BREEZE Operator</div>

        <button style={{
          display: "inline-flex", alignItems: "center", gap: 10, justifyContent: "center",
          height: 52, width: 280, borderRadius: 40,
          background: "#FFFFFF", border: "1px solid #DDDEE7",
          fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 15, color: "#1F1F1F", cursor: "pointer",
        }}>
          <img src="../../assets/icons/icon_google.svg" width="20" height="20" alt="" />
          Sign in with Google
        </button>
        <button style={{
          display: "inline-flex", alignItems: "center", gap: 10, justifyContent: "center",
          height: 52, width: 280, borderRadius: 40,
          background: "#FFFFFF", border: "1px solid #DDDEE7",
          fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 15, color: "#1F1F1F", cursor: "pointer",
        }}>
          <img src="../../assets/icons/icon_apple.svg" width="20" height="20" alt="" />
          Sign in with Apple
        </button>
        <div style={{ marginTop: 28, fontFamily: "var(--mb-font-text)", fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
          기관 발급 계정으로만 접속하실 수 있습니다.
        </div>
      </div>
    </div>
  );
}

window.SignIn = SignIn;
