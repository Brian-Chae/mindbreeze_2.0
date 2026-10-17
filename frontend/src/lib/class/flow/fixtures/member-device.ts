// SDD-209 M5 — FM06d 기기 점검 케이스 픽스처(온라인만).
import { createElement } from 'react';
import { DeviceStepView } from '../../../../components/class/flow/member/DeviceStepView';
import type { MediaDeviceUi } from '../../class-media';
import { buildSteps } from '../member-machine';
import { remainingPrepLabels } from '../member-prep';
import type { FlowCaseContext, FlowCaseEntry } from '../types';
import { prepCaseOf } from './member-common';

const noop = (): void => undefined;

const REFS = [
  'on-group-opt-member-mic', 'on-group-opt-member-camon', 'on-group-opt-member-micdenied', 'on-group-opt-member-micnodev',
  'on-group-opt-member-camdenied', 'on-group-opt-member-unsupported', 'on-group-opt-member-micdenied-sheet',
  'on-group-opt-member-camon-micdenied', 'on-solo-req-member-camon-spk', 'on-solo-none-member-mic', 'on-group-opt-member-camon-quiet',
  'on-group-opt-member-camon-started', 'on-group-opt-member-mic-started',
];

interface DeviceState {
  mic: MediaDeviceUi;
  cam: MediaDeviceUi;
}

function stateOf(key: string): DeviceState {
  if (key.includes('-unsupported')) return { mic: 'unsupported', cam: 'unsupported' };
  const mic: MediaDeviceUi = key.includes('micdenied') ? 'denied' : key.includes('micnodev') ? 'nodevice' : 'on';
  const cam: MediaDeviceUi = key.includes('camdenied') ? 'denied' : key.includes('-camon') ? 'on' : 'off';
  return { mic, cam };
}

export const flowCases: Record<string, FlowCaseEntry> = {};

for (const key of REFS) {
  const c = prepCaseOf(`FM06d:${key}`);
  const { mic, cam } = stateOf(key);
  const quiet = key.includes('quiet');
  flowCases[`FM06d:${key}`] = {
    description: `${c.size === 'group' ? '그룹' : '1:1'}·밴드 ${c.bandMode} · 마이크 ${mic} · 카메라 ${cam}${quiet ? ' · 조용해요' : ''}${c.started ? ' · 시작 후 시트' : ''}`,
    render: (ctx: FlowCaseContext) => {
      const steps = buildSteps('online', c.bandMode);
      return createElement(DeviceStepView, {
        mic, cam, level: quiet ? 0.1 : 0.55, ringSteps: quiet ? 1 : 3, quiet, solo: c.size === 'solo', speakerPlaying: key.includes('-spk'),
        steps: { total: steps.length, current: steps.indexOf('d') },
        helpDevice: key.endsWith('-sheet') ? '마이크' : null,
        startedRemaining: c.started ? remainingPrepLabels(steps, 'd') : null,
        backdropSrc: ctx.backdropSrc,
        onToggleMic: noop, onToggleCamera: noop, onRecheck: noop, onPlayTone: noop, onOpenHelp: noop, onCloseHelp: noop, onCopyLink: noop,
        onNext: noop, onBack: noop, onExit: noop,
      });
    },
  };
}
