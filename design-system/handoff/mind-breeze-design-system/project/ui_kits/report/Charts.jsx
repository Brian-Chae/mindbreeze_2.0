/* global React */
function Gauge({ value = 72, max = 100, label, sub, color = "#5F0080" }) {
  const r = 90, c = 2 * Math.PI * r, pct = value / max;
  // semicircle: 180deg, half of full circumference
  const dash = c * 0.5 * pct;
  const remain = c * 0.5 - dash;
  return (
    <div style={{ position: "relative", width: 220, height: 130 }}>
      <svg viewBox="0 0 220 130" width="220" height="130">
        <path d="M 20 110 A 90 90 0 0 1 200 110" stroke="#F2F3F8" strokeWidth="20" fill="none" strokeLinecap="round" />
        <path d="M 20 110 A 90 90 0 0 1 200 110"
              stroke={color} strokeWidth="20" fill="none" strokeLinecap="round"
              strokeDasharray={`${dash} ${remain + 1000}`} />
      </svg>
      <div style={{
        position: "absolute", left: 0, right: 0, top: 56, textAlign: "center",
        fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 44, color: "#1F1F1F", letterSpacing: "-0.04em",
      }}>{value}</div>
      <div style={{
        position: "absolute", left: 0, right: 0, top: 102, textAlign: "center",
        fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F", letterSpacing: "0.06em", textTransform: "uppercase",
      }}>{label}</div>
      {sub && <div style={{
        position: "absolute", left: 0, right: 0, top: 122, textAlign: "center",
        fontFamily: "var(--mb-font-text)", fontSize: 12, color: "#1F1F1F",
      }}>{sub}</div>}
    </div>
  );
}

function HBar({ label, value, max = 100, color = "#5F0080", note }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 13, color: "#1F1F1F" }}>{label}</span>
        <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14, color: "#1F1F1F", whiteSpace: "nowrap" }}>{value}<span style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F", marginLeft: 4 }}>/ {max}</span></span>
      </div>
      <div style={{ height: 10, background: "#F2F3F8", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 5 }} />
      </div>
      {note && <div style={{ fontFamily: "var(--mb-font-text)", fontSize: 12, color: "#6F6F6F" }}>{note}</div>}
    </div>
  );
}

function LineChart({ data, label, color = "#5F0080" }) {
  const w = 320, h = 110, pad = 8;
  const max = Math.max(...data), min = Math.min(...data);
  const step = (w - pad * 2) / (data.length - 1);
  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / Math.max(1, max - min)) * (h - pad * 2);
    return `${x},${y}`;
  });
  const path = "M" + points.join(" L");
  const fill = `M${points[0]} L${points.join(" L")} L${pad + (data.length - 1) * step},${h - pad} L${pad},${h - pad} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        <defs>
          <linearGradient id="lc-g" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"  stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={fill} fill="url(#lc-g)" />
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((v, i) => (
          <circle key={i} cx={pad + i * step} cy={pad + (1 - (v - min) / Math.max(1, max - min)) * (h - pad * 2)}
                  r={i === data.length - 1 ? 4 : 2.5} fill={color} />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#6F6F6F", marginTop: 6 }}>
        <span>0:00</span><span>5:00</span><span>10:00</span><span>15:00</span><span>20:00</span>
      </div>
    </div>
  );
}

window.Gauge = Gauge;
window.HBar = HBar;
window.LineChart = LineChart;
