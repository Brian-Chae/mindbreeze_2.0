import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CounselorAddSheet } from './counselor-add-sheet';
import { useClientCounselors } from '../../hooks/use-client-counselors';
import { COUNSELOR_COPY } from '../../lib/client-counselor-copy';
import { useAuthStore } from '../../stores/authStore';

type Counselor = { id: string; name: string; profile_image: string | null; org_name?: string | null };

/** 회원 홈 '담당 상담사' 영역 — 0명이어도 영역과 추가 버튼을 유지한다 (SDD-256). */
export function CounselorSection({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  const counselors: Counselor[] = useAuthStore((s) => s.user?.counselors) ?? [];
  const { addCounselor } = useClientCounselors();
  const [addOpen, setAddOpen] = useState(false);
  const linkCls = 'inline-flex min-h-11 min-w-11 items-center justify-end gap-1 text-[13px] font-bold text-[#5F0080] hover:underline shrink-0';
  return (
    <section className={`mh-counselors ${className}`} aria-label={COUNSELOR_COPY.listTitle} data-testid="home-counselors">
      <div className="mc-row">
        <h2 className="mc-heading">{COUNSELOR_COPY.listTitle}</h2>
        <div className="flex items-center gap-3">
          {counselors.length > 0 && <button type="button" onClick={() => navigate('/app/chat')} className={linkCls}>대화하기</button>}
          <button type="button" onClick={() => setAddOpen(true)} className={linkCls}>+ {COUNSELOR_COPY.addButton}</button>
        </div>
      </div>
      {counselors.length > 0 ? (
        <ul className="space-y-3">
          {counselors.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => navigate('/app/chat')} className="flex min-h-11 w-full items-center gap-3 text-left">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5F0080] to-[#8A4FB8] text-[13px] font-bold text-white">{c.name?.charAt(0) ?? '상'}</div>
                <div className="min-w-0">
                  <div className="break-words text-[16px] font-semibold text-[#1F1F1F]">{c.name}</div>
                  <div className="break-words text-[15px] text-[#6F6F6F]">{c.org_name || '임상·최면심리상담 전문'}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[15px] text-[#6F6F6F]">{COUNSELOR_COPY.emptyList}</p>
      )}
      <CounselorAddSheet open={addOpen} onOpenChange={setAddOpen} addCounselor={addCounselor} />
    </section>
  );
}
