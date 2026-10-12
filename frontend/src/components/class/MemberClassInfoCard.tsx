// SDD-125: 회원 클래스 뷰 좌측 상단 — 클래스 정보 카드(상담사·참여자·밴드 착용·그룹 집중도).
// 데이터 공백은 null → "—" 폴백(크래시 없음).

interface MemberClassInfoCardProps {
  counselorName: string | null;
  participantCount: number | null;
  wearerCount: number | null;
  groupFocus: number | null;
}

function fmt(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : String(Math.round(v));
}

export function MemberClassInfoCard({
  counselorName,
  participantCount,
  wearerCount,
  groupFocus,
}: MemberClassInfoCardProps) {
  return (
    <section className="glass-card class-info-card" aria-label="클래스 정보">
      <div className="class-info-head">
        <span className="class-info-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
          </svg>
        </span>
        <div>
          <div className="class-info-name">{counselorName ?? '상담사'}</div>
          <div className="class-info-role">호스트</div>
        </div>
      </div>
      <div className="class-info-stats">
        <div className="class-info-stat">
          <b>{fmt(participantCount)}명</b>
          <span>참여자</span>
        </div>
        <div className="class-info-stat">
          <b>{fmt(wearerCount)}명</b>
          <span>밴드 착용</span>
        </div>
        <div className="class-info-stat">
          <b>{fmt(groupFocus)}%</b>
          <span>그룹 집중도</span>
        </div>
      </div>
    </section>
  );
}
