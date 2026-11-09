// 11/9 — 회원 홈(새 디자인) 전용 '담당 코치' 카드. 운영 공용 CounselorSection 은 건드리지 않는다.
// 11/9 시안: 안쪽 카드 없이 한 줄(이니셜·이름·소속·대화하기), '+ 코치 추가'는 헤더. 0명이면 안내 + 코치 코드 입력.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CounselorAddSheet } from '../client/counselor-add-sheet';
import { useClientCounselors } from '../../hooks/use-client-counselors';
import { COUNSELOR_COPY } from '../../lib/client-counselor-copy';
import { useAuthStore } from '../../stores/authStore';
import '../../styles/ui-v2-member-coaches.css';

type Counselor = { id: string; name: string; profile_image: string | null; org_name?: string | null };

export function UiV2MemberCoaches() {
  const navigate = useNavigate();
  const counselors: Counselor[] = useAuthStore((s) => s.user?.counselors) ?? [];
  const { addCounselor } = useClientCounselors();
  const [addOpen, setAddOpen] = useState(false);
  return (
    <section className="mh-counselors u2-mcoach" aria-label={COUNSELOR_COPY.listTitle} data-testid="home-counselors">
      <div className="u2-mcoach__head">
        <div>
          <h2>{COUNSELOR_COPY.listTitle}</h2>
          <p>{counselors.length > 0 ? `함께하는 코치 ${counselors.length}명` : '코치 코드로 담당 코치를 연결해 보세요.'}</p>
        </div>
        <button type="button" className="u2-mcoach__add" onClick={() => setAddOpen(true)}>+ {COUNSELOR_COPY.addButton}</button>
      </div>
      {counselors.length > 0 ? (
        <ul className="u2-mcoach__list">
          {counselors.map((c) => (
            <li key={c.id} className="u2-mcoach__item">
              {c.profile_image
                ? <img className="u2-mcoach__avatar" src={c.profile_image} alt="" />
                : <span className="u2-mcoach__avatar" aria-hidden="true">{c.name?.charAt(0) ?? '코'}</span>}
              <div className="u2-mcoach__text">
                <strong>{c.name}</strong>
                <small>{c.org_name || '개인 코치'}</small>
              </div>
              <button type="button" className="u2-mcoach__chat" onClick={() => navigate('/app/chat')} aria-label={`${c.name} 코치와 대화하기`}>대화하기</button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="u2-mcoach__empty">
          <p>{COUNSELOR_COPY.emptyList}</p>
          <button type="button" className="u2-mcoach__chat" onClick={() => setAddOpen(true)}>코치 코드 입력</button>
        </div>
      )}
      <CounselorAddSheet open={addOpen} onOpenChange={setAddOpen} addCounselor={addCounselor} />
    </section>
  );
}
