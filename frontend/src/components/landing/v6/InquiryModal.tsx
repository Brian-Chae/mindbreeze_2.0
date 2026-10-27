// 기관 가입 문의 중앙 모달 (SDD-248, 랜딩 v6) — OrgInquiryForm 재사용, 실제 POST 전송
import { useEffect, useRef, useState } from 'react';
import { OrgInquiryForm } from '../OrgInquiryForm';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface InquiryModalProps {
  onClose: () => void;
}

export function InquiryModal({ onClose }: InquiryModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const doneTitleRef = useRef<HTMLHeadingElement>(null);
  const lastFocusRef = useRef<Element | null>(null);
  const [done, setDone] = useState(false);

  // 열릴 때 포커스 이동·body 스크롤 잠금, 닫힐 때 원래 위치로 복귀
  useEffect(() => {
    lastFocusRef.current = document.activeElement;
    document.body.classList.add('lv6-modal-open');
    const timer = window.setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('#oi-org-name');
      (first ?? dialogRef.current)?.focus();
    }, 30);
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove('lv6-modal-open');
      if (lastFocusRef.current instanceof HTMLElement) lastFocusRef.current.focus();
    };
  }, []);

  useEffect(() => { if (done) doneTitleRef.current?.focus(); }, [done]);

  // ESC 닫기 + Tab 포커스 트랩
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" data-testid="inquiry-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="lv6-modal-title" tabIndex={-1}>
        <div className="modal-head">
          <h2 id="lv6-modal-title">기관 가입 문의</h2>
          <button type="button" className="modal-x" aria-label="닫기" onClick={onClose}>×</button>
        </div>
        {done ? (
          <div className="done">
            <div className="tick" aria-hidden="true">✓</div>
            <h3 ref={doneTitleRef} tabIndex={-1}>기관 가입 문의가 접수되었습니다.</h3>
            <p>남겨주신 내용을 확인한 뒤 입력하신 연락처로 안내드리겠습니다. 문의해 주셔서 감사합니다.</p>
            <button type="button" className="btn btn-cta" onClick={onClose}>닫고 서비스 둘러보기</button>
          </div>
        ) : (
          <div className="px-5 pb-0 pt-6 sm:px-9">
            <p className="req-note">* 표시된 항목은 필수입니다.</p>
            <OrgInquiryForm stickyFooter onSuccess={() => setDone(true)} />
          </div>
        )}
      </div>
    </div>
  );
}

export default InquiryModal;
