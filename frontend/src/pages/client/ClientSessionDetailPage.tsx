// 내담자 세션 상세 페이지
// 세션 정보, 상태별 액션 버튼, 뒤로가기

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSession, type SessionDto } from '../../lib/api/session';
import { useAuthStore } from '../../stores/authStore';

/** 상태 한글 라벨 */
function statusLabel(status: string): string {
  switch (status) {
    case 'scheduled': return '예정';
    case 'in_progress': return '진행중';
    case 'paused': return '일시정지';
    case 'completed': return '완료';
    case 'cancelled': return '취소';
    default: return status;
  }
}

/** 상태별 뱃지 클래스 */
function statusBadgeClass(status: string): string {
  switch (status) {
    case 'scheduled': return 'bg-[#F5EDFC] text-[#5F0080]';
    case 'in_progress': return 'bg-[#E6F8F3] text-[#1F8A5B]';
    case 'paused': return 'bg-[#FFF4DC] text-[#8A6B1F]';
    case 'completed': return 'bg-[#F2F3F8] text-[#6F6F6F]';
    case 'cancelled': return 'bg-[#FDECEC] text-[#B3261E]';
    default: return 'bg-[#F2F3F8] text-[#6F6F6F]';
  }
}

/** 날짜/시간 포맷 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 세션 유형 라벨 */
function typeLabel(type: string): string {
  switch (type) {
    case 'clinical': return '임상심리상담';
    case 'hypnosis': return '최면심리상담';
    case 'meditation': return '명상수업';
    default: return type;
  }
}

export default function ClientSessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const counselors = user?.counselors ?? [];

  const [session, setSession] = useState<SessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getSession(id)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  // 상담사 이름 찾기
  const counselorName = (() => {
    if (!session) return '상담사';
    const counselor = counselors.find((c) => c.id === session.host_id);
    return counselor?.name ?? '상담사';
  })();

  // 상태별 액션 렌더링
  const renderActions = (): React.ReactNode => {
    if (!session) return null;

    if (session.status === 'scheduled' || session.status === 'in_progress' || session.status === 'paused') {
      return (
        <div className="space-y-2">
          {session.status === 'in_progress' ? (
            <button
              type="button"
              className="w-full rounded-xl bg-[#5F0080] text-white text-sm font-semibold py-3 active:scale-[0.98] transition-transform"
            >
              세션 입장하기
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="w-full rounded-xl bg-[#D4D4D4] text-white text-sm font-semibold py-3 cursor-not-allowed"
            >
              세션 입장하기 (아직 시작되지 않음)
            </button>
          )}
        </div>
      );
    }

    if (session.status === 'completed') {
      return (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => navigate(`/app/reports/${session.id}`)}
            className="w-full rounded-xl bg-[#5F0080] text-white text-sm font-semibold py-3 active:scale-[0.98] transition-transform"
          >
            리포트 보기
          </button>
        </div>
      );
    }

    if (session.status === 'cancelled') {
      return (
        <div className="bg-[#FDECEC] rounded-xl p-4 text-center">
          <p className="text-sm text-[#B3261E] font-medium">취소된 세션입니다</p>
        </div>
      );
    }

    return null;
  };

  // 뒤로가기
  const handleBack = (): void => {
    navigate('/app/sessions');
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#FAFAFA]">
      {/* 상단 헤더 */}
      <header className="sticky top-0 z-40 h-14 bg-white border-b border-[#EFEFEF] flex items-center px-4 gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#EFEFEF] shrink-0 transition-colors"
          aria-label="뒤로가기"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12l4.58-4.59Z"
              fill="#1F1F1F"
            />
          </svg>
        </button>
        <h1 className="text-base font-bold text-[#1F1F1F] truncate">세션 상세</h1>
      </header>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-[#6F6F6F]">
            불러오는 중...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <p className="text-sm text-red-500">{error}</p>
            <button
              type="button"
              onClick={handleBack}
              className="text-sm text-[#5F0080] font-medium underline"
            >
              목록으로 돌아가기
            </button>
          </div>
        ) : session ? (
          <div className="space-y-4">
            {/* 세션 정보 카드 */}
            <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
              {/* 유형 + 상태 */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[#F5EDFC] text-[#5F0080]">
                  {typeLabel(session.type)}
                </span>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusBadgeClass(session.status)}`}>
                  {statusLabel(session.status)}
                </span>
              </div>

              {/* 제목 */}
              <h2 className="text-xl font-bold text-[#1F1F1F]">
                {session.title || '제목 없음'}
              </h2>

              {/* 세션 상세 정보 */}
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs text-[#6F6F6F] mb-0.5">상담사</dt>
                  <dd className="text-sm text-[#1F1F1F] font-medium">{counselorName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#6F6F6F] mb-0.5">날짜/시간</dt>
                  <dd className="text-sm text-[#1F1F1F] font-medium">
                    {formatDateTime(session.scheduled_at)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#6F6F6F] mb-0.5">소요 시간</dt>
                  <dd className="text-sm text-[#1F1F1F] font-medium">{session.duration_min}분</dd>
                </div>
                {session.notes && (
                  <div>
                    <dt className="text-xs text-[#6F6F6F] mb-0.5">메모</dt>
                    <dd className="text-sm text-[#1F1F1F] whitespace-pre-wrap leading-relaxed">
                      {session.notes}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* 액션 버튼 */}
            {renderActions()}
          </div>
        ) : null}
      </div>
    </div>
  );
}
