/* global React */
function PeopleSection() {
  const people = [
    { src: "portrait_01_warm_sweater.png",      label: "직장인",   tag: "스트레스 관리" },
    { src: "portrait_02_young_man_concrete.png", label: "청년",     tag: "집중력 회복" },
    { src: "portrait_03_woman_robe.png",        label: "시니어",   tag: "두뇌 휴식" },
    { src: "portrait_04_young_man_warm.png",    label: "대학생",   tag: "수면의 질" },
    { src: "portrait_05_woman_sunset_white.png", label: "프리랜서", tag: "감정 균형" },
    { src: "portrait_06_woman_purple_sunset.png", label: "수련자",   tag: "마음챙김" },
  ];
  return (
    <section style={{ background: "#FFFFFF", padding: "120px 32px" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 64,
          alignItems: "end",
          marginBottom: 56,
        }}>
          <div>
            <span className="mb-eyebrow">모두의 마음 안식</span>
            <h2 style={{
              fontFamily: "var(--mb-font-sans)",
              fontWeight: 700,
              fontSize: 42,
              lineHeight: "54px",
              letterSpacing: "-0.0336em",
              color: "#0A0A0A",
              margin: "20px 0 0",
            }}>
              다양한 일상에 스며드는<br />과학적인 명상
            </h2>
          </div>
          <p style={{
            fontFamily: "var(--mb-font-text)",
            fontWeight: 500,
            fontSize: 16,
            lineHeight: "28px",
            color: "rgba(0,0,0,0.6)",
            margin: 0,
            paddingBottom: 6,
          }}>
            MIND BREEZE는 누구의 호흡이든 측정합니다.
            직장인의 점심 휴식, 시니어의 아침 루틴, 학생의 시험 전 5분 — 일상의 모양은 달라도 뇌가 쉬는 방식은 동일합니다.
          </p>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 14,
        }}>
          {people.map(p => (
            <figure key={p.src} style={{ margin: 0, position: "relative" }}>
              <div style={{ aspectRatio: "5 / 7", overflow: "hidden", borderRadius: 18, background: "#EBE6E2" }}>
                <img
                  src={`../../assets/images/${p.src}`}
                  alt={p.label}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </div>
              <figcaption style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{
                  fontFamily: "var(--mb-font-sans)",
                  fontWeight: 700,
                  fontSize: 14,
                  color: "#0A0A0A",
                  letterSpacing: "-0.01em",
                }}>{p.label}</span>
                <span style={{
                  fontFamily: "var(--mb-font-text)",
                  fontWeight: 500,
                  fontSize: 12,
                  color: "rgba(0,0,0,0.5)",
                }}>{p.tag}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

window.PeopleSection = PeopleSection;
