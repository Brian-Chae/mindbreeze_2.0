// 기관 가입 문의 모달 열림 상태 — 랜딩 CTA 5곳이 같은 모달을 연다 (SDD-248)
import { createContext, useContext } from 'react';

export type InquiryCtaSource = 'hero' | 'roles' | 'mid' | 'contact' | 'floating';

export interface InquiryModalApi {
  open: (source: InquiryCtaSource) => void;
}

export const InquiryModalContext = createContext<InquiryModalApi>({ open: () => undefined });

export const useInquiryModal = (): InquiryModalApi => useContext(InquiryModalContext);
