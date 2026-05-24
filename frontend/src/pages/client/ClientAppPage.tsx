import { useAuthStore } from '../../stores/authStore';

/** 내담자 앱 메인 페이지 (C03에서 ClientShell + BottomTabBar로 확장 예정) */
export default function ClientAppPage() {
  const user = useAuthStore((s) => s.user);
  const hasCounselors = (user?.counselors?.length ?? 0) > 0;

  if (!hasCounselors) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAFAFA] px-6">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-bold text-[#1F1F1F] mb-2">
            상담사와 연결하기
          </h1>
          <p className="text-[#6F6F6F] mb-6">
            상담사에게 받은 6자리 코드를 입력하여 연결을 시작하세요.
          </p>
          <div className="flex gap-3 justify-center mb-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="w-10 h-12 border-2 border-[#D4D4D4] rounded-lg flex items-center justify-center text-lg font-bold text-[#1F1F1F]"
              >
                {' '}
              </div>
            ))}
          </div>
          <p className="text-xs text-[#6F6F6F]">
            상담사 코드는 상담사 프로필에서 확인할 수 있습니다
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAFAFA]">
      <p className="text-[#6F6F6F]">오늘 화면 (C03에서 구현 예정)</p>
    </div>
  );
}
