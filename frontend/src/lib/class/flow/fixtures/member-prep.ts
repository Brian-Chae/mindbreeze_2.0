// SDD-209 M2 — FM06a(고지·리포트 반영 선택·연구 동의) · FM06e(준비 완료 요약) 케이스 픽스처.
import { createElement } from 'react';
import { NoticeStepView } from '../../../../components/class/flow/member/NoticeStepView';
import { ReadySummaryView } from '../../../../components/class/flow/member/ReadySummaryView';
import { buildSteps } from '../member-machine';
import { buildSummaryRows, emptyPrepDraft, type PrepDraft } from '../member-prep';
import type { FlowCaseContext, FlowCaseEntry } from '../types';
import { DEMO, prepCaseOf } from './member-common';

const noop = (): void => undefined;

const NOTICE_STATES: Record<string, string> = {
  '': '기본 · 리포트 반영하지 않아요 선택됨',
  empty: '아직 고르지 않음 · 계속하기 가능',
  included: '반영해요 선택',
  'research-agree': '연구 동의 체크',
  'research-fail': '연구 동의 저장 실패 · 미동의로 진행',
};

const NOTICE_REFS = [
  'on-group-opt-member', 'on-group-req-member', 'on-solo-none-member', 'off-group-none-member', 'off-solo-opt-member',
  'on-group-opt-member-empty', 'on-group-opt-member-included', 'on-group-opt-member-research-agree', 'on-group-opt-member-research-fail',
];

const READY_REFS = [
  'on-group-opt-member', 'on-group-req-member', 'on-solo-none-member-skip', 'off-group-none-member', 'off-solo-opt-member-noband',
  'on-group-opt-member-nomic',
];

export const flowCases: Record<string, FlowCaseEntry> = {};

for (const key of NOTICE_REFS) {
  const c = prepCaseOf(`FM06a:${key}`);
  flowCases[`FM06a:${key}`] = {
    description: `${c.place === 'online' ? '온라인' : '오프라인'}·${c.size === 'group' ? '그룹' : '1:1'}·밴드 ${c.bandMode} · ${NOTICE_STATES[c.state] ?? c.state}`,
    render: (ctx: FlowCaseContext) => {
      const steps = buildSteps(c.place, c.bandMode);
      return createElement(NoticeStepView, {
        place: c.place, size: c.size, bandMode: c.bandMode, title: c.title, hostName: DEMO.host, retentionDays: DEMO.retentionDays,
        reportChoice: c.state === 'empty' ? null : c.state === 'included' ? 'included' : 'excluded',
        researchConsent: c.state === 'research-agree', researchSaveFailed: c.state === 'research-fail',
        steps: { total: steps.length, current: steps.indexOf('a') }, backdropSrc: ctx.backdropSrc,
        onReportChoice: noop, onResearchChange: noop, onNext: noop, onBack: noop, onExit: noop,
      });
    },
  };
}

for (const key of READY_REFS) {
  const c = prepCaseOf(`FM06e:${key}`);
  flowCases[`FM06e:${key}`] = {
    description: `${c.place === 'online' ? '온라인' : '오프라인'}·${c.size === 'group' ? '그룹' : '1:1'}·밴드 ${c.bandMode}${c.state ? ` · ${c.state}` : ''}`,
    render: (ctx: FlowCaseContext) => {
      const steps = buildSteps(c.place, c.bandMode);
      // 시안 시연값: 권장(req)·온라인·그룹은 `반영해요`/`동의했어요` 문구를 함께 보여 준다
      const showIncluded = c.bandMode === 'req' && c.size === 'group' && c.place === 'online';
      const draft: PrepDraft = {
        ...emptyPrepDraft(),
        reportChoice: showIncluded ? 'included' : 'excluded',
        researchConsent: showIncluded,
        survey: c.state === 'skip' ? 'skipped' : 'done',
        bandOutcome: c.state === 'noband' || c.bandMode === 'req' ? 'skipped' : 'connected',
        mic: c.state === 'nomic' ? 'off' : 'on',
        camOn: false,
      };
      return createElement(ReadySummaryView, {
        displayName: DEMO.name, place: c.place, rows: buildSummaryRows({ place: c.place, bandMode: c.bandMode, draft }),
        steps: { total: steps.length, current: steps.indexOf('e') }, backdropSrc: ctx.backdropSrc,
        onGoto: noop, onReady: noop, onBack: noop, onExit: noop,
      });
    },
  };
}
