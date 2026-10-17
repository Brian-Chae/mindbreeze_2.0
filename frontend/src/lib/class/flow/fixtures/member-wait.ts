// SDD-209 M6 — FM07 시작 대기 케이스 픽스처.
import { createElement } from 'react';
import { WaitStartView } from '../../../../components/class/flow/member/WaitStartView';
import type { FlowCaseContext, FlowCaseEntry } from '../types';
import { DEMO, prepCaseOf } from './member-common';

const noop = (): void => undefined;

const REFS = [
  'on-group-opt-member', 'on-group-opt-member-bgmoff', 'on-solo-none-member', 'off-group-none-member', 'off-solo-opt-member', 'on-group-req-member',
];

export const flowCases: Record<string, FlowCaseEntry> = {};

for (const key of REFS) {
  const c = prepCaseOf(`FM07:${key}`);
  const bgmOff = key.includes('bgmoff');
  const online = c.place === 'online';
  flowCases[`FM07:${key}`] = {
    description: `${online ? '온라인' : '오프라인'}·${c.size === 'group' ? '그룹' : '1:1'}·밴드 ${c.bandMode}${bgmOff ? ' · BGM 꺼짐' : ''}`,
    render: (ctx: FlowCaseContext) =>
      createElement(WaitStartView, {
        place: c.place, size: c.size, bandMode: c.bandMode, title: c.title, hostName: DEMO.host, whenLabel: DEMO.time,
        startsIn: '약 5분 뒤에 시작해요',
        // 시안 시연값: 그룹은 `6명 중 4명`. 실제 화면은 presence 가 전달될 때만 이 값을 쓴다
        readyCount: c.size === 'group' ? { ready: 4, total: 6 } : null,
        address: online ? null : DEMO.place,
        bgm: online ? { title: '심신이완 앰비언트', playing: !bgmOff, volume: bgmOff ? 0 : 0.6, blocked: false } : null,
        backdropSrc: ctx.backdropSrc,
        onRecheck: noop, onExit: noop, onBgmToggle: noop, onBgmVolume: noop,
      }),
  };
}
