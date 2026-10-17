// SDD-209 M4 — FM06c LINK BAND 단계 케이스 픽스처.
import { createElement } from 'react';
import { BandStepView } from '../../../../components/class/flow/member/BandStepView';
import type { BandStepUi } from '../../band-step';
import { buildSteps } from '../member-machine';
import { remainingPrepLabels } from '../member-prep';
import type { FlowCaseContext, FlowCaseEntry } from '../types';
import { prepCaseOf } from './member-common';

const noop = (): void => undefined;

const REFS = [
  'on-group-opt-member-idle', 'on-group-opt-member-connecting', 'on-group-opt-member-connected', 'on-group-opt-member-leadoffl',
  'on-group-opt-member-leadoffr', 'on-group-opt-member-leadoff', 'on-group-opt-member-unsupported', 'on-group-req-member-idle',
  'on-group-req-member-leadoffl', 'on-group-req-member-leadoff', 'on-group-req-member-unsupported', 'on-group-req-member-connected',
  'off-solo-opt-member-idle', 'off-group-req-member-connected', 'on-group-opt-member-idle-started',
];

const LEAD_OFF = {
  leadoffl: { ch1: true, ch2: false },
  leadoffr: { ch1: false, ch2: true },
  leadoff: { ch1: true, ch2: true },
} as const;

export const flowCases: Record<string, FlowCaseEntry> = {};

for (const key of REFS) {
  const c = prepCaseOf(`FM06c:${key}`);
  const state = (['connecting', 'connected', 'leadoffl', 'leadoffr', 'leadoff', 'unsupported'] as const).find((s) => key.includes(`-${s}`) && !(s === 'leadoff' && /leadoff[lr]/.test(key))) ?? 'idle';
  const stateUi: BandStepUi = state;
  flowCases[`FM06c:${key}`] = {
    description: `${c.place === 'online' ? '온라인' : '오프라인'}·${c.size === 'group' ? '그룹' : '1:1'}·${c.bandMode === 'req' ? '권장' : '선택'} · ${stateUi}${c.started ? ' · 시작 후 시트' : ''}`,
    render: (ctx: FlowCaseContext) => {
      const steps = buildSteps(c.place, c.bandMode);
      return createElement(BandStepView, {
        state: stateUi,
        bandMode: c.bandMode === 'req' ? 'req' : 'opt',
        leadOff: stateUi in LEAD_OFF ? LEAD_OFF[stateUi as keyof typeof LEAD_OFF] : null,
        battery: 82,
        steps: { total: steps.length, current: steps.indexOf('c') },
        place: c.place,
        backdropSrc: ctx.backdropSrc,
        startedRemaining: c.started ? remainingPrepLabels(steps, 'c') : null,
        onConnect: noop, onDisconnect: noop, onNext: noop, onSkip: noop, onBack: noop, onExit: noop,
      });
    },
  };
}
