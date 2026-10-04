// SDD-125: 회원 클래스 뷰 좌측 — 개인 프로필 카드(이름·성별/나이·밴드 연결 상태).
// 상담사 상세 슬라이드뷰(hcp-sheet) 헤더 스타일 차용. 게스트는 이름만.

interface MemberProfileCardProps {
  name: string | null;
  gender?: string | null;
  birthDate?: string | null;
  bandConnected: boolean;
}

function ageFrom(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  const beforeBirthday =
    now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

const GENDER_LABEL: Record<string, string> = {
  male: '남',
  female: '여',
  other: '기타',
};

export function MemberProfileCard({
  name,
  gender,
  birthDate,
  bandConnected,
}: MemberProfileCardProps) {
  const age = ageFrom(birthDate);
  const demoParts: string[] = [];
  if (gender) demoParts.push(GENDER_LABEL[gender] ?? gender);
  if (age !== null) demoParts.push(`${age}세`);
  const demo = demoParts.join(' · ');

  return (
    <section className="glass-card member-profile-card" aria-label="내 프로필">
      <span className="member-profile-avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
        </svg>
      </span>
      <div>
        <div className="member-profile-name">{name ?? '게스트'}</div>
        {demo && <div className="member-profile-demo">{demo}</div>}
      </div>
      <span className={`member-profile-band${bandConnected ? '' : ' is-off'}`}>
        <span
          className="member-device-dot"
          aria-hidden="true"
          style={bandConnected ? undefined : { background: 'var(--player-muted)', boxShadow: 'none' }}
        />
        {bandConnected ? '밴드 연결됨' : '밴드 미연결'}
      </span>
    </section>
  );
}
