/* global React */
const { useState, createContext, useContext } = React;

// Routing — tiny replacement for React Navigation
const NavCtx = React.createContext({ route: "dashboard", go: () => {} });
window.NavCtx = NavCtx;
window.useNav = () => React.useContext(NavCtx);

// Modal portal context — any screen can open a confirm/destructive dialog
const ModalCtx = React.createContext({ open: () => {}, close: () => {} });
window.ModalCtx = ModalCtx;
window.useModal = () => React.useContext(ModalCtx);

function StrokeIcon({ d, size = 22, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      {d.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
window.StrokeIcon = StrokeIcon;

window.ICONS = {
  home:       ["M3 11l9-8 9 8v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"],
  calendar:   ["M8 2v4", "M16 2v4", "M3 9h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"],
  users:      ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  message:    ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  report:     ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M9 13h6", "M9 17h4"],
  settings:   ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"],
  play:       ["M5 3l14 9-14 9z"],
  pause:      ["M6 4h4v16H6z", "M14 4h4v16h-4z"],
  plus:       ["M12 5v14", "M5 12h14"],
  search:     ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.35-4.35"],
  bell:       ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M13.73 21a2 2 0 0 1-3.46 0"],
  chevronR:   ["m9 18 6-6-6-6"],
  chevronL:   ["m15 18-6-6 6-6"],
  bluetooth:  ["m6.5 6.5 11 11L12 23V1l5.5 5.5-11 11"],
  send:       ["m22 2-7 20-4-9-9-4 20-7Z"],
  attach:     ["m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"],
  file:       ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"],
  more:       ["M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"],
  trash:      ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],
  check:      ["M20 6 9 17l-5-5"],
  star:       ["M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"],
};

function AppShell({ children, title, sub, rightSlot, contentPad = "24px 32px", noScroll = false }) {
  const { route, go } = useNav();
  const railItems = [
    { id: "dashboard",       label: "대시보드", icon: ICONS.home },
    { id: "session-running", label: "수업 진행", icon: ICONS.calendar },
    { id: "clients",         label: "참여자",  icon: ICONS.users },
    { id: "messages",        label: "메시지",  icon: ICONS.message, badge: 3 },
    { id: "reports",         label: "리포트",  icon: ICONS.report },
    { id: "settings",        label: "설정",    icon: ICONS.settings },
  ];
  return (
    <div style={{
      width: 1366, height: 1024, background: "#FFFFFF",
      display: "grid", gridTemplateColumns: "240px 1fr", overflow: "hidden",
      fontFamily: "var(--mb-font-sans)",
      borderRadius: 24, border: "1px solid #DDDEE7",
    }}>
      <aside style={{
        background: "#F5EDFC",
        padding: "32px 20px",
        display: "flex", flexDirection: "column", gap: 28,
        borderRight: "1px solid #EFEFEF",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px" }}>
          <img src="../../assets/logo_symbol_dark.svg" width="28" height="13" alt="" />
          <span style={{ fontWeight: 800, fontSize: 17, color: "#5F0080", letterSpacing: "-0.02em" }}>mind&nbsp;breeze</span>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {railItems.map(it => {
            const active = route === it.id;
            return (
              <button key={it.id} onClick={() => go(it.id)} style={{
                display: "flex", alignItems: "center", gap: 12,
                background: active ? "#FFFFFF" : "transparent",
                border: 0, padding: "12px 14px", borderRadius: 12,
                color: active ? "#5F0080" : "#1F1F1F",
                fontFamily: "var(--mb-font-sans)", fontWeight: active ? 700 : 500, fontSize: 15,
                cursor: "pointer", textAlign: "left",
                boxShadow: active ? "0 1px 1px rgba(25,26,30,0.06)" : "none",
                position: "relative",
              }}>
                <StrokeIcon d={it.icon} size={20} color={active ? "#5F0080" : "#1F1F1F"} />
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.badge && (
                  <span style={{
                    minWidth: 18, height: 18, padding: "0 6px", borderRadius: 9,
                    background: "#5F0080", color: "#FFFFFF",
                    fontFamily: "var(--mb-font-mono)", fontWeight: 700, fontSize: 10,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>{it.badge}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div style={{ marginTop: "auto", background: "#FFFFFF", borderRadius: 16, padding: 16 }}>
          <div style={{ fontSize: 12, color: "#6F6F6F", fontFamily: "var(--mb-font-mono)" }}>지도사</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#1F1F1F", marginTop: 4 }}>김지수</div>
          <div style={{ fontSize: 12, color: "#6F6F6F", marginTop: 2 }}>마인드브리즈 청담센터</div>
        </div>
      </aside>
      <section style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{
          height: 76, padding: "0 32px", flex: "none",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid #EFEFEF",
        }}>
          <div>
            {sub && <div style={{ fontSize: 12, color: "#6F6F6F", fontFamily: "var(--mb-font-mono)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{sub}</div>}
            <div style={{ fontWeight: 700, fontSize: 22, color: "#1F1F1F", letterSpacing: "-0.012em", marginTop: 2 }}>{title}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {rightSlot}
            <button style={{
              width: 44, height: 44, borderRadius: 22, background: "#F2F3F8", border: 0, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <StrokeIcon d={ICONS.bell} size={20} color="#1F1F1F" />
            </button>
          </div>
        </header>
        <div style={{
          flex: 1,
          overflow: noScroll ? "hidden" : "auto",
          background: "#FFFFFF",
          padding: contentPad,
        }}>
          {children}
        </div>
      </section>
    </div>
  );
}

window.AppShell = AppShell;

// Status pill — used in headers (e.g. SessionRunning right slot)
function StatusPill({ tone = "muted", children, leading, trailing }) {
  const tones = {
    primary: { bg: "#5F0080", color: "#FFFFFF" },
    soft:    { bg: "#D2AEFC", color: "#5F0080" },
    danger:  { bg: "rgba(252,85,85,0.18)", color: "#D33F3F" },
    ghost:   { bg: "rgba(255,255,255,0.2)", color: "#FFFFFF" },
    muted:   { bg: "#F5EDFC", color: "#5F0080" },
  }[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      height: 36, padding: "0 14px", borderRadius: 18,
      background: tones.bg, color: tones.color,
      fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 13,
    }}>
      {leading}{children}{trailing}
    </span>
  );
}
window.StatusPill = StatusPill;
