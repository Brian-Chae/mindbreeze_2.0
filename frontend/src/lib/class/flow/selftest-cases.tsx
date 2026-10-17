// SDD-209 T3 — 측정 스크립트 자가검증용 더미 픽스처. 실제 사전 흐름 화면이 아니며 인덱스·`__flowCases` 에는 노출되지 않는다.
// 정상 화면(규칙을 지킨 구조)만 둔다. 위반은 selftest.mjs 가 DOM 을 직접 바꿔 주입한다(SDD-208 selftest 방식).
// 쿼리: step(0~), total(진행 점 수, 기본 5), sheet=1(시트 열림)
import { Link2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { MyAvCheck } from '../../../components/class/flow/shared/MyAvCheck';
import { ElectrodeLeds } from '../../../components/class/flow/shared/ElectrodeLeds';
import {
  FlowBody, FlowButton, FlowCard, FlowCol, FlowFoot, FlowH1, FlowSheet, FlowSteps, FlowSub,
} from '../../../components/class/flow/shared/flow-primitives';
import { PlayerBackdrop } from '../../../components/class/player/shared/PlayerBackdrop';
import { IconCircleButton } from '../../../components/class/player/shared/IconCircleButton';
import { PlayerShell } from '../../../components/class/player/shared/PlayerShell';
import { PlayerTopBar } from '../../../components/class/player/shared/PlayerTopBar';
import type { FlowCaseContext } from './types';

const noop = (): void => undefined;

function num(ctx: FlowCaseContext, name: string, fallback: number): number {
  const raw = ctx.params.get(name);
  const n = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function frame(ctx: FlowCaseContext, body: ReactNode, foot: ReactNode, sheet: ReactNode = null, sheetOpen = false): ReactNode {
  return (
    <PlayerShell
      place="online"
      flow
      className="fl-root"
      sheetOpen={sheetOpen}
      backdrop={<PlayerBackdrop imageSrc={ctx.backdropSrc} />}
      top={
        <PlayerTopBar
          variant="flow"
          slotWidth={96}
          left={<IconCircleButton label="뒤로" icon={<Link2 size={24} />} onClick={noop} />}
          center="자가검증"
        />
      }
      dock={foot}
      sheet={sheet}
    >
      <FlowBody>{body}</FlowBody>
    </PlayerShell>
  );
}

/** 단계마다 본문 길이가 달라도 하단 주 버튼은 같은 자리에 있어야 한다(FR1) */
function wizard(ctx: FlowCaseContext): ReactNode {
  const step = num(ctx, 'step', 0);
  const total = num(ctx, 'total', 5);
  const sheetOpen = ctx.params.get('sheet') === '1';
  const rows = [1, 3, 5, 2, 4][step % 5] ?? 1;
  return frame(
    ctx,
    <FlowCol>
      <FlowSteps total={total} current={Math.min(step, total - 1)} />
      <FlowH1>단계 {step + 1}</FlowH1>
      <FlowSub>자가검증용 안내 문장이에요.</FlowSub>
      {Array.from({ length: rows }, (_, i) => (
        <FlowCard key={i}>카드 {i + 1}</FlowCard>
      ))}
    </FlowCol>,
    <FlowFoot>
      <FlowButton kind="primary">다음</FlowButton>
      <FlowButton kind="ghost">건너뛰기</FlowButton>
    </FlowFoot>,
    <FlowSheet open={sheetOpen} title="확인해요" onClose={noop} footer={<FlowButton kind="primary">알겠어요</FlowButton>}>
      <p className="fl-sub">시트 안 내용은 스크롤 없이 한 번에 보여요.</p>
    </FlowSheet>,
    sheetOpen,
  );
}

function av(ctx: FlowCaseContext, cam: 'on' | 'off'): ReactNode {
  return frame(
    ctx,
    <FlowCol>
      <MyAvCheck
        mic="on" cam={cam} level={0.5} steps={3} quiet={false} solo={false} speakerPlaying={false}
        onToggleMic={noop} onToggleCamera={noop} onRecheck={noop} onPlayTone={noop} onOpenHelp={noop}
      />
    </FlowCol>,
    <FlowFoot><FlowButton kind="primary">다음</FlowButton></FlowFoot>,
  );
}

function electrodes(ctx: FlowCaseContext, bad: boolean): ReactNode {
  return frame(
    ctx,
    <FlowCol>
      <FlowCard>{bad ? <ElectrodeLeds leadOff={{ ch1: true, ch2: false }} /> : <FlowSub>접촉이 좋아요.</FlowSub>}</FlowCard>
    </FlowCol>,
    <FlowFoot><FlowButton kind="primary">다음</FlowButton></FlowFoot>,
  );
}

/** 키: `__selftest:이름` — 하니스는 이 맵을 레지스트리 뒤에 합쳐 직접 URL 로만 연다 */
export const SELFTEST_CASES: Record<string, { description: string; render: (ctx: FlowCaseContext) => ReactNode }> = {
  '__selftest:wizard': { description: '마법사 골격(진행 점·하단 주 버튼)', render: wizard },
  '__selftest:av-video': { description: '내 영상·소리 — 카메라 켜짐', render: (ctx) => av(ctx, 'on') },
  '__selftest:av-bar': { description: '내 영상·소리 — 카메라 꺼짐(가로 막대)', render: (ctx) => av(ctx, 'off') },
  '__selftest:electrodes-bad': { description: '전극 트래커 노출', render: (ctx) => electrodes(ctx, true) },
  '__selftest:electrodes-good': { description: '전극 트래커 미노출', render: (ctx) => electrodes(ctx, false) },
};
