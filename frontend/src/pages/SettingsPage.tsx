// 설정 페이지

import { useEffect, useState, useCallback } from 'react';
import AppShell from '../components/layout/AppShell';
import { getPreferences, updatePreferences, type NotificationPreferencesResponse } from '../lib/api/notifications';
import {
  getCounselorProfile,
  updateCounselorProfile,
  type CounselorProfile,
  type CounselorProfileUpdate,
} from '../lib/api/counselor';
import AccountSection from '../components/settings/AccountSection';
import ProfileSection from '../components/settings/ProfileSection';
import { useAuthStore } from '../stores/authStore';

const EVENT_LABELS: Record<string, string> = {
  session_booked: '세션 예약',
  session_updated: '세션 변경',
  session_cancelled: '세션 취소',
  chat_message: '채팅 메시지',
  report_ready: '리포트 발행',
  verification_result: '검증 결과',
};

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-10 h-6 rounded-full transition-colors ${
        enabled ? 'bg-[#5F0080]' : 'bg-[#DDDEE7]'
      }`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          enabled ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const [prefs, setPrefs] = useState<NotificationPreferencesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isCounselor = user?.role === 'counselor';
  const [profile, setProfile] = useState<CounselorProfile | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    getPreferences()
      .then((p) => setPrefs(p))
      .catch((e) => setError(e instanceof Error ? e.message : '설정 조회 실패'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isCounselor) return;
    getCounselorProfile()
      .then((p) => setProfile(p))
      .catch((e) => setError(e instanceof Error ? e.message : '프로필 조회 실패'));
  }, [isCounselor]);

  const handleProfileSave = useCallback(
    async (data: CounselorProfileUpdate): Promise<void> => {
      setError(null);
      try {
        const updated = await updateCounselorProfile(data);
        setProfile(updated);
        setProfileSaved(true);
        setTimeout(() => setProfileSaved(false), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : '프로필 저장 실패');
        throw e;
      }
    },
    [],
  );

  const handleToggle = useCallback(
    async (channel: 'email' | 'in_app', event: string) => {
      if (!prefs) return;
      setSaved(false);
      const updated = {
        ...prefs,
        [channel]: { ...prefs[channel], [event]: !prefs[channel][event] },
      };
      setPrefs(updated);
      try {
        await updatePreferences(updated);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch {
        setError('설정 저장 실패');
      }
    },
    [prefs],
  );

  return (
    <AppShell title="설정" sub="SETTINGS">
      <div className="max-w-2xl mx-auto space-y-6">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        {/* 프로필 카드 */}
        <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
          <h3 className="text-[15px] font-bold text-[#1F1F1F] mb-4 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
            계정 정보
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[14px]">
            <div>
              <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1">이름</div>
              <div className="font-medium text-[#1F1F1F]">{user?.name ?? '-'}</div>
            </div>
            <div>
              <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1">이메일</div>
              <div className="font-medium text-[#1F1F1F]">{user?.email ?? '-'}</div>
            </div>
            <div>
              <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1">역할</div>
              <div>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#F5EDFC] text-[#5F0080]">
                  {user?.role === 'counselor' ? '상담사' : user?.role === 'client' ? '내담자' : user?.role === 'org_admin' ? '센터관리자' : user?.role === 'platform_admin' ? '플랫폼관리자' : user?.role ?? '-'}
                </span>
              </div>
            </div>
            {user?.role === 'counselor' && user?.counselor_code && (
              <div className="col-span-full">
                <div className="text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1">초대 코드</div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold tracking-[0.3em] text-[#5F0080] font-mono">
                    {user.counselor_code}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const text = user.counselor_code ?? '';
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(text);
                      } else {
                        const ta = document.createElement('textarea');
                        ta.value = text;
                        ta.style.position = 'fixed';
                        ta.style.opacity = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                      }
                    }}
                    className="text-[12px] text-[#5F0080] hover:text-[#3F0055] font-medium px-3 py-1.5 rounded-full bg-[#F5EDFC] hover:bg-[#E8D5F8] transition-colors"
                  >
                    복사
                  </button>
                </div>
                <p className="text-[12px] text-[#9B9B9B] mt-1">
                  내담자에게 이 코드를 공유하면 상담사-내담자 관계가 연결됩니다.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 상담사 프로필 섹션 */}
        {isCounselor && profile && (
          <>
            {profileSaved && (
              <div className="text-[12px] text-[#10B981] font-medium text-right">✓ 프로필 저장됨</div>
            )}
            <AccountSection profile={profile} onSave={handleProfileSave} />
            <ProfileSection profile={profile} onSave={handleProfileSave} />
          </>
        )}

        {/* 알림 설정 */}
        {loading ? (
          <div className="text-[#6F6F6F] text-sm">설정 불러오는 중...</div>
        ) : prefs ? (
          <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-bold text-[#1F1F1F] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
                알림 설정
              </h3>
              {saved && (
                <span className="text-[12px] text-[#10B981] font-medium">✓ 저장됨</span>
              )}
            </div>

            {(['email', 'in_app'] as const).map((channel) => (
              <div key={channel} className="mb-5 last:mb-0">
                <div className="text-[12px] font-bold text-[#6F6F6F] font-mono uppercase tracking-wider mb-2">
                  {channel === 'email' ? '📧 이메일 알림' : '📱 인앱 알림'}
                </div>
                <div className="space-y-1">
                  {Object.entries(prefs[channel]).map(([event, enabled]) => (
                    <label
                      key={event}
                      className="flex items-center justify-between py-2.5 px-3 hover:bg-[#F8FAFC] rounded-xl cursor-pointer transition-colors"
                    >
                      <span className="text-[14px] text-[#1F1F1F]">
                        {EVENT_LABELS[event] ?? event}
                      </span>
                      <Toggle enabled={enabled} onChange={() => handleToggle(channel, event)} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* 푸터 */}
        <div className="text-center text-[12px] text-[#9B9B9B] py-4">
          MIND BREEZE 2.0 · Looxid Labs
        </div>
      </div>
    </AppShell>
  );
}
