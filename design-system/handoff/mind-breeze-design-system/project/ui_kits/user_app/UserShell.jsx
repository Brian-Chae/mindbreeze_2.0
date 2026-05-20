/* global React */
// Shared chrome for the participant ("내담자") mobile app — wraps the
// IOSDevice frame with a brand-tinted top bar and a tab bar pinned to
// the bottom. Screens render their own scrollable content between.

const TopBar = ({ left, right, eyebrow, title, dark }) => (
  <div style={{
    paddingTop: 56, paddingLeft: 20, paddingRight: 20,
    paddingBottom: 12,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    color: dark ? "#FFFFFF" : "#1F1F1F", flex: "none",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {left}
      <div>
        {eyebrow && (
          <div style={{
            fontFamily: "var(--mb-font-mono)", fontSize: 10, fontWeight: 600,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)",
          }}>{eyebrow}</div>
        )}
        {title && (
          <div style={{
            fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 18,
            letterSpacing: "-0.014em", marginTop: eyebrow ? 2 : 0,
          }}>{title}</div>
        )}
      </div>
    </div>
    <div>{right}</div>
  </div>
);

function TabBar({ active, onChange }) {
  const tabs = [
    { id: "home",    label: "오늘",   icon: ICONS_user.home    },
    { id: "class",   label: "클래스", icon: ICONS_user.calendar },
    { id: "report",  label: "리포트", icon: ICONS_user.report   },
    { id: "profile", label: "프로필", icon: ICONS_user.user     },
  ];
  return (
    <div style={{
      flex: "none", paddingBottom: 34, paddingTop: 10,
      background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(20px) saturate(180%)",
      WebkitBackdropFilter: "blur(20px) saturate(180%)",
      borderTop: "0.5px solid rgba(0,0,0,0.06)",
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
    }}>
      {tabs.map(t => {
        const on = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            background: "transparent", border: 0, padding: 6, cursor: "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            color: on ? "#5F0080" : "#A2A3AD",
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth={on ? "2" : "1.6"} strokeLinecap="round" strokeLinejoin="round">
              {t.icon.map((d, i) => <path key={i} d={d} />)}
            </svg>
            <span style={{
              fontFamily: "var(--mb-font-sans)", fontWeight: on ? 700 : 500,
              fontSize: 10, letterSpacing: "-0.01em",
            }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Outline icon set used in the user app
const ICONS_user = {
  home:     ["M3 11l9-8 9 8v10a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2z"],
  calendar: ["M8 2v4", "M16 2v4", "M3 9h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"],
  report:   ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M9 13h6", "M9 17h4"],
  user:     ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],
  bell:     ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M13.73 21a2 2 0 0 1-3.46 0"],
  chevronR: ["m9 18 6-6-6-6"],
  chevronL: ["m15 18-6-6 6-6"],
  close:    ["M18 6 6 18", "m6 6 12 12"],
  play:     ["M5 3l14 9-14 9z"],
  pause:    ["M6 4h4v16H6z", "M14 4h4v16h-4z"],
  share:    ["M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8", "m16 6-4-4-4 4", "M12 2v13"],
  cog:      ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"],
};

function UserShell({ children, tab, onTab, statusDark, hideTabs, hideTop, scroll = true, bg = "#F5EDFC", top }) {
  return (
    <div style={{
      width: 402, height: 874, background: bg,
      display: "flex", flexDirection: "column",
      fontFamily: "var(--mb-font-sans)", color: "#1F1F1F",
    }}>
      {!hideTop && top}
      <div style={{ flex: 1, overflow: scroll ? "auto" : "hidden", position: "relative" }}>
        {children}
      </div>
      {!hideTabs && <TabBar active={tab} onChange={onTab} />}
    </div>
  );
}

window.UserShell = UserShell;
window.TopBar = TopBar;
window.ICONS_user = ICONS_user;
