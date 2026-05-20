/* global React, DocPage */
function TOCPage() {
  const sections = [
    { n: "01", title: "브랜드 이야기",    sub: "Mind Breeze가 다루는 것",        page: "p.04" },
    { n: "02", title: "제품 · LINK BAND", sub: "헤드밴드와 실시간 측정",        page: "p.06" },
    { n: "03", title: "작동 방식",        sub: "등록부터 리포트까지 4단계",     page: "p.08" },
    { n: "04", title: "신뢰의 근거",      sub: "특허 · 수상 · 데이터",          page: "p.10" },
    { n: "05", title: "함께하는 사람들",  sub: "참여자와 지도사의 목소리",      page: "p.12" },
  ];
  return (
    <DocPage chapter="Contents" pageNo={2}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 56, height: "100%" }}>
        {/* List */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{
            fontFamily: "var(--mb-font-mono)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "#6F6F6F",
          }}>Index · 2026</div>
          <h2 style={{
            fontFamily: "var(--mb-font-sans)", fontWeight: 700,
            fontSize: 40, lineHeight: "48px", letterSpacing: "-0.024em",
            color: "#1F1F1F", margin: "8px 0 28px",
          }}>목차</h2>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {sections.map((s, i) => (
              <a key={s.n} href={`#p${i + 3}`} style={{
                display: "grid", gridTemplateColumns: "48px 1fr 60px",
                gap: 16, alignItems: "baseline",
                padding: "18px 0",
                borderBottom: "1px solid #E8E4F0", textDecoration: "none",
              }}>
                <span style={{
                  fontFamily: "var(--mb-font-mono)", fontWeight: 700, fontSize: 14,
                  color: "#5F0080", letterSpacing: "0.04em",
                }}>{s.n}</span>
                <div>
                  <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 19, color: "#1F1F1F", letterSpacing: "-0.014em" }}>{s.title}</div>
                  <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 13, color: "#6F6F6F", marginTop: 3 }}>{s.sub}</div>
                </div>
                <span style={{
                  fontFamily: "var(--mb-font-mono)", fontSize: 12, color: "#6F6F6F",
                  letterSpacing: "0.04em", textAlign: "right",
                }}>{s.page}</span>
              </a>
            ))}
          </div>
        </div>

        {/* Sidebar — vertical image strip + opening statement */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ borderRadius: 16, overflow: "hidden", aspectRatio: "5 / 7" }}>
            <img src="../../assets/images/portrait_03_woman_robe.png" alt=""
                 style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ background: "#F5EDFC", borderRadius: 16, padding: 18 }}>
            <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#5F0080", fontWeight: 700 }}>About this brochure</div>
            <p style={{
              fontFamily: "var(--mb-font-text)", fontWeight: 500,
              fontSize: 12, lineHeight: "20px", color: "rgba(0,0,0,0.7)",
              margin: "8px 0 0",
            }}>
              본 자료는 명상 지도사·상담사·기관 도입 담당자를 위한 제품 소개서입니다.
              MIND BREEZE 2.0의 철학, 기기, 분석 방식, 도입 사례를 한 권에 담았습니다.
            </p>
          </div>
        </div>
      </div>
    </DocPage>
  );
}
window.TOCPage = TOCPage;
