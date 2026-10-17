// SDD-209 M8 — FM09 종료·리포트 케이스 픽스처(리포트/체크인 시트, 제외, 비회원 자동 발송 안내).
import { createElement } from 'react';
import { EndView, type EndReportMode, type EndSheet } from '../../../../components/class/flow/member/EndView';
import { emptySurveyDraft, type SurveyDraft } from '../member-survey';
import type { FlowCaseContext, FlowCaseEntry } from '../types';
import { DEMO, prepCaseOf } from './member-common';

const noop = (): void => undefined;

const REFS = [
  'on-group-member', 'off-solo-member', 'on-group-member-checked', 'on-group-member-report', 'on-group-member-reportsent',
  'on-group-member-checkin', 'on-group-member-checkinempty', 'on-group-member-excluded', 'on-group-member-guest-report',
];

/** 시안 시연 선택값: 집중 4 · 편안함 3 · 감정 4 */
const SELECTED: SurveyDraft = { answers: { arousal: 4, valence: 3, emotion: 4 }, note: '' };

export const flowCases: Record<string, FlowCaseEntry> = {};

for (const key of REFS) {
  const c = prepCaseOf(`FM09:${key}`);
  const reportMode: EndReportMode = key.endsWith('excluded') ? 'excluded' : key.endsWith('guest-report') ? 'guest' : 'member';
  const sheet: EndSheet = key.endsWith('-report') ? 'report' : key.endsWith('reportsent') ? 'reportsent' : key.includes('checkin') ? 'checkin' : 'none';
  flowCases[`FM09:${key}`] = {
    description: `${c.place === 'online' ? '온라인' : '오프라인'}·${c.size === 'group' ? '그룹' : '1:1'} · ${reportMode}${sheet === 'none' ? '' : ` · ${sheet} 시트`}${key.endsWith('checked') ? ' · 체크인 완료' : ''}`,
    render: (ctx: FlowCaseContext) =>
      createElement(EndView, {
        place: c.place, title: c.title, duration: '30분', reportMode, maskedEmail: DEMO.maskedEmail,
        checkinDone: key.endsWith('checked'), sheet,
        checkinDraft: key.endsWith('checkinempty') || sheet !== 'checkin' ? emptySurveyDraft() : SELECTED,
        working: false, errorText: null, backdropSrc: ctx.backdropSrc,
        onOpenReport: noop, onOpenCheckin: noop, onCloseSheet: noop, onRequestReport: noop, onSelectAxis: noop, onNote: noop, onSubmitCheckin: noop, onHome: noop,
      }),
  };
}
