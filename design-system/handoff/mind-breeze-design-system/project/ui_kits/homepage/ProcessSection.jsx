/* global React */
function ProcessSection() {
  const steps = [
    { n: "01", title: "LINK BAND 등록", body: "지도사 앱에서 측정 기기를 등록하고 참여자와 페어링합니다." },
    { n: "02", title: "세션 진행", body: "오프라인·온라인 세션에서 실시간으로 뇌파를 측정합니다." },
    { n: "03", title: "AI 분석", body: "측정 데이터를 룩시드랩스의 학습 모델로 자동 해석합니다." },
    { n: "04", title: "리포트 발급", body: "스트레스·집중·균형의 두뇌건강 리포트를 즉시 발급합니다." },
  ];
  return (
    <section style={{ background: "#FFFFFF", padding: "120px 32px" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <span className="mb-eyebrow">서비스 흐름</span>
          <h2 style={{
            fontFamily: "var(--mb-font-sans)",
            fontWeight: 700,
            fontSize: 42,
            lineHeight: "54px",
            letterSpacing: "-0.0336em",
            color: "#1F1F1F",
            margin: "20px 0 0",
          }}>
            등록부터 리포트까지, 한 자리에서
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
          {steps.map((s, i) => (
            <div key={s.n} style={{
              background: "#F5EDFC",
              borderRadius: 24,
              padding: 28,
              minHeight: 220,
              position: "relative",
            }}>
              <div style={{
                fontFamily: "var(--mb-font-mono)",
                fontWeight: 700,
                fontSize: 14,
                color: "#5F0080",
                letterSpacing: "0.1em",
              }}>{s.n}</div>
              <h3 style={{
                fontFamily: "var(--mb-font-sans)",
                fontWeight: 700,
                fontSize: 22,
                lineHeight: "30px",
                color: "#1F1F1F",
                margin: "20px 0 10px",
              }}>{s.title}</h3>
              <p style={{
                fontFamily: "var(--mb-font-text)",
                fontWeight: 500,
                fontSize: 14,
                lineHeight: "22px",
                color: "rgba(0,0,0,0.6)",
                margin: 0,
              }}>{s.body}</p>
              {i < steps.length - 1 && (
                <div style={{
                  position: "absolute",
                  right: -14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#B373EF",
                  fontSize: 22,
                  fontWeight: 300,
                }}>›</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

window.ProcessSection = ProcessSection;
