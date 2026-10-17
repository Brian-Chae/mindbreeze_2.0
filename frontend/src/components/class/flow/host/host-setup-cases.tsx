// SDD-209 H4 — 하니스 픽스처: FH05 세팅 10케이스(시안 host-b.html fh05)
import type { FlowCaseEntry } from '../../../../lib/class/flow/types';
import type { MediaDeviceUi } from '../../../../lib/class/class-media';
import { SetupFixture } from './SetupFixture';

interface Spec {
  mic: MediaDeviceUi;
  cam: MediaDeviceUi;
  level?: number;
  steps?: number;
  quiet?: boolean;
  warn?: boolean;
}

function setupCase(description: string, spec: Spec): FlowCaseEntry {
  return {
    description,
    render: (ctx) => (
      <SetupFixture
        place="online"
        warnOpen={spec.warn}
        backdropSrc={ctx.backdropSrc}
        media={{ mic: spec.mic, cam: spec.cam, level: spec.level ?? 0, steps: spec.steps ?? 0, quiet: spec.quiet ?? false }}
      />
    ),
  };
}

export const hostSetupCases: Record<string, FlowCaseEntry> = {
  'FH05:ok': setupCase('온라인 정상 — 마이크 버튼 링이 레벨 표시(5단계 중 4단계, 칩 정상)', { mic: 'on', cam: 'on', level: 0.8, steps: 4 }),
  'FH05:quiet': setupCase('조용해요 — 링 1단계, 칩 조용해요', { mic: 'on', cam: 'on', level: 0.2, steps: 1, quiet: true }),
  'FH05:cam-off': setupCase('카메라 꺼짐 — 마이크 레벨만 있는 낮은 상태', { mic: 'on', cam: 'off', level: 0.7, steps: 4 }),
  'FH05:mic-off': setupCase('마이크 꺼짐 (열기 전 상태)', { mic: 'off', cam: 'on' }),
  'FH05:mic-off-warn': setupCase('마이크 꺼짐 경고 시트 (열기 누른 직후)', { mic: 'off', cam: 'on', warn: true }),
  'FH05:mic-denied': setupCase('마이크 권한 거부', { mic: 'denied', cam: 'on' }),
  'FH05:cam-denied': setupCase('카메라 권한 거부', { mic: 'on', cam: 'denied', level: 0.8, steps: 4 }),
  'FH05:nodevice': setupCase('장치 없음', { mic: 'nodevice', cam: 'nodevice' }),
  'FH05:unsupported': setupCase('미지원 브라우저', { mic: 'unsupported', cam: 'unsupported' }),
  'FH05:offline': {
    description: '오프라인 — 장비 생략, 주소·안내',
    render: (ctx) => <SetupFixture place="offline" backdropSrc={ctx.backdropSrc} media={{ mic: 'off', cam: 'off', level: 0, steps: 0, quiet: false }} />,
  },
};
