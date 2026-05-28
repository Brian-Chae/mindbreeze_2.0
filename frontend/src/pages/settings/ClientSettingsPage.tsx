// 내담자 설정 페이지 — 계정정보 + 프로필정보 + 알림 + 로그아웃

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import {
  getClientProfile,
  updateClientProfile,
  type ClientProfile,
  type ClientProfileUpdate,
} from '../../lib/api/client-profile';
import ClientAccountSection from '../../components/settings/ClientAccountSection';
import ClientProfileSection from '../../components/settings/ClientProfileSection';

export default function ClientSettingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const setUser = useAuthStore((s) => s.setUser);

  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getClientProfile()
      .then((p) => {
        setProfile(p);
        // authStore에도 이름 동기화
        if (user && p.name !== user.name) {
          setUser({ ...user, name: p.name });
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : '프로필 조회 실패'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = useCallback(
    async (data: ClientProfileUpdate): Promise<void> => {
      setError(null);
      try {
        const updated = await updateClientProfile(data);
        setProfile(updated);
        // authStore 이름 동기화
        if (user && updated.name !== user.name) {
          setUser({ ...user, name: updated.name });
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (e) {
        setError(e instanceof Error ? e.message : '프로필 저장 실패');
        throw e;
      }
    },
    [user, setUser],
  );

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="px-4 py-8 text-center text-[#6F6F6F] text-sm">
        설정 불러오는 중...
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-4 md:py-6 pb-20">
      <div className="max-w-2xl mx-auto space-y-6">
        {error && (
          <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
        )}
        {saved && (
          <div className="text-[12px] text-[#10B981] font-medium text-right">✓ 프로필 저장됨</div>
        )}

        {/* 계정 정보 (읽기 전용 요약) */}
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
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#E0F2FE] text-[#075985]">
                  내담자
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 수정 가능 섹션 */}
        {profile && (
          <>
            <ClientAccountSection profile={profile} onSave={handleSave} />
            <ClientProfileSection profile={profile} onSave={handleSave} />
          </>
        )}

        {/* 로그아웃 */}
        <div className="pt-4">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-3 text-center text-sm font-medium text-red-500 bg-white rounded-2xl border border-[#EFEFEF] hover:bg-red-50 transition-colors"
          >
            로그아웃
          </button>
        </div>

        {/* 푸터 */}
        <div className="text-center text-[12px] text-[#9B9B9B] py-4">
          MIND BREEZE 2.0 · Looxid Labs
        </div>
      </div>
    </div>
  );
}
