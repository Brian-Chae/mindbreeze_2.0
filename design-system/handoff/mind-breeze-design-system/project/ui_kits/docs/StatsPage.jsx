/* global React, DocPage */
// Chapter 04 — Numbers / proof of credibility. Big stats + report samples
// as visual proof.
function StatsPage() {
  const big = [
    { n: "14", u: "건",    l: "뇌파 관련 특허",     sub: "출원 · 등록 누적" },
    { n: "2×", u: "회",   l: "CES 혁신상 수상",    sub: "2018 최고혁신상 · 2022 혁신상" },
    { n: "27K", u: "건",  l: "표준 뇌파 데이터",   sub: "인지기능 측정 데이터셋" },
    { n: "10K", u: "시간", l: "기능적 뇌파 데이터", sub: "명상·집중·휴식 라벨링 완료" },
  ];
  return (
    <DocPage chapter="04 · Credibility" pageNo={6} bg="#FAFAFB">
      <div style={{
        fontFamily: "var(--mb-font-mono)", fontSize: 11, letterSpacing: "0.14em",
        color: "#5F0080", fontWeight: 700,
      }}>BY THE NUMBERS</div>
      <h2 style={{
        fontFamily: "var(--mb-font-sans)", fontWeight: 700,
        fontSize: 36, lineHeight: "44px", letterSpacing: "-0.024em",
        color: "#1F1F1F", margin: "10px 0 8px",
      }}>
        10년의 연구가<br />증명하는 신뢰
      </h2>
      <p style={{
        fontFamily: "var(--mb-font-text)", fontWeight: 500,
        fontSize: 14, lineHeight: "24px", color: "rgba(0,0,0,0.66)",
        margin: 0, maxWidth: 520,
      }}>
        룩시드랩스는 의료기관, 연구소, 기업과 함께 뇌파의 학술적 근거를 쌓아왔습니다.
        MIND BREEZE는 이 위에서 만들어집니다.
      </p>

      {/* Stats grid */}
      <div style={{
        marginTop: 30,
        display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12,
      }}>
        {big.map(s => (
          <div key={s.l} style={{
            background: "#FFFFFF", border: "1px solid #E8E4F0", borderRadius: 18,
            padding: "22px 22px 18px",
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <div style={{
                fontFamily: "var(--mb-font-sans)", fontWeight: 800,
                fontSize: 56, lineHeight: 1, color: "#5F0080", letterSpacing: "-0.04em",
              }}>{s.n}</div>
              <div style={{
                fontFamily: "var(--mb-font-sans)", fontWeight: 700,
                fontSize: 18, color: "#1F1F1F",
              }}>{s.u}</div>
            </div>
            <div style={{
              fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 15,
              color: "#1F1F1F", marginTop: 14, letterSpacing: "-0.012em",
            }}>{s.l}</div>
            <div style={{
              fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12,
              color: "rgba(0,0,0,0.6)", marginTop: 3,
            }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Report samples row */}
      <div style={{
        marginTop: "auto",
        background: "#FFFFFF", border: "1px solid #E8E4F0", borderRadius: 18,
        padding: 18, display: "grid", gridTemplateColumns: "180px 1fr", gap: 18, alignItems: "center",
      }}>
        <div style={{ display: "flex", gap: 8 }}>
          <img src="../../assets/images/report_sample_1.png" alt="" style={{ width: 78, height: 110, objectFit: "cover", borderRadius: 6, boxShadow: "0 1px 1px rgba(25,26,30,0.06)" }} />
          <img src="../../assets/images/report_sample_2.png" alt="" style={{ width: 78, height: 110, objectFit: "cover", borderRadius: 6, boxShadow: "0 1px 1px rgba(25,26,30,0.06)" }} />
        </div>
        <div>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#5F0080", fontWeight: 700 }}>AI Report Sample</div>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 16, color: "#1F1F1F", marginTop: 6 }}>휴식·집중·균형의 두뇌건강 리포트</div>
          <p style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12, lineHeight: "20px", color: "rgba(0,0,0,0.6)", margin: "6px 0 0" }}>
            세션 종료 시점에 자동 발급. 8주차 추적, 또래 평균 비교, 지도사 코멘트 슬롯 포함.
          </p>
        </div>
      </div>
    </DocPage>
  );
}
window.StatsPage = StatsPage;
