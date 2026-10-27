// 우하단 플로팅 '기관 가입 문의' 버튼 — 모달·문의 섹션·기기 이미지와 겹칠 때 숨김 (SDD-248)
import { useEffect, useRef, useState } from 'react';
import { useInquiryModal } from './use-inquiry-modal';

const PAD = 16;

interface FloatingInquiryButtonProps {
  modalOpen: boolean;
}

export function FloatingInquiryButton({ modalOpen }: FloatingInquiryButtonProps) {
  const { open } = useInquiryModal();
  const ref = useRef<HTMLButtonElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (modalOpen) { setHidden(true); return; }
    let frame = 0;
    const update = () => {
      frame = 0;
      const contact = document.getElementById('contact');
      if (contact) {
        const r = contact.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) { setHidden(true); return; }
      }
      const btn = ref.current;
      // 숨김 상태에서도 위치를 알 수 있도록 고정 좌표로 계산한다 (우하단 28px, 버튼 크기 추정 가능)
      const f = btn && btn.offsetWidth > 0
        ? btn.getBoundingClientRect()
        : { left: window.innerWidth - 28 - 160, right: window.innerWidth - 28, top: window.innerHeight - 28 - 54, bottom: window.innerHeight - 28 };
      const overlap = [...document.querySelectorAll('.lv6 .device, .lv6 .laptop')].some((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.left < f.right + PAD && b.right > f.left - PAD && b.top < f.bottom + PAD && b.bottom > f.top - PAD;
      });
      setHidden(overlap);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => { window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); if (frame) window.cancelAnimationFrame(frame); };
  }, [modalOpen]);

  return <button ref={ref} type="button" className="float-cta" hidden={hidden} onClick={() => open('floating')}>기관 가입 문의</button>;
}

export default FloatingInquiryButton;
