import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Nav from '../components/landing/Nav';
import { Footer } from '../components/landing/CTASection';
import { StatusBadge } from '../components/session/StatusBadge';
import { ApiError } from '../lib/api/client';
import { getOrgPublic, type OrgPublicClass, type OrgPublicResponse } from '../lib/api/orgPublic';
import type { SessionType } from '../lib/api/session';

const TYPE_LABELS: Record<SessionType, string> = {
  clinical: '임상심리상담',
  hypnosis: '최면심리상담',
  meditation: '명상수업',
  custom: '기타',
};

const TYPE_CLASSES: Record<SessionType, string> = {
  clinical: 'bg-[#F5EDFC] text-[#5F0080]',
  hypnosis: 'bg-[#EFE3FA] text-[#6E1A8C]',
  meditation: 'bg-[#E6F8F3] text-[#1F8A5B]',
  custom: 'bg-[#FFF4DC] text-[#8A6B1F]',
};

const ACTIVE_STATUSES = new Set<OrgPublicClass['status']>(['ready', 'scheduled', 'in_progress']);

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AccessCodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 클립보드 실패 시 무시 */
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono font-bold tracking-widest text-[#5F0080]">{code}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="px-2 py-1 rounded-lg bg-[#F5EDFC] text-[#5F0080] text-[11px] font-semibold hover:bg-[#EBDEF7] transition-colors"
      >
        {copied ? '복사됨' : '복사'}
      </button>
    </div>
  );
}

function TypeBadge({ type }: { type: SessionType }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide ${TYPE_CLASSES[type]}`}
    >
      {TYPE_LABELS[type]}
    </span>
  );
}

function ClassCard({ cls }: { cls: OrgPublicClass }) {
  return (
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2 min-w-0">
          <h3 className="text-[16px] font-bold text-[#1F1F1F] truncate">
            {cls.title || '제목 없음'}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={cls.type} />
            <StatusBadge status={cls.status} />
          </div>
        </div>
        <AccessCodeCopyButton code={cls.access_code} />
      </div>
      <div className="flex flex-wrap gap-4 text-[13px] text-[#6F6F6F]">
        <span>시작: {formatDateTime(cls.started_at)}</span>
        <span>
          참여: {cls.participant_count.toLocaleString('ko-KR')} / {cls.max_participants.toLocaleString('ko-KR')}명
        </span>
        <span>{cls.participant_mode === 'group' ? '그룹' : '1:1'}</span>
      </div>
    </div>
  );
}

function CounselorCard({ name, specialties }: { name: string; specialties: string[] }) {
  return (
    <div className="bg-white border border-[#DDDEE7] rounded-2xl p-5">
      <h3 className="text-[16px] font-bold text-[#1F1F1F] mb-3">{name}</h3>
      {specialties.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {specialties.map((specialty) => (
            <span
              key={specialty}
              className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide bg-[#F5EDFC] text-[#5F0080]"
            >
              {specialty}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-[#6F6F6F]">전문분야 정보 없음</p>
      )}
    </div>
  );
}

function NotFoundView() {
  return (
    <div className="min-h-screen bg-[#F5EDFC] flex flex-col">
      <Nav />
      <main className="flex-1 flex items-center justify-center px-8 py-16">
        <div className="max-w-md w-full bg-white border border-[#DDDEE7] rounded-2xl p-10 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#F5EDFC] flex items-center justify-center">
            <span className="text-2xl">🏢</span>
          </div>
          <h1 className="text-xl font-bold text-[#1F1F1F] mb-2">존재하지 않는 기관</h1>
          <p className="text-sm text-[#6F6F6F] mb-6">
            입력하신 기관 코드에 해당하는 기관을 찾을 수 없습니다. 코드를 다시 확인해 주세요.
          </p>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-xl px-6 py-3 font-semibold bg-[#5F0080] text-white hover:bg-[#4D0066] transition-colors"
          >
            홈으로 돌아가기
          </Link>
        </div>
      </main>
    </div>
  );
}

function OrgPublicContent({ data }: { data: OrgPublicResponse }) {
  const activeClasses = data.classes.filter((cls) => ACTIVE_STATUSES.has(cls.status));

  return (
    <div className="min-h-screen bg-[#F5EDFC] flex flex-col">
      <Nav />

      <main className="flex-1 px-8 py-12">
        <div className="max-w-[960px] mx-auto flex flex-col gap-10">
          {/* 상단: 기관 정보 */}
          <section className="bg-white border border-[#DDDEE7] rounded-2xl p-8 md:p-10">
            <p className="text-[12px] font-mono uppercase tracking-wider text-[#6F6F6F] mb-3">
              기관 공개 페이지
            </p>
            <h1 className="text-[36px] md:text-[44px] font-extrabold text-[#1F1F1F] tracking-tight mb-3">
              {data.org_name}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <span className="text-[13px] text-[#6F6F6F]">기관 코드</span>
              <span className="font-mono font-bold tracking-widest text-[#5F0080] text-[18px]">
                {data.org_code}
              </span>
            </div>
            {data.intro ? (
              <p className="text-[16px] leading-relaxed text-[#6F6F6F] whitespace-pre-line">
                {data.intro}
              </p>
            ) : (
              <p className="text-[15px] text-[#6F6F6F]">기관 소개가 아직 등록되지 않았습니다.</p>
            )}
          </section>

          {/* 소속 상담사/명상지도사 */}
          <section>
            <h2 className="text-[22px] font-bold text-[#1F1F1F] mb-4">
              소속 상담사 · 명상지도사
            </h2>
            {data.counselors.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {data.counselors.map((counselor) => (
                  <CounselorCard
                    key={counselor.id}
                    name={counselor.name}
                    specialties={counselor.specialties}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-white border border-[#DDDEE7] rounded-2xl p-6 text-[#6F6F6F] text-[14px]">
                등록된 상담사·명상지도사가 없습니다.
              </div>
            )}
          </section>

          {/* 진행중/예정 클래스 */}
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
              <div>
                <h2 className="text-[22px] font-bold text-[#1F1F1F]">진행중 · 예정 클래스</h2>
                <p className="text-[14px] text-[#6F6F6F] mt-1">
                  클래스 코드를 복사한 뒤 아래 &quot;클래스 코드로 참여&quot;에서 입력하세요.
                </p>
              </div>
            </div>
            {activeClasses.length > 0 ? (
              <div className="flex flex-col gap-4">
                {activeClasses.map((cls) => (
                  <ClassCard key={cls.id} cls={cls} />
                ))}
              </div>
            ) : (
              <div className="bg-white border border-[#DDDEE7] rounded-2xl p-6 text-[#6F6F6F] text-[14px]">
                현재 진행중이거나 예정된 클래스가 없습니다.
              </div>
            )}
          </section>

          {/* 하단 CTA */}
          <section className="bg-white border border-[#DDDEE7] rounded-2xl p-8 text-center">
            <h2 className="text-[20px] font-bold text-[#1F1F1F] mb-2">클래스 코드로 참여</h2>
            <p className="text-[14px] text-[#6F6F6F] mb-6">
              상담사·지도사가 안내한 6자리 클래스 코드를 입력하면 바로 참여할 수 있습니다.
            </p>
            <Link
              to="/join"
              className="inline-flex items-center justify-center rounded-xl px-8 py-3 font-semibold bg-[#5F0080] text-white hover:bg-[#4D0066] transition-colors"
            >
              클래스 코드 입력
            </Link>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}

const OrgPublicPage: React.FC = () => {
  const { org_code: orgCode } = useParams<{ org_code: string }>();
  const [data, setData] = useState<OrgPublicResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!orgCode) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    getOrgPublic(orgCode)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setNotFound(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orgCode]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5EDFC] flex flex-col">
        <Nav />
        <main className="flex-1 flex items-center justify-center px-8 py-16">
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-2 border-[#5F0080] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-[#6F6F6F]">기관 정보를 불러오는 중...</p>
          </div>
        </main>
      </div>
    );
  }

  if (notFound || !data) {
    return <NotFoundView />;
  }

  return <OrgPublicContent data={data} />;
};

export default OrgPublicPage;
