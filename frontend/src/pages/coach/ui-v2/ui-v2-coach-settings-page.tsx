// SDD-320 후속 — 코치 설정 홈(D안). 기존 settings-content.tsx 의 항목을 하나도 빼지 않고 내담자 D안 설정과 같은 인셋 그룹 리스트로 재배치한다.
// 그룹 본문(계정·알림·차단·동의·계정 삭제 등)은 기존 컴포넌트를 그대로 쓰므로 검증·저장 로직은 바뀌지 않는다.
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ban, Bell, Bluetooth, ChevronRight, Database, Info, ShieldCheck, UserRound } from 'lucide-react';
import AppShell from '../../../components/layout/AppShell';
import { useAuthStore } from '../../../stores/authStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { PrivacyPolicyLink } from '../../../components/legal/PrivacyPolicyLink';
import AccountSettings from '../../../components/settings/account-settings';
import NotificationGroups from '../../../components/settings/notification-groups';
import WebPushCard from '../../../components/settings/WebPushCard';
import { PrivacyConsentsSection } from '../../../components/settings/privacy-consents';
import { AccountDeletionSection } from '../../../components/settings/account-deletion';
import { BlockedUsersList } from '../../../components/chat/blocked-users-list';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-brand.css';
import '../../../styles/ui-v2-coach-screens.css';

function Group({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
  return (
    <details data-settings-group className="u2-setgroup">
      <summary>
        <span className="u2-seticon" aria-hidden="true">{icon}</span>
        <span className="u2-body"><strong>{title}</strong><small>{description}</small></span>
        <ChevronRight className="u2-setchev" size={20} aria-hidden="true" />
      </summary>
      <div className="u2-setbody u2-legacy">{children}</div>
    </details>
  );
}
const linkClass = 'u2-setlink';

export function UiV2CoachSettingsPage() {
  const logout = useAuthStore((s) => s.logout);
  const connected = useNotificationStore((s) => s.wsConnected);
  const navigate = useNavigate();
  const [error, setError] = useState('');
  async function handleLogout() {
    try { await logout(); navigate('/login'); }
    catch { setError('로그아웃에 실패했어요. 다시 시도해 주세요.'); }
  }
  return (
    <AppShell title="설정">
      <div className="ui-v2 u2c u2c-settings">
        <p className="u2c-lead">나에게 맞게, 필요한 만큼만.</p>
        <section className="u2-card u2-hero u2-playground" aria-labelledby="u2c-pg-title">
          <p className="u2-eyebrow">LINK BAND PLAYGROUND</p>
          <h2 id="u2c-pg-title">내 마음의 신호를 만나보세요</h2>
          <p>밴드를 연결하거나 예시 데이터로 가볍게 체험할 수 있어요.</p>
          <Link to="/playground" state={{ from: '/settings' }} className="u2-primary">플레이그라운드 열기 <span aria-hidden="true">↗</span></Link>
        </section>
        <div className="u2-setlist">
          <Group title="내 계정" description="기본 정보 · 프로필 관리" icon={<UserRound size={22} />}><AccountSettings /></Group>
          <Group title="데이터 현황" description="회차별 데이터 도착 현황" icon={<Database size={22} />}>
            <Link className={linkClass} to="/upload-status" data-upload-status-link>전체 회차 데이터 현황 보기 <span aria-hidden="true">↗</span></Link>
            <p className="u2-footnote">서버에 도착한 데이터를 숫자로 보여 줘요. 밴드 미착용은 문제로 보지 않아요.</p>
          </Group>
          <Group title="알림" description="일정·참여, 대화, 리포트·운영" icon={<Bell size={22} />}><NotificationGroups /><WebPushCard /></Group>
          <Group title="차단한 사용자" description="채팅 차단 해제 · 신고 철회" icon={<Ban size={22} />}><BlockedUsersList /></Group>
          <Group title="기기 · LINK BAND" description="연결 방법과 측정 안내" icon={<Bluetooth size={22} />}>
            <Link className={linkClass} to="/measurement-guide">밴드 연결 · 측정 방법 <span aria-hidden="true">↗</span></Link>
            <Link className={linkClass} to="/playground">플레이그라운드 다시 열기 <span aria-hidden="true">↗</span></Link>
            <p className="u2-footnote">밴드를 착용하지 않아도 클래스와 리포트를 이용할 수 있어요.</p>
          </Group>
          <Group title="개인정보 · 약관" description="동의 관리 · 연구 동의 철회 · 계정 삭제" icon={<ShieldCheck size={22} />}><PrivacyConsentsSection /><PrivacyPolicyLink className={linkClass}>개인정보 처리방침</PrivacyPolicyLink><AccountDeletionSection /></Group>
          <Group title="앱 정보" description="버전 · 도움말 · 연결 상태" icon={<Info size={22} />}>
            <p className="u2-setstrong">MIND BREEZE 2.0 · Looxid Labs</p>
            <p>서버연결: {connected ? '양호' : '끊김'}</p>
            <Link className={linkClass} to="/measurement-guide">이용 도움말 · LINK BAND 안내 <span aria-hidden="true">↗</span></Link>
          </Group>
        </div>
        <p className="u2-footnote">수업 운영과 리포트 승인은 <Link className="u2-textlink" to="/reports?settings=operations">리포트 · 운영 설정 ↗</Link>에서 관리해요.</p>
        {error && <p role="alert" className="u2-error u2-gap">{error}</p>}
        <div className="u2-setfoot">
          <button type="button" onClick={() => void handleLogout()} className="u2-danger">로그아웃</button>
          <small>MIND BREEZE 2.0</small>
        </div>
      </div>
    </AppShell>
  );
}
