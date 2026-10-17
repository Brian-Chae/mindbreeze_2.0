// SDD-209 M7 — FM08 대기열 케이스 픽스처(+ 대기 취소 확인 시트).
import { createElement } from 'react';
import { WaitlistView } from '../../../../components/class/flow/member/WaitlistView';
import type { FlowCaseContext, FlowCaseEntry } from '../types';
import { DEMO, prepCaseOf } from './member-common';

const noop = (): void => undefined;

const REFS = ['on-group-member', 'on-solo-member', 'off-group-member', 'on-group-member-cancel-sheet'];

export const flowCases: Record<string, FlowCaseEntry> = {};

for (const key of REFS) {
  const c = prepCaseOf(`FM08:${key}`);
  const sheet = key.endsWith('cancel-sheet');
  flowCases[`FM08:${key}`] = {
    description: `${c.place === 'online' ? '온라인' : '오프라인'}·${c.size === 'group' ? '그룹' : '1:1'}${sheet ? ' · 대기 취소 확인 시트' : ''}`,
    render: (ctx: FlowCaseContext) =>
      createElement(WaitlistView, {
        place: c.place, title: c.title, hostName: DEMO.host, whenLabel: DEMO.time, placeName: DEMO.placeShort,
        cancelOpen: sheet, cancelling: false, cancelError: null, backdropSrc: ctx.backdropSrc,
        onAskCancel: noop, onKeepWaiting: noop, onConfirmCancel: noop,
      }),
  };
}
