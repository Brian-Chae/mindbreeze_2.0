/* global React, UserShell, TopBar, ICONS_user */

function ScoreRing({ score, label, color = "#5F0080" }) {
  const C = 2 * Math.PI * 52;
  return (
    <div style={{ width: 140, height: 140, position: "relative" }}>
      <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="70" cy="70" r="52" fill="none" stroke="#F0EBF6" strokeWidth="10" />
        <circle cx="70" cy="70" r="52" fill="none" stroke={color} strokeWidth="10"
                strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 44, color: "#1F1F1F", letterSpacing: "-0.028em", lineHeight: 1 }}>{score}</div>
        <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, fontWeight: 600, color: "#6F6F6F", letterSpacing: "0.08em", marginTop: 4, textTransform: "uppercase" }}>{label}</div>
      </div>
    </div>
  );
}

function MetricBar({ name, value, color }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 13, color: "#1F1F1F" }}>{name}</div>
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14, color: "#1F1F1F" }}>{value}</div>
      </div>
      <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: "#F0EBF6", overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function ReportScreen({ tab, onTab, back }) {
  const top = (
    <TopBar
      left={
        <button onClick={back} style={{
          width: 38, height: 38, borderRadius: 19,
          background: "rgba(255,255,255,0.7)", border: 0, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(8px)",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F1F1F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {ICONS_user.chevronL.map((d, i) => <path key={i} d={d} />)}
          </svg>
        </button>
      }
      eyebrow="2026.05.18 · 18분"
      title="저녁의 호흡 정리"
      right={
        <button style={{
          width: 38, height: 38, borderRadius: 19,
          background: "rgba(255,255,255,0.7)", border: 0, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(8px)",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F1F1F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {ICONS_user.share.map((d, i) => <path key={i} d={d} />)}
          </svg>
        </button>
      }
    />
  );

  return (
    <UserShell tab={tab} onTab={onTab} top={top} bg="#F5EDFC">
      {/* Score hero */}
      <div style={{ padding: "8px 16px 0" }}>
        <div style={{
          background: "#FFFFFF", borderRadius: 22, padding: 22,
          display: "flex", alignItems: "center", gap: 18,
        }}>
          <ScoreRing score={72} label="휴식도" />
          <div style={{ flex: 1 }}>
            <span style={{
              display: "inline-flex", padding: "4px 10px", borderRadius: 9999,
              background: "#E6F8F3", color: "#1F8A5B",
              fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 11, letterSpacing: "0.04em",
            }}>↓ 18% 개선</span>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 15, color: "#1F1F1F", marginTop: 10, letterSpacing: "-0.012em", lineHeight: "22px" }}>
              지난 회차보다<br />
              <span style={{ color: "#5F0080" }}>마음이 더 차분</span>해졌어요
            </div>
            <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12, color: "#6F6F6F", marginTop: 6 }}>
              또래 평균 64 · 최고 95
            </div>
          </div>
        </div>
      </div>

      {/* Three metric bars */}
      <div style={{ padding: "12px 16px 0" }}>
        <div style={{ background: "#FFFFFF", borderRadius: 22, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14, color: "#1F1F1F", letterSpacing: "-0.012em" }}>세부 지표</div>
          <MetricBar name="이완 (α 파)"   value={74} color="#5F0080" />
          <MetricBar name="집중 (β 파)"   value={68} color="#875EB3" />
          <MetricBar name="균형 (좌·우)"  value={82} color="#B373EF" />
        </div>
      </div>

      {/* Session timeline */}
      <div style={{ padding: "12px 16px 0" }}>
        <div style={{ background: "#FFFFFF", borderRadius: 22, padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14, color: "#1F1F1F", letterSpacing: "-0.012em" }}>회차 흐름</div>
            <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#6F6F6F", letterSpacing: "0.08em" }}>18분 · 4단계</div>
          </div>
          <svg viewBox="0 0 320 90" style={{ width: "100%", height: 90, marginTop: 12 }}>
            <defs>
              <linearGradient id="rg" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%"  stopColor="#5F0080" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#5F0080" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0,70 C 30,68 60,62 80,58 S 130,32 160,28 S 220,18 250,22 S 300,40 320,30 L 320,90 L 0,90 Z" fill="url(#rg)" />
            <path d="M0,70 C 30,68 60,62 80,58 S 130,32 160,28 S 220,18 250,22 S 300,40 320,30"
                  fill="none" stroke="#5F0080" strokeWidth="2.4" strokeLinecap="round" />
            {/* phase markers */}
            {[40, 130, 220, 300].map((x, i) => (
              <g key={i}>
                <line x1={x} y1={0} x2={x} y2={90} stroke="#F0EBF6" strokeWidth="1" />
              </g>
            ))}
          </svg>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", marginTop: 8 }}>
            {["입정", "호흡", "관찰", "회복"].map((s, i) => (
              <div key={s} style={{
                fontFamily: "var(--mb-font-mono)", fontSize: 9, fontWeight: 600, color: "#6F6F6F",
                letterSpacing: "0.06em", textAlign: "center", textTransform: "uppercase",
              }}>{i + 1} · {s}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Guide comment */}
      <div style={{ padding: "12px 16px 16px" }}>
        <div style={{ background: "#FBF7FE", borderRadius: 22, padding: 18, display: "flex", gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: "linear-gradient(135deg,#B373EF,#5F0080)", color: "#FFFFFF",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14,
            border: "2px solid #FFFFFF", flex: "none",
            boxShadow: "0 1px 1px rgba(25,26,30,0.06)",
          }}>김</div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 13, color: "#1F1F1F" }}>김지수 지도사</span>
              <span style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#6F6F6F" }}>· 오후 10:14</span>
            </div>
            <p style={{
              fontFamily: "var(--mb-font-text)", fontWeight: 500,
              fontSize: 13, lineHeight: "20px", color: "rgba(0,0,0,0.7)",
              margin: "6px 0 0",
            }}>
              호흡이 길어지면서 이완 지표가 안정되었어요.
              내일은 들숨을 5초까지 늘려보면 좋겠습니다.
            </p>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 16px 16px" }}>
        <button className="mb-btn" style={{ width: "100%", height: 50, borderRadius: 16, fontSize: 15 }}>
          전체 리포트 PDF 보기
        </button>
      </div>
    </UserShell>
  );
}

window.ReportScreen = ReportScreen;
