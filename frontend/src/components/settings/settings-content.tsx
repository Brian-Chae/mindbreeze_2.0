import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Bluetooth, ChevronRight, Info, ShieldCheck, UserRound } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { PrivacyPolicyLink } from '../legal/PrivacyPolicyLink';
import AccountSettings from './account-settings';
import NotificationGroups from './notification-groups';
import WebPushCard from './WebPushCard';
import { PrivacyConsentsSection } from './privacy-consents';
import { AccountDeletionSection } from './account-deletion';

function Group({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
  return <details data-settings-group className="group border-b border-[#E9E2EB] last:border-b-0">
    <summary className="flex min-h-[76px] cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
      <span className="shrink-0 text-[#5B1A8A]">{icon}</span><span className="min-w-0 flex-1"><strong className="block text-[15px]">{title}</strong><span className="mt-0.5 block text-[13px] text-[#776D7B]">{description}</span></span><ChevronRight className="h-5 w-5 text-[#A69AAC] transition-transform group-open:rotate-90" />
    </summary><div className="space-y-4 px-4 pb-5">{children}</div>
  </details>;
}
const linkClass = 'flex min-h-12 items-center justify-between gap-3 border-b border-[#F0EBF2] py-3 text-[15px] text-[#5B1A8A] last:border-b-0';

export default function SettingsContent() {
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const connected = useNotificationStore(s => s.wsConnected);
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const counselorLike = user?.role === 'counselor' || user?.role === 'org_admin';
  async function handleLogout() {
    try { await logout(); navigate(user?.role === 'client' ? '/login?role=client' : '/login'); }
    catch { setError('로그아웃에 실패했어요. 다시 시도해 주세요.'); }
  }
  return <div className="mx-auto max-w-2xl space-y-6 text-[#2C2133]">
    <p className="text-[14px] text-[#776D7B]">나에게 맞게, 필요한 만큼만.</p>
    <section className="relative overflow-hidden rounded-[20px] bg-[#5B1A8A] p-6 text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full border-[24px] border-white/5" />
      <p className="text-[13px] font-bold tracking-wider text-[#E5C8FA]">LINK BAND PLAYGROUND</p>
      <h2 style={{ color: '#FFFFFF' }} className="mb-2 mt-2 text-[22px] font-bold tracking-tight">내 마음의 신호를 만나보세요</h2>
      <p className="mb-5 text-[14px] leading-relaxed text-[#ECDFF5]">밴드를 연결하거나 예시 데이터로<br />가볍게 체험할 수 있어요.</p>
      <Link to="/playground" state={{ from: user?.role === 'client' ? '/app/profile' : '/settings' }} className="relative flex min-h-12 items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-[15px] font-bold text-[#5B1A8A]">플레이그라운드 열기 <span aria-hidden="true">↗</span></Link>
    </section>
    <div className="overflow-hidden rounded-[18px] border border-[#E9E2EB] bg-white">
      <Group title="내 계정" description={user?.role === 'platform_admin' ? '계정 정보 확인' : '기본 정보 · 프로필 관리'} icon={<UserRound size={24} />}><AccountSettings /></Group>
      <Group title="알림" description="일정·참여, 대화, 리포트·운영" icon={<Bell size={24} />}><NotificationGroups /><WebPushCard /></Group>
      <Group title="기기 · LINK BAND" description="연결 방법과 측정 안내" icon={<Bluetooth size={24} />}><Link className={linkClass} to="/measurement-guide">밴드 연결 · 측정 방법 <span aria-hidden="true">↗</span></Link><Link className={linkClass} to="/playground">플레이그라운드 다시 열기 <span aria-hidden="true">↗</span></Link><p className="text-[13px] text-[#776D7B]">밴드를 착용하지 않아도 클래스와 리포트를 이용할 수 있어요.</p></Group>
      <Group title="개인정보 · 약관" description="동의 관리 · 연구 동의 철회 · 계정 삭제" icon={<ShieldCheck size={24} />}><PrivacyConsentsSection /><PrivacyPolicyLink className={linkClass}>개인정보 처리방침</PrivacyPolicyLink><p className="text-[13px] text-[#776D7B]">AI 요약을 사용하면 이름·연락처 없는 수업 통계를 외부 AI(Google Gemini)로 전송해 문장으로 정리해요.</p><AccountDeletionSection /></Group>
      <Group title="앱 정보" description="버전 · 도움말 · 연결 상태" icon={<Info size={24} />}><p className="text-[15px] font-semibold">MIND BREEZE 2.0 · Looxid Labs</p><p className="text-[14px]">서버연결: {connected ? '양호' : '끊김'}</p><Link className={linkClass} to="/measurement-guide">이용 도움말 · LINK BAND 안내 <span aria-hidden="true">↗</span></Link></Group>
    </div>
    {counselorLike && <p className="text-[13px] leading-relaxed text-[#776D7B]">수업 운영과 리포트 승인은 <Link className="inline-flex min-h-11 items-center text-[#5B1A8A] underline underline-offset-4" to="/reports?settings=operations">리포트 · 운영 설정 ↗</Link>에서 관리해요.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={() => void handleLogout()} className="min-h-11 py-2 text-[14px] text-[#776D7B] underline underline-offset-4">로그아웃</button><span className="text-[13px] text-[#776D7B]">MIND BREEZE 2.0</span></div>
  </div>;
}
