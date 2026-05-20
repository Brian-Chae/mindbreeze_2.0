/* global React, AppShell, StrokeIcon, ICONS, useNav, useModal */
const { useState: useS_cli } = React;

// One participant row — mirrors preview/components-client-list.html but
// scaled up for the desktop app frame. Avatar ring shows program
// completion; 7 bars show recent stress trend with most-recent in full
// brand color; right-side date chip is the next scheduled session.

function Ring({ progress = 0, ringColor = "#5F0080", initial, gradient, paused }) {
  const C = 2 * Math.PI * 26; // r=26
  return (
    <div style={{ width: 64, height: 64, position: "relative", flex: "none" }}>
      <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="32" cy="32" r="26" fill="none" stroke="#F0EBF6" strokeWidth="3" />
        <circle cx="32" cy="32" r="26" fill="none" stroke={ringColor} strokeWidth="3"
                strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
      </svg>
      <div style={{
        position: "absolute", inset: 5, borderRadius: "50%",
        background: gradient, opacity: paused ? 0.78 : 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#FFFFFF", fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 18, letterSpacing: "-0.02em",
      }}>{initial}</div>
    </div>
  );
}

function Bars({ values, palette }) {
  // values: array of 7 numbers 0..1; palette: 4 colors from oldest to newest
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 36, flex: "none" }}>
      {values.map((v, i) => {
        const tier = i < 2 ? palette[0] : i < 4 ? palette[1] : i < 6 ? palette[2] : palette[3];
        return (
          <div key={i} style={{
            width: 11, height: `${Math.max(8, v * 100)}%`,
            background: tier, borderRadius: "4px 4px 2px 2px",
          }} />
        );
      })}
    </div>
  );
}

function DateChip({ dow, num, time, muted }) {
  const cls = muted ? { bg: "#F2F3F8", fg: "#6F6F6F" } : { bg: "#F5EDFC", fg: "#5F0080" };
  return (
    <div style={{
      width: 68, minHeight: 68, borderRadius: 16,
      background: cls.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "6px 0",
    }}>
      <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, fontWeight: 600, color: cls.fg, letterSpacing: "0.1em", textTransform: "uppercase" }}>{dow}</div>
      <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, color: cls.fg, fontSize: muted ? 14 : 22, lineHeight: "24px", letterSpacing: "-0.02em", marginTop: 2 }}>{num}</div>
      {time && <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, color: cls.fg, opacity: 0.7, marginTop: 1 }}>{time}</div>}
    </div>
  );
}

function StatusInline({ tone, children }) {
  const tones = {
    active:  { c: "#1F8A5B", d: "#59CE90", halo: "rgba(89,206,144,0.18)" },
    pending: { c: "#B57C00", d: "#EFC14C", halo: "rgba(239,193,76,0.20)" },
    paused:  { c: "#6F6F6F", d: "#A2A3AD", halo: "rgba(162,163,173,0.20)" },
  }[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 12, color: tones.c,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: tones.d, boxShadow: `0 0 0 3px ${tones.halo}` }} />
      {children}
    </span>
  );
}

function DeltaBlock({ tone, value, sub }) {
  const tones = { up: "#1F8A5B", down: "#D33F3F", flat: "#6F6F6F" };
  const arr   = { up: "↓",       down: "↑",        flat: "·" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-end", paddingBottom: 1 }}>
      <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 16, color: tones[tone], letterSpacing: "-0.012em" }}>
        <span style={{ fontSize: 11, fontWeight: 800, marginRight: 2 }}>{arr[tone]}</span>{value}
      </div>
      <div style={{ fontFamily: "var(--mb-font-text)", fontSize: 11, color: "#6F6F6F" }}>{sub}</div>
    </div>
  );
}

function ClientRow({ data, featured, onMenu }) {
  return (
    <div style={{
      background: featured ? "#FBF7FE" : "#FFFFFF",
      border: featured ? "1px solid #E8D8F8" : "1px solid #EFEFEF",
      borderRadius: 20, padding: "18px 22px 18px 18px",
      display: "grid",
      gridTemplateColumns: "70px 1.3fr 1.6fr 90px 36px",
      alignItems: "center", gap: 20, transition: "border-color 200ms, box-shadow 200ms",
    }}
    onMouseEnter={e => { if (!featured) { e.currentTarget.style.borderColor = "#E8D8F8"; e.currentTarget.style.boxShadow = "0 1px 1px rgba(25,26,30,0.06)"; } }}
    onMouseLeave={e => { if (!featured) { e.currentTarget.style.borderColor = "#EFEFEF"; e.currentTarget.style.boxShadow = "none"; } }}>
      <Ring progress={data.progress} ringColor={data.ringColor} initial={data.initial} gradient={data.gradient} paused={data.paused} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 17, color: data.paused ? "#6F6F6F" : "#1F1F1F", letterSpacing: "-0.014em", display: "flex", alignItems: "center", gap: 8 }}>
          {data.name}
          {featured && <span style={{ color: "#C2A6E0", fontSize: 13 }}>★</span>}
        </div>
        <div style={{ fontFamily: "var(--mb-font-text)", fontWeight: 500, fontSize: 13, color: "#6F6F6F", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
          {data.program}
          <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#C2C3CE" }} />
          {data.programDetail}
        </div>
        <div style={{ marginTop: 8 }}>
          <StatusInline tone={data.statusTone}>{data.statusLabel}</StatusInline>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, paddingLeft: 20, borderLeft: "1px solid #F0EBF6" }}>
        <Bars values={data.bars} palette={data.barPalette} />
        <DeltaBlock tone={data.deltaTone} value={data.deltaValue} sub="vs 시작" />
      </div>
      <div>
        <DateChip {...data.next} />
      </div>
      <button onClick={onMenu} style={{
        width: 32, height: 32, borderRadius: 10, border: 0, background: "transparent",
        color: "#A2A3AD", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "#F5EDFC"; e.currentTarget.style.color = "#5F0080"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#A2A3AD"; }}>
        <StrokeIcon d={ICONS.more} size={18} />
      </button>
    </div>
  );
}

function Clients() {
  const { open } = useModal();
  const [filter, setFilter] = useS_cli("전체");
  const rows = [
    {
      name: "김민지", initial: "민", progress: 0.75, ringColor: "#5F0080",
      gradient: "linear-gradient(140deg, #B373EF 10%, #5F0080 100%)",
      program: "정기 8주", programDetail: "4 / 8회차",
      statusTone: "active", statusLabel: "활동중 · 측정 진행",
      bars: [0.30, 0.48, 0.42, 0.65, 0.58, 0.78, 0.92],
      barPalette: ["#E8D8F8", "#D7BCEC", "#A775D6", "#5F0080"],
      deltaTone: "up", deltaValue: "18%",
      next: { dow: "목", num: "21", time: "09:30" },
      featured: true,
    },
    {
      name: "박서준", initial: "박", progress: 0.25, ringColor: "#E6593D",
      gradient: "linear-gradient(140deg, #FFC79A 10%, #E6593D 100%)",
      program: "1:1 코칭", programDetail: "2 / 8회차",
      statusTone: "active", statusLabel: "활동중",
      bars: [0.55, 0.60, 0.52, 0.62, 0.50, 0.58, 0.55],
      barPalette: ["#FFD4C2", "#FFC2A8", "#F49C7B", "#E6593D"],
      deltaTone: "flat", deltaValue: "안정",
      next: { dow: "금", num: "22", time: "19:00" },
    },
    {
      name: "정수아", initial: "정", progress: 0.50, ringColor: "#1F8A5B",
      gradient: "linear-gradient(140deg, #9CE9C4 10%, #1F8A5B 100%)",
      program: "사내 워크숍", programDetail: "라온건강원",
      statusTone: "pending", statusLabel: "리포트 발급 대기",
      bars: [0.88, 0.80, 0.72, 0.65, 0.58, 0.45, 0.38],
      barPalette: ["#C9ECDB", "#A8DDC1", "#7CCBA0", "#1F8A5B"],
      deltaTone: "up", deltaValue: "24%",
      next: { dow: "예정", num: "미정", muted: true },
    },
    {
      name: "이도윤", initial: "이", progress: 0.37, ringColor: "#C2C3CE",
      gradient: "linear-gradient(140deg, #B7C5F3 10%, #5E4FFF 100%)",
      program: "청소년 집중력", programDetail: "6 / 12회차",
      statusTone: "paused", statusLabel: "일시 중지 · 5월 11일",
      bars: [0.30, 0.38, 0.32, 0.48, 0.52, 0.60, 0.68],
      barPalette: ["#EAECF1", "#DDDFE6", "#CACCD5", "#A2A3AD"],
      deltaTone: "down", deltaValue: "9%",
      next: { dow: "—", num: "없음", muted: true },
      paused: true,
    },
    {
      name: "최예린", initial: "최", progress: 0.12, ringColor: "#5F0080",
      gradient: "linear-gradient(140deg, #FFC9C7 10%, #D33F3F 100%)",
      program: "바디스캔 입문", programDetail: "1 / 8회차",
      statusTone: "active", statusLabel: "활동중 · 신규",
      bars: [0.20, 0.32, 0.38, 0.42, 0.50, 0.62, 0.70],
      barPalette: ["#E8D8F8", "#D7BCEC", "#A775D6", "#5F0080"],
      deltaTone: "down", deltaValue: "12%",
      next: { dow: "월", num: "26", time: "11:00" },
    },
  ];

  return (
    <AppShell
      title="참여자"
      sub="활동중 12 · 대기 3 · 일시중지 1"
      rightSlot={
        <>
          <button style={{
            height: 44, padding: "0 14px", borderRadius: 22, border: "1px solid #DDDEE7", background: "#FFFFFF",
            display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
            fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 14, color: "#1F1F1F",
          }}>
            <StrokeIcon d={ICONS.search} size={18} />이름 / 전화
          </button>
          <button className="mb-btn" style={{ height: 44, padding: "0 18px", borderRadius: 22, display: "inline-flex", alignItems: "center", gap: 8 }}>
            <StrokeIcon d={ICONS.plus} size={18} color="#FFFFFF" />참여자 추가
          </button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 14, background: "#FFFFFF", border: "1px solid #E8E4F0", borderRadius: 9999, padding: 4, width: "fit-content" }}>
        {["전체", "이번 주", "리포트 대기", "일시 중지"].map(t => (
          <button key={t} onClick={() => setFilter(t)} style={{
            border: 0, padding: "8px 14px", borderRadius: 9999, cursor: "pointer",
            background: filter === t ? "#5F0080" : "transparent",
            color: filter === t ? "#FFFFFF" : "#6F6F6F",
            fontFamily: "var(--mb-font-sans)", fontWeight: 600, fontSize: 13,
          }}>{t}</button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(r => (
          <ClientRow
            key={r.name}
            data={r}
            featured={r.featured}
            onMenu={() => open({
              kind: r.paused ? "danger" : "confirm",
              title: r.paused ? `${r.name} 참여자를 삭제할까요?` : `${r.name} 참여자에게 리포트 발급?`,
              body: r.paused
                ? "참여자의 모든 측정 데이터와 리포트가 영구 삭제됩니다. 되돌릴 수 없습니다."
                : "최근 측정 결과를 바탕으로 두뇌건강 리포트를 즉시 발송합니다.",
              cancel: "취소",
              confirm: r.paused ? "삭제" : "발급하기",
            })}
          />
        ))}
      </div>
    </AppShell>
  );
}

window.Clients = Clients;
