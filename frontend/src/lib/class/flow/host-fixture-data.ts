// SDD-209 H — 하니스 픽스처 고정 입력(시안 host-a/host-b 의 데모 값). 서버·시계에 의존하지 않는다.
import { createInitialDraft, type WizardDraft } from '../class-wizard';

/** 시안과 같은 고정 기준일(2026-10-17 토) */
export const FIXTURE_BASE = new Date(2026, 9, 17, 12, 0, 0);

export const FIXTURE_MEMBERS = [
  { id: 'm1', name: '김서연', email: 'seoyeon@example.com' },
  { id: 'm2', name: '이민준', email: 'minjun@example.com' },
  { id: 'm3', name: '박지우', email: 'jiwoo@example.com' },
  { id: 'm4', name: '최하준', email: 'hajun@example.com' },
  { id: 'm5', name: '정서아', email: 'seoa@example.com' },
  { id: 'm6', name: '강도윤', email: 'doyun@example.com' },
  { id: 'm7', name: '윤예린', email: 'yerin@example.com' },
  { id: 'm8', name: '임시우', email: 'siwoo@example.com' },
  { id: 'm9', name: '한지민', email: 'jimin@example.com' },
  { id: 'm10', name: '오태윤', email: 'taeyun@example.com' },
  { id: 'm11', name: '서은채', email: 'eunchae@example.com' },
  { id: 'm12', name: '문가온', email: 'gaon@example.com' },
] as const;

export function fixtureDraft(patch: Partial<WizardDraft> = {}): WizardDraft {
  return {
    ...createInitialDraft(),
    address: '서울 강남구 테헤란로 152 7층',
    timeMin: 915,
    remind: 'hour',
    title: '마음챙김 명상 4회차',
    members: FIXTURE_MEMBERS.slice(0, 3).map((m) => ({ ...m })),
    ...patch,
  };
}
