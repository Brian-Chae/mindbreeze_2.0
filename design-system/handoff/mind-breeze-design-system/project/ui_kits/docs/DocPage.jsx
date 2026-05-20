/* global React */
/*
  DocPage — A4 portrait page shell (794 × 1123 @ 96dpi).
  - Optional header (logo + chapter eyebrow) and footer (chapter / page no.)
  - `bleed` removes the inner padding for full-bleed covers
  - `bg` swaps the page surface color
*/
function DocPage({
  bg = "#FFFFFF",
  pageNo,
  chapter,
  bleed = false,
  hideChrome = false,
  children,
  style = {},
}) {
  return (
    <article
      style={{
        width: 794,
        height: 1123,
        background: bg,
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 12px 30px rgba(95,0,128,0.10)",
        borderRadius: 4,
        ...style,
      }}
    >
      {!hideChrome && (
        <header
          style={{
            position: "absolute",
            top: 32,
            left: 48,
            right: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 2,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src="../../assets/logo_symbol_dark.svg"
              alt=""
              style={{ width: 28, height: "auto", display: "block" }}
            />
            <span
              style={{
                fontFamily: "var(--mb-font-sans)",
                fontWeight: 600,
                fontSize: 14,
                lineHeight: 0.85,
                letterSpacing: "-0.025em",
                color: "var(--mb-fg)",
              }}
            >
              Mind&nbsp;Breeze
            </span>
          </div>
          {chapter && (
            <span
              style={{
                fontFamily: "var(--mb-font-mono)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--mb-fg-muted)",
              }}
            >
              {chapter}
            </span>
          )}
        </header>
      )}

      <div
        style={{
          position: "absolute",
          inset: bleed ? 0 : "92px 64px 80px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>

      {!hideChrome && pageNo != null && (
        <footer
          style={{
            position: "absolute",
            bottom: 32,
            left: 48,
            right: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "var(--mb-font-mono)",
            fontSize: 11,
            color: "var(--mb-fg-muted)",
            letterSpacing: "0.08em",
          }}
        >
          <span>© LOOXID LABS · MIND BREEZE 2.0</span>
          <span style={{ fontWeight: 600, color: "var(--mb-fg)" }}>
            {String(pageNo).padStart(2, "0")}
          </span>
        </footer>
      )}
    </article>
  );
}

window.DocPage = DocPage;
