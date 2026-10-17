// SDD-208 — 하니스·측정 스크립트 자가 검증용 더미 픽스처. 실제 케이스(M01~M21, C01~C18)가 아니다.
// `_skew` 로 끝나는 ID 는 균형 규칙을 일부러 어긴 화면이라 측정 스크립트가 FAIL 로 판정해야 한다.
import { createElement as h, type CSSProperties, type ReactNode } from 'react';
import { Activity, Bluetooth, Hand, LogOut, MessageCircle, User, Volume2, Wifi } from 'lucide-react';
import { IconCircleButton } from '../../../components/class/player/shared/IconCircleButton';
import { NoticeBanner } from '../../../components/class/player/shared/NoticeBanner';
import { PlayerBackdrop } from '../../../components/class/player/shared/PlayerBackdrop';
import { PlayerDock, type DockItem } from '../../../components/class/player/shared/PlayerDock';
import { PlayerSheet } from '../../../components/class/player/shared/PlayerSheet';
import { PlayerShell } from '../../../components/class/player/shared/PlayerShell';
import { PlayerTopBar } from '../../../components/class/player/shared/PlayerTopBar';
import { StatusRing } from '../../../components/class/player/shared/StatusRing';
import { useSheetMode } from '../../../components/class/player/shared/sheet-mode';
import type { PlayerCaseContext, PlayerCaseMap } from '../player-harness';

const icon = (Icon: typeof Activity): ReactNode => h(Icon, { size: 24, strokeWidth: 2 });
const vars = (style: Record<string, string>): CSSProperties => style as CSSProperties;
const noop = (): void => undefined;

const DOCK_ITEMS: DockItem[] = [
  { key: 'status', label: '내 상태', icon: icon(Activity) },
  { key: 'chat', label: '채팅', icon: icon(MessageCircle), badge: 2 },
  { key: 'signal', label: '조용한 신호', icon: icon(Hand) },
  { key: 'sound', label: '소리', icon: icon(Volume2) },
  { key: 'device', label: '기기', icon: icon(Bluetooth) },
];

function selftestSheet(ctx: PlayerCaseContext): ReactNode {
  return h(PlayerSheet, {
    open: ctx.sheet !== null,
    title: ctx.sheet ?? '',
    onClose: noop,
    children: h('p', { style: { fontSize: 15, lineHeight: '22px', color: 'var(--tx-mid)' } }, '자가 검증용 시트 본문이에요.'),
  });
}

/* ───────── 회원 ───────── */

const pillText: CSSProperties = { fontSize: 15, lineHeight: '20px', fontWeight: 600, whiteSpace: 'nowrap' };

function memberTop(): ReactNode {
  return h(PlayerTopBar, {
    variant: 'member',
    left: h(IconCircleButton, { label: '나가기', icon: icon(LogOut), pz: 'leave' }),
    center: h(
      'div',
      {
        style: {
          height: 56, padding: '6px 16px', borderRadius: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'var(--sheet-bg)', border: '1px solid var(--sheet-border)',
        },
      },
      h('h1', { style: pillText }, '자가 검증 클래스'),
      h('p', { style: { fontSize: 13, lineHeight: '17px', color: 'var(--tx-mid)', whiteSpace: 'nowrap' } }, '12:34 / 30:00'),
    ),
    right: h(
      'div',
      {
        'data-pz': 'conn', role: 'status', 'aria-label': '연결됨',
        style: { width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--sheet-bg)', color: 'var(--mb-mint)' },
      },
      icon(Wifi),
    ),
  });
}

function pip(pz: string, label: string): ReactNode {
  const wide = typeof window !== 'undefined' && window.innerWidth >= 768;
  const style: CSSProperties = {
    width: wide ? 200 : 96, height: wide ? 120 : 128, borderRadius: 16, position: 'relative', overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.28)', background: 'linear-gradient(165deg, #3a2858, #1a1030)',
  };
  const chip: CSSProperties = {
    position: 'absolute', left: 8, bottom: 8, padding: '3px 8px', borderRadius: 9999,
    background: 'rgba(18,8,28,0.62)', fontSize: 12, lineHeight: '16px', color: 'var(--tx-hi)',
  };
  const avatar: CSSProperties = { position: 'absolute', left: '50%', top: '46%', transform: 'translate(-50%, -50%)', color: 'rgba(247,244,240,0.7)' };
  return h('div', { 'data-pz': pz, style }, h('span', { style: avatar }, h(User, { size: 40, strokeWidth: 1.6 })), h('span', { style: chip }, label));
}

function MemberSelftest({ ctx, skew }: { ctx: PlayerCaseContext; skew: boolean }): ReactNode {
  const mode = useSheetMode();
  const sheetOpen = ctx.sheet !== null;
  const compact = sheetOpen && mode === 'bottom';

  const stage = h(
    'div',
    { style: { display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto minmax(0, 1fr)', justifyItems: 'center', alignItems: 'center', minHeight: 0 } },
    compact
      ? h('div', { style: { gridRow: 1 } })
      : h('div', { style: { gridRow: 1, alignSelf: 'end', paddingBottom: 16, display: 'flex', justifyContent: 'center', gap: 16 } }, pip('pip', '상담사'), pip('mypip', '나')),
    h(
      'div',
      { style: { gridRow: 2, ...vars({ '--ring': compact ? '144px' : '180px' }), transform: skew ? 'translateX(32px)' : undefined } },
      h(StatusRing, {
        fraction: 0.72, core: 'gauge', label: '이완도', value: 72, unit: '%', ariaLabel: '이완도 72퍼센트',
      }),
    ),
    compact
      ? h('div', { style: { gridRow: 3 } })
      : h(
        'div',
        { style: { gridRow: 3, alignSelf: 'start', paddingTop: 16, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 } },
        h(NoticeBanner, { tone: 'info', icon: icon(Activity), children: '이완도는 최근 5분간 부드럽게 이어졌어요' }),
        h(
          'div',
          {
            'data-pz': 'trend',
            style: {
              width: 'min(100%, 480px)', height: 72, padding: '12px 16px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 16,
              background: 'var(--sheet-bg-strong)', border: '1px solid var(--sheet-border)',
            },
          },
          h('span', { style: { fontSize: 12, lineHeight: '16px', color: 'var(--tx-lo)' } }, '최근 5분 · 이완도'),
          h('b', { style: { fontSize: 18, color: 'var(--mb-mint)' } }, '5분간 +8'),
        ),
      ),
  );

  const mediaButton = (label: string, extra?: CSSProperties): ReactNode =>
    h(
      'button',
      {
        type: 'button', 'data-pz': 'mbtn',
        style: {
          minHeight: 44, padding: '0 8px', borderRadius: 9999, fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap',
          background: 'var(--sheet-bg-strong)', border: '1.5px solid var(--sheet-border)', color: 'var(--tx-hi)', ...extra,
        },
      },
      label,
    );
  const dock = h(
    'div',
    { style: { display: 'contents' } },
    compact
      ? null
      : h(
        'div',
        { 'data-pz': 'media-row', role: 'group', 'aria-label': '마이크·카메라', style: { display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', gap: 8, width: '100%' } },
        mediaButton('마이크 켜짐', skew ? { gridColumn: 'span 2' } : undefined),
        mediaButton('카메라 켜짐'),
        mediaButton('손들기'),
      ),
    h(PlayerDock, { items: DOCK_ITEMS, active: ctx.sheet, onSelect: noop }),
  );

  return h(PlayerShell, {
    place: 'online', sheetOpen, top: memberTop(), dock, sheet: selftestSheet(ctx),
    backdrop: h(PlayerBackdrop, { imageSrc: ctx.backdropSrc }),
    children: stage,
  });
}

/* ───────── 상담사 ───────── */

const tile = (name: string, width: string): ReactNode =>
  h(
    'div',
    {
      'data-pz': 'tile',
      style: {
        width, minHeight: 96, padding: 8, borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        background: 'var(--sheet-bg-strong)', border: '1px solid var(--sheet-border)',
      },
    },
    h(StatusRing, {
      variant: 'mini', fraction: 0.6, colorVar: '--m-relax', ariaLabel: `${name} 이완도 60`,
      children: [h('b', { key: 'v', style: { fontSize: 15 } }, '60'), h('small', { key: 'l', style: { fontSize: 12 } }, '이완')],
    }),
    h('span', { style: { fontSize: 13 } }, name),
  );

function HostSelftest({ ctx, skew }: { ctx: PlayerCaseContext; skew: boolean }): ReactNode {
  const sheetOpen = ctx.sheet !== null;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 600;
  const count = skew ? 7 : 8;
  const names = ['서연', '민준', '지우', '하준', '수아', '도윤', '예린', '시우'].slice(0, count);

  const top = h(PlayerTopBar, {
    variant: 'host',
    left: h(IconCircleButton, { label: '클래스 닫기', icon: icon(LogOut), pz: 'btn-close' }),
    center: h(
      'div',
      { style: { textAlign: 'center' } },
      h('h1', { style: pillText }, '자가 검증 클래스'),
      h('p', { style: { fontSize: 13, lineHeight: '17px', color: 'var(--tx-mid)' } }, '12:34 / 30:00'),
    ),
    right: h(
      'button',
      {
        type: 'button', 'data-pz': 'btn-end',
        style: { minHeight: 44, padding: '0 16px', borderRadius: 9999, fontSize: 13, background: 'rgba(232,180,160,0.16)', border: '1px solid var(--mb-coral)', color: 'var(--tx-hi)' },
      },
      '종료',
    ),
  });

  const chip = (text: string): ReactNode =>
    h('span', { style: { height: 32, padding: '0 12px', borderRadius: 9999, display: 'inline-flex', alignItems: 'center', fontSize: 13, background: 'var(--sheet-bg)', border: '1px solid var(--sheet-border)' } }, text);
  const block = (pz: string, style: CSSProperties, ...children: ReactNode[]): ReactNode => h('div', { 'data-pz': pz, style }, ...children);
  const panelStyle: CSSProperties = { borderRadius: 16, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'var(--sheet-bg-strong)', border: '1px solid var(--sheet-border)' };
  const twoLines = (small: string, big: string): ReactNode =>
    h('div', { style: { display: 'flex', flexDirection: 'column' } }, h('span', { style: { fontSize: 13, lineHeight: '18px', color: 'var(--tx-mid)' } }, small), h('b', { style: { fontSize: 24, lineHeight: '30px' } }, big));
  const strip = block('mstrip', panelStyle, twoLines('지금 보는 지표', '이완도'), twoLines('그룹 평균', '62%'));
  const selfview = block(
    'selfview',
    { ...panelStyle, position: 'relative', overflow: 'hidden', padding: 0 },
    h('video', { muted: true, playsInline: true, 'aria-label': '내 화면', style: { width: '100%', height: '100%', objectFit: 'cover', background: 'linear-gradient(165deg, #25405a, #131c2c)' } }),
  );

  const stage = h(
    'div',
    { style: { justifySelf: 'center', width: 'min(100%, 1040px)', height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, ...vars({ '--pz-notice-w': '100%' }) } },
    h(NoticeBanner, {
      tone: 'info', variant: 'banner', icon: icon(Activity), children: '지금 보는 지표는 이완도예요',
      action: h('button', { type: 'button', style: { minHeight: 44, padding: '0 14px', borderRadius: 9999, fontSize: 13, border: '1px solid var(--sheet-border)', background: 'rgba(255,255,255,0.08)' } }, '확인'),
    }),
    block('head', { display: 'grid', gridTemplateColumns: skew ? '1fr 1fr' : narrow ? '62fr 38fr' : '66fr 34fr', gap: 16, height: 96, flex: 'none' }, strip, selfview),
    block('chipline', { display: 'flex', justifyContent: 'center', gap: 8, flex: 'none' }, chip('손든 회원 2'), chip('녹음 중 05:12'), chip('대기 3')),
    block(
      'gridscroll',
      {
        flex: '1 1 0', minHeight: 0, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: 14,
        justifyContent: skew ? 'flex-start' : 'center',
      },
      ...names.map((name) => tile(name, 'calc((100% - 42px) / 4)')),
    ),
  );

  const dock = h(PlayerDock, { items: DOCK_ITEMS, active: ctx.sheet, onSelect: noop });
  return h(PlayerShell, {
    place: 'online', sheetOpen, top, dock, sheet: selftestSheet(ctx),
    backdrop: h(PlayerBackdrop, { imageSrc: ctx.backdropSrc }),
    children: stage,
  });
}

export const playerCases: PlayerCaseMap = {
  __selftest: { role: 'member', render: (ctx) => h(MemberSelftest, { ctx, skew: false }) },
  __selftest_skew: { role: 'member', render: (ctx) => h(MemberSelftest, { ctx, skew: true }) },
  __selftest_host: { role: 'host', render: (ctx) => h(HostSelftest, { ctx, skew: false }) },
  __selftest_host_skew: { role: 'host', render: (ctx) => h(HostSelftest, { ctx, skew: true }) },
};

