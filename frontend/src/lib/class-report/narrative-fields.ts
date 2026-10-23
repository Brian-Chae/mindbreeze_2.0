import type { NarrativeField, NarrativeFieldKey } from './types';
import { formatEditedAt } from './format';
export function sourceLabel(field: Pick<NarrativeField, 'source' | 'edited_by_name' | 'edited_at'>): string {
  return field.source === 'ai' ? 'AI 요약' : field.source === 'edited' ? ['상담사 수정', field.edited_by_name, formatEditedAt(field.edited_at)].filter(Boolean).join(' · ') : '';
}
export function narrativeMaxLength(key: NarrativeFieldKey): number {
  return key === 'headline' ? 200 : key === 'flow' || key.endsWith('_subtitle') ? 150 : 100;
}
export const AI_SUMMARY_NOTICE = 'AI 요약 기능을 사용하는 경우 이름·연락처가 없는 수업 통계(지표 요약)를 외부 AI(Google Gemini)로 전송해 문장으로 정리합니다.';
