/* global React, DocPage */
// Chapter 03 — How it works. 4-step process. Each step is a numbered card
// with a band of colour and a short caption.
function FeatureGridPage() {
  const steps = [
    {
      n: "01",
      title: "기기 등록",
      body: "지도사 앱에서 LINK BAND를 등록하고 참여자와 페어링합니다. 한 번의 설정으로 모든 세션에 적용됩니다.",
      img: "device_register.png",
    },
    {
      n: "02",
      title: "세션 진행",
      body: "오프라인·온라인 어디서든 실시간으로 뇌파를 측정합니다. 한 지도사가 최대 8명을 동시에 진행할 수 있습니다.",
      img: "portrait_05_woman_sunset_white.png",
    },
    {
      n: "03",
      title: "AI 분석",
      body: "측정 데이터를 룩시드랩스의 학습 모델로 자동 해석합니다. 휴식도·집중도·균형도를 1초 단위로 산출합니다.",
      img: null, // visual: bars
    },
    {
      n: "04",
      title: "리포트 발급",
      body: "세션이 끝나면 두뇌건강 리포트가 자동 생성되어 참여자에게 즉시 발급됩니다.",
      img: "report_sample_1.png",
    },
  ];
  return (
    <DocPage chapter="03 · How it works" pageNo={5}>
      <div style={{
        fontFamily: "var(--mb-font-mono)", fontSize: 11, letterSpacing: "0.14em",
        color: "#5F0080", fontWeight: 700,
      }}>SERVICE FLOW</div>
      <h2 style={{
        fontFamily: "var(--mb-font-sans)", fontWeight: 700,
        fontSize: 36, lineHeight: "44px", letterSpacing: "-0.024em",
        color: "#1F1F1F", margin: "10px 0 6px",
      }}>
        등록부터 리포트까지,<br />한 자리에서
      </h2>
      <p style={{
        fontFamily: "var(--mb-font-text)", fontWeight: 500,
        fontSize: 14, lineHeight: "24px", color: "rgba(0,0,0,0.66)",
        margin: 0, maxWidth: 520,
      }}>
        지도사가 신경 써야 할 것은 명상의 흐름뿐. 나머지는 MIND BREEZE가 처리합니다.
      </p>

      <div style={{
        marginTop: 30,
        display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gridTemplateRows: "1fr 1fr",
        gap: 16, flex: 1,
      }}>
        {steps.map(s => (
          <div key={s.n} style={{
            background: "#FFFFFF", border: "1px solid #E8E4F0", borderRadius: 18,
            padding: 18, display: "flex", flexDirection: "column", gap: 12,
            overflow: "hidden",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                width: 32, height: 32, borderRadius: 10,
                background: "#5F0080", color: "#FFFFFF",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--mb-font-mono)", fontWeight: 800, fontSize: 12,
                letterSpacing: "0.04em",
              }}>{s.n}</span>
              <span style={{
                fontFamily: "var(--mb-font-sans)", fontWeight: 700,
                fontSize: 18, color: "#1F1F1F", letterSpacing: "-0.014em",
              }}>{s.title}</span>
            </div>
            {/* Visual block */}
            <div style={{
              height: 130, borderRadius: 12, overflow: "hidden",
              background: "#F5EDFC", position: "relative",
            }}>
              {s.img ? (
                <img src={`../../assets/images/${s.img}`} alt=""
                     style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 6,
                  padding: 14,
                }}>
                  {[0.25, 0.42, 0.58, 0.36, 0.72, 0.55, 0.86, 0.62, 0.94, 0.78].map((v, i) => (
                    <div key={i} style={{
                      width: 14, height: `${v * 100}%`,
                      borderRadius: "4px 4px 2px 2px",
                      background: i < 3 ? "#D7BCEC" : i < 6 ? "#A775D6" : i < 9 ? "#7D3399" : "#5F0080",
                    }} />
                  ))}
                </div>
              )}
            </div>
            <p style={{
              fontFamily: "var(--mb-font-text)", fontWeight: 500,
              fontSize: 12, lineHeight: "20px", color: "rgba(0,0,0,0.66)",
              margin: 0,
            }}>{s.body}</p>
          </div>
        ))}
      </div>
    </DocPage>
  );
}
window.FeatureGridPage = FeatureGridPage;
