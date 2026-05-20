/* global React, StrokeIcon, ICONS */

// Confirm / destructive modal overlay. Mirrors preview/components-modal.html
// behaviour but lives inside the operator-app stage so other screens can
// trigger it via the ModalCtx provider.

function Modal({ data, onClose }) {
  if (!data) return null;
  const danger = data.kind === "danger";
  const Iconpad = ({ children, tone }) => (
    <div style={{
      width: 48, height: 48, borderRadius: 14,
      background: tone === "danger" ? "rgba(252,85,85,0.12)" : "#F5EDFC",
      color:      tone === "danger" ? "#D33F3F"             : "#5F0080",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>{children}</div>
  );
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute", inset: 0,
        background:
          "linear-gradient(0deg, rgba(0,0,0,0.18), rgba(0,0,0,0.18)), " +
          "linear-gradient(135deg, rgba(95,0,128,0.35) 0%, rgba(135,94,179,0.30) 100%)",
        backdropFilter: "blur(2px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100,
        animation: "mbFadeIn 220ms cubic-bezier(0.2,0.8,0.2,1)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 420, background: "#FFFFFF", borderRadius: 22,
          padding: "28px 28px 22px",
          boxShadow: "0 12px 30px rgba(95,0,128,0.18)",
          position: "relative",
          animation: "mbPopIn 240ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <button onClick={onClose} style={{
          position: "absolute", top: 16, right: 16,
          width: 30, height: 30, borderRadius: "50%", border: 0,
          background: "#F2F3F8", color: "#6F6F6F", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>

        <Iconpad tone={danger ? "danger" : "brand"}>
          {danger ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 4 5v7c0 5 4 8 8 10 4-2 8-5 8-10V5l-8-3z"/>
              <polyline points="9 12 11 14 15 10"/>
            </svg>
          )}
        </Iconpad>

        <h3 style={{
          fontFamily: "var(--mb-font-sans)", fontWeight: 700,
          fontSize: 19, lineHeight: "26px", letterSpacing: "-0.014em",
          color: "#1F1F1F", margin: "16px 0 8px",
        }}>{data.title}</h3>
        <p style={{
          fontFamily: "var(--mb-font-text)", fontWeight: 500,
          fontSize: 14, lineHeight: "22px", color: "#6F6F6F", margin: 0,
        }}>{data.body}</p>

        <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
          <button onClick={onClose} className="mb-btn mb-btn--ghost" style={{
            flex: 1, height: 44, fontSize: 14, borderRadius: 12,
          }}>{data.cancel || "취소"}</button>
          <button onClick={onClose} className="mb-btn" style={{
            flex: 1, height: 44, fontSize: 14, borderRadius: 12,
            background: danger ? "#D33F3F" : undefined,
          }}>{data.confirm || "확인"}</button>
        </div>
      </div>

      <style>{`
        @keyframes mbFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mbPopIn  { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
    </div>
  );
}

window.Modal = Modal;
