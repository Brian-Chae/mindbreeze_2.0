/* global React, DocPage */
// Chapter 05 — People + testimonial. Portrait grid above, large guide
// testimonial below.
function QuotePage() {
  const people = [
    { src: "portrait_01_warm_sweater.png",      label: "직장인",   tag: "스트레스 관리" },
    { src: "portrait_02_young_man_concrete.png", label: "청년",     tag: "집중력 회복" },
    { src: "portrait_04_young_man_warm.png",    label: "대학생",   tag: "수면의 질" },
    { src: "portrait_05_woman_sunset_white.png", label: "프리랜서", tag: "감정 균형" },
  ];
  return (
    <DocPage chapter="05 · People" pageNo={7}>
      <div style={{
        fontFamily: "var(--mb-font-mono)", fontSize: 11, letterSpacing: "0.14em",
        color: "#5F0080", fontWeight: 700,
      }}>MEDITATION FOR EVERYONE</div>
      <h2 style={{
        fontFamily: "var(--mb-font-sans)", fontWeight: 700,
        fontSize: 36, lineHeight: "44px", letterSpacing: "-0.024em",
        color: "#1F1F1F", margin: "10px 0 8px",
      }}>
        다양한 일상에 스며드는<br />과학적인 명상
      </h2>
      <p style={{
        fontFamily: "var(--mb-font-text)", fontWeight: 500,
        fontSize: 14, lineHeight: "24px", color: "rgba(0,0,0,0.66)",
        margin: 0, maxWidth: 520,
      }}>
        직장인의 점심 휴식, 대학생의 시험 전 5분, 시니어의 아침 루틴 —
        삶의 모양은 달라도 뇌가 쉬는 방식은 같습니다.
      </p>

      {/* Portrait grid */}
      <div style={{
        marginTop: 28,
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12,
      }}>
        {people.map(p => (
          <figure key={p.src} style={{ margin: 0 }}>
            <div style={{ aspectRatio: "5 / 7", overflow: "hidden", borderRadius: 14 }}>
              <img src={`../../assets/images/${p.src}`} alt={p.label}
                   style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
            <figcaption style={{
              marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "baseline",
            }}>
              <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 13, color: "#1F1F1F", letterSpacing: "-0.01em" }}>{p.label}</span>
              <span style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 11, color: "rgba(0,0,0,0.5)" }}>{p.tag}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {/* Testimonial card */}
      <div style={{
        marginTop: "auto",
        background: "#5F0080", color: "#FFFFFF", borderRadius: 22,
        padding: "32px 32px 28px",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          fontFamily: "var(--mb-font-sans)", fontWeight: 800,
          fontSize: 80, lineHeight: 1, color: "rgba(255,255,255,0.18)",
          position: "absolute", top: 6, left: 24,
        }}>"</div>
        <blockquote style={{
          fontFamily: "var(--mb-font-sans)", fontWeight: 700,
          fontSize: 22, lineHeight: "32px", letterSpacing: "-0.018em",
          color: "#FFFFFF", margin: 0, position: "relative", paddingLeft: 30,
        }}>
          이전엔 ‘오늘 명상이 잘 됐을까’ 라는 막연한 질문에 답하기 어려웠어요.
          지금은 참여자분들과 데이터를 보며 진짜 대화가 시작됩니다.
        </blockquote>
        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: "50%",
            background: "linear-gradient(135deg,#FFC79A,#E6593D)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#FFFFFF", fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14,
            border: "2px solid #FFFFFF",
          }}>김</div>
          <div>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14 }}>김지수</div>
            <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 12, color: "#E2C9F0" }}>마인드브리즈 청담센터 · 지도사 4년차</div>
          </div>
        </div>
      </div>
    </DocPage>
  );
}
window.QuotePage = QuotePage;
