/* global React, AppShell, StrokeIcon, ICONS */
const { useState: useS_msg } = React;

function ConvoListItem({ data, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", textAlign: "left", border: 0, cursor: "pointer",
      background: active ? "#F5EDFC" : "transparent",
      padding: "14px 14px", borderRadius: 14,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: "50%", flex: "none",
        background: data.gradient,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#FFFFFF", fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 15,
        border: "2px solid #FFFFFF", boxShadow: "0 0 0 1px #E8E4F0",
        position: "relative",
      }}>
        {data.initial}
        {data.online && (
          <span style={{
            position: "absolute", bottom: 0, right: 0,
            width: 12, height: 12, borderRadius: "50%",
            background: "#59CE90", border: "2px solid #FFFFFF",
          }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: active || data.unread ? 700 : 600, fontSize: 14, color: "#1F1F1F", letterSpacing: "-0.012em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.name}</span>
          <span style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, color: data.unread ? "#5F0080" : "#A2A3AD", flex: "none" }}>{data.when}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3, gap: 8 }}>
          <span style={{
            fontFamily: "var(--mb-font-text)", fontSize: 12,
            color: data.unread ? "#1F1F1F" : "#6F6F6F",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1,
            fontWeight: data.unread ? 600 : 500,
          }}>{data.last}</span>
          {data.unread && (
            <span style={{
              minWidth: 18, height: 18, padding: "0 6px", borderRadius: 9,
              background: "#5F0080", color: "#FFFFFF",
              fontFamily: "var(--mb-font-mono)", fontWeight: 700, fontSize: 10,
              display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none",
            }}>{data.unread}</span>
          )}
        </div>
      </div>
    </button>
  );
}

function Bubble({ side, children, time }) {
  const me = side === "me";
  return (
    <div style={{ display: "flex", justifyContent: me ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 8, marginTop: 8 }}>
      {!me && <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#B373EF,#5F0080)", color: "#FFFFFF", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"var(--mb-font-sans)", fontWeight:700, fontSize:11 }}>민</div>}
      {me && <span style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#A2A3AD" }}>{time}</span>}
      <div style={{
        maxWidth: "65%",
        padding: "12px 16px",
        borderRadius: me ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
        background: me ? "#5F0080" : "#FFFFFF",
        color: me ? "#FFFFFF" : "#1F1F1F",
        border: me ? "0" : "1px solid #EFEFEF",
        fontFamily: "var(--mb-font-text)", fontSize: 14, lineHeight: "21px", letterSpacing: "0.005em",
      }}>{children}</div>
      {!me && <span style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#A2A3AD" }}>{time}</span>}
    </div>
  );
}

function FileCard() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 8, marginLeft: 36 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 16px", borderRadius: 16,
        background: "#FFFFFF", border: "1px solid #EFEFEF", maxWidth: "60%",
      }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "#F5EDFC", color: "#5F0080", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <StrokeIcon d={ICONS.file} size={20} color="#5F0080" />
        </div>
        <div>
          <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14, color: "#1F1F1F" }}>2주차 리포트.pdf</div>
          <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F", marginTop: 2 }}>2.4 MB · 조회 전</div>
        </div>
      </div>
    </div>
  );
}

function Messages() {
  const convos = [
    { id: "min",  name: "김민지", initial: "민", gradient: "linear-gradient(135deg,#B373EF,#5F0080)", last: "선생님, 오늘 세션 전에 잠깐 통화 가능하실까요?", when: "14:02", unread: 2, online: true },
    { id: "park", name: "박서준", initial: "박", gradient: "linear-gradient(135deg,#FFC79A,#E6593D)", last: "감사합니다. 다음 주 금요일에 뵙겠습니다.",       when: "어제",  unread: 0, online: false },
    { id: "jung", name: "정수아", initial: "정", gradient: "linear-gradient(135deg,#9CE9C4,#1F8A5B)", last: "리포트 잘 받았습니다 :)",                       when: "어제",  unread: 0, online: true },
    { id: "lee",  name: "이도윤", initial: "이", gradient: "linear-gradient(135deg,#B7C5F3,#5E4FFF)", last: "프로그램 잠시 멈추고 싶어요",                   when: "5/14",  unread: 0, online: false },
    { id: "choi", name: "최예린", initial: "최", gradient: "linear-gradient(135deg,#FFC9C7,#D33F3F)", last: "기기 충전이 잘 안되는 것 같아요",               when: "5/12",  unread: 1, online: false },
    { id: "han",  name: "한아윤", initial: "한", gradient: "linear-gradient(135deg,#FFE8B0,#D9A82B)", last: "감사해요 선생님!",                              when: "5/09",  unread: 0, online: false },
  ];
  const [activeId, setActive] = useS_msg("min");
  const active = convos.find(c => c.id === activeId);

  return (
    <AppShell title="메시지" sub="참여자 1:1 채팅" contentPad="0" noScroll>
      <div style={{ height: "100%", display: "grid", gridTemplateColumns: "320px 1fr 280px", overflow: "hidden" }}>

        {/* List column */}
        <div style={{ borderRight: "1px solid #EFEFEF", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "16px 14px 12px", borderBottom: "1px solid #F5F5F8" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "0 14px", height: 40,
              borderRadius: 9999, background: "#F2F3F8",
            }}>
              <StrokeIcon d={ICONS.search} size={16} color="#A2A3AD" />
              <input placeholder="대화 검색" style={{
                flex: 1, border: 0, background: "transparent", outline: "none",
                fontFamily: "var(--mb-font-sans)", fontSize: 13, color: "#1F1F1F",
              }} />
            </div>
          </div>
          <div style={{ overflow: "auto", padding: "8px 8px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
            {convos.map(c => (
              <ConvoListItem key={c.id} data={c} active={c.id === activeId} onClick={() => setActive(c.id)} />
            ))}
          </div>
        </div>

        {/* Thread column */}
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto", overflow: "hidden", background: "#FAFAFB" }}>
          {/* Thread header */}
          <div style={{ padding: "14px 22px", background: "#FFFFFF", borderBottom: "1px solid #EFEFEF", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: active.gradient, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 14 }}>{active.initial}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 15, color: "#1F1F1F", letterSpacing: "-0.012em" }}>{active.name} · 참여자</div>
              <div style={{ fontFamily: "var(--mb-font-text)", fontSize: 12, color: "#6F6F6F", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                {active.online && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#59CE90", boxShadow: "0 0 0 3px rgba(89,206,144,0.2)" }} />}
                {active.online ? "지금 활동 중" : "마지막 접속 어제"}
              </div>
            </div>
            <button className="mb-btn mb-btn--soft" style={{ height: 36, padding: "0 14px", fontSize: 12, borderRadius: 9999 }}>리포트 보기</button>
            <button style={{ width: 36, height: 36, borderRadius: 18, background: "#F2F3F8", border: 0, cursor: "pointer", color: "#6F6F6F", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <StrokeIcon d={ICONS.more} size={16} />
            </button>
          </div>

          {/* Thread body */}
          <div style={{ overflow: "auto", padding: "16px 22px" }}>
            <div style={{ textAlign: "center", fontFamily: "var(--mb-font-mono)", fontSize: 10, color: "#A2A3AD", letterSpacing: "0.08em", margin: "8px 0 16px" }}>5월 21일 · 목요일</div>
            <Bubble side="them" time="14:02">선생님, 오늘 세션 전에 잠깐 통화 가능하실까요?</Bubble>
            <Bubble side="me"   time="14:04">네 가능해요. 14:30에 전화드릴게요 🙂</Bubble>
            <FileCard />
            <Bubble side="them" time="14:08">2주차 리포트 같이 살펴보면 좋을 것 같아서요. 미리 보내드려요.</Bubble>
            <Bubble side="me"   time="14:09">확인했어요. 14:30에 전화 드리면서 자세히 이야기 나눠봐요.</Bubble>
          </div>

          {/* Composer */}
          <div style={{ padding: "14px 22px", background: "#FFFFFF", borderTop: "1px solid #EFEFEF", display: "flex", alignItems: "center", gap: 8 }}>
            <button style={{ width: 40, height: 40, borderRadius: 20, border: 0, background: "transparent", color: "#6F6F6F", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <StrokeIcon d={ICONS.attach} size={20} />
            </button>
            <input placeholder="메시지를 입력하세요…" style={{
              flex: 1, height: 44, borderRadius: 9999, background: "#F2F3F8", border: 0, padding: "0 18px",
              fontFamily: "var(--mb-font-sans)", fontSize: 14, color: "#1F1F1F", outline: "none",
            }} />
            <button style={{ width: 44, height: 44, borderRadius: "50%", background: "#5F0080", color: "#FFFFFF", border: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <StrokeIcon d={ICONS.send} size={18} color="#FFFFFF" />
            </button>
          </div>
        </div>

        {/* Participant info column */}
        <div style={{ borderLeft: "1px solid #EFEFEF", padding: "20px 18px", overflow: "auto", background: "#FFFFFF" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", paddingBottom: 18, borderBottom: "1px solid #F5F5F8" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: active.gradient, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 22 }}>{active.initial}</div>
            <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 16, color: "#1F1F1F", marginTop: 12 }}>{active.name}</div>
            <div style={{ fontFamily: "var(--mb-font-text)", fontSize: 12, color: "#6F6F6F", marginTop: 2 }}>정기 8주 · 4 / 8회차</div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6F6F6F", marginBottom: 10 }}>최근 측정</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 50 }}>
              {[0.30, 0.48, 0.42, 0.65, 0.58, 0.78, 0.92].map((v, i) => {
                const tier = i < 2 ? "#E8D8F8" : i < 4 ? "#D7BCEC" : i < 6 ? "#A775D6" : "#5F0080";
                return <div key={i} style={{ flex: 1, height: `${v * 100}%`, background: tier, borderRadius: "4px 4px 2px 2px" }} />;
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10 }}>
              <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 22, color: "#1F1F1F", letterSpacing: "-0.02em" }}>72</span>
              <span style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 12, color: "#1F8A5B" }}>↓18% vs 시작</span>
            </div>
            <div style={{ fontFamily: "var(--mb-font-text)", fontSize: 11, color: "#6F6F6F", marginTop: 2 }}>휴식도 · 최근 7회</div>
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6F6F6F", marginBottom: 10 }}>다음 세션</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, background: "#F8F4FC" }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "#F5EDFC", color: "#5F0080", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 9, fontWeight: 600 }}>목</div>
                <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 800, fontSize: 16, lineHeight: "16px" }}>21</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--mb-font-sans)", fontWeight: 700, fontSize: 13, color: "#1F1F1F" }}>아침 마음챙김 · 정기반</div>
                <div style={{ fontFamily: "var(--mb-font-mono)", fontSize: 11, color: "#6F6F6F", marginTop: 2 }}>09:30 · 오프라인</div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="mb-btn mb-btn--soft" style={{ width: "100%", height: 40, fontSize: 13, borderRadius: 12 }}>참여자 페이지 열기</button>
            <button className="mb-btn mb-btn--ghost" style={{ width: "100%", height: 40, fontSize: 13, borderRadius: 12 }}>대화 보관</button>
          </div>
        </div>

      </div>
    </AppShell>
  );
}

window.Messages = Messages;
