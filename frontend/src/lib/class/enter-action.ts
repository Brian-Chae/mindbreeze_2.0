// SDD-209 SH1 — 회원 입장 CTA 판정(홈 히어로·상세 푸터 공용). 입장은 초대된 회원의 `POST /sessions/{id}/enter` 로 이어진다(useEnterClass).
import type { LinkbandMode, LocationType, ParticipantMode } from '../api/session';
import type { ClassChipKey } from './class-labels';

export type EnterActionKind = 'enter' | 'view' | 'report' | 'list' | 'disabled';

export interface EnterAction {
  kind: EnterActionKind;
  label: string;
  disabled: boolean;
  /** 버튼 위 보조 안내 한 줄 */
  note: string;
  /** 윤곽선 버튼으로 그린다(보조 동작) */
  line: boolean;
}

/** 상세(FM03) 하단 CTA */
export function deriveDetailAction(chip: ClassChipKey): EnterAction {
  switch (chip) {
    case 'open':
    case 'live':
      return { kind: 'enter', label: '입장하기', disabled: false, note: '준비는 2분이면 끝나요', line: false };
    case 'soon':
      return { kind: 'enter', label: '입장 대기하기', disabled: false, note: '미리 입장해서 기다릴 수 있어요', line: false };
    case 'done':
      return { kind: 'report', label: '리포트 보기', disabled: false, note: 'AI 기록으로 만든 리포트예요', line: false };
    case 'cancelled':
      return { kind: 'list', label: '클래스 목록 보기', disabled: false, note: '이 클래스에는 입장할 수 없어요', line: true };
    default:
      return { kind: 'disabled', label: '입장하기', disabled: true, note: '클래스가 열리면 알려드려요', line: false };
  }
}

/** 홈 히어로(FM01) CTA */
export function deriveHeroAction(chip: ClassChipKey): EnterAction {
  switch (chip) {
    case 'open':
    case 'live':
      return { kind: 'enter', label: '입장하기', disabled: false, note: '', line: false };
    case 'soon':
      return { kind: 'enter', label: '입장 대기하기', disabled: false, note: '', line: false };
    default:
      return { kind: 'view', label: '클래스 보기', disabled: false, note: '', line: true };
  }
}

export type HeroBoxIcon = 'bell' | 'clock' | 'check' | 'activity' | 'send' | 'calendar-x';

export interface HeroCopy {
  icon: HeroBoxIcon;
  title: string;
  sub: string;
}

export interface HeroCopyInput {
  /** 시작까지 남은 시간(`30분`). 없으면 빈 문자열 */
  startsInLabel: string;
  /** 진행 경과(`12분째`). 없으면 빈 문자열 */
  elapsedLabel: string;
}

/** 홈 히어로 안내 박스 문구(상태별) */
export function deriveHeroCopy(chip: ClassChipKey, input: HeroCopyInput): HeroCopy {
  switch (chip) {
    case 'open':
      return { icon: 'check', title: '지금 입장할 수 있어요', sub: '입장하면 간단한 준비를 먼저 해요' };
    case 'live':
      return { icon: 'activity', title: `${input.elapsedLabel || '지금'} 진행 중이에요`, sub: '지금 들어가도 괜찮아요' };
    case 'soon':
      return { icon: 'clock', title: input.startsInLabel ? `${input.startsInLabel} 뒤에 클래스가 열려요` : '곧 클래스가 열려요', sub: '미리 입장해서 기다릴 수 있어요' };
    default:
      return { icon: 'bell', title: '클래스가 열리면 알려드려요', sub: '열리기 전에 한 번 더 알림을 보내요' };
  }
}

export interface DetailBoxInput extends HeroCopyInput {
  durationMin: number;
}

/** 상세(FM03) 히어로 안내 박스 문구 */
export function deriveDetailBox(chip: ClassChipKey, input: DetailBoxInput): HeroCopy {
  switch (chip) {
    case 'open':
    case 'live':
      return deriveHeroCopy(chip, input);
    case 'soon':
      return { icon: 'clock', title: input.startsInLabel ? `${input.startsInLabel} 뒤에 클래스가 열려요` : '곧 클래스가 열려요', sub: '미리 입장해서 기다릴 수 있어요' };
    case 'done':
      return { icon: 'check', title: `${input.durationMin}분 동안 진행했어요`, sub: '리포트가 준비됐어요' };
    case 'cancelled':
      return { icon: 'calendar-x', title: '진행자가 클래스를 취소했어요', sub: '새 일정이 정해지면 알려드려요' };
    default:
      return {
        icon: 'clock',
        title: input.startsInLabel ? `시작까지 ${input.startsInLabel}` : '시작 시각을 기다리고 있어요',
        sub: '열리면 알림으로 알려드려요',
      };
  }
}

export type PrepIcon = 'moon' | 'headphones' | 'activity' | 'phone' | 'map-pin' | 'clock' | 'file-text' | 'users' | 'calendar-x' | 'bell' | 'calendar';

export interface PrepRow {
  icon: PrepIcon;
  title: string;
  sub: string;
}

export interface PrepInput {
  place: LocationType;
  band: LinkbandMode;
  address: string | null;
  durationMin: number;
  mode?: ParticipantMode;
  /** `오늘 오후 3:00` 등 완료·취소 안내에 쓰는 시각 문구 */
  whenLabel?: string;
  participantCount?: number;
}

/** LINK BAND 줄: 필수 모드도 참가를 막지 않는다(권장 문구). 사용 안 함이면 null */
function bandPrep(band: LinkbandMode): PrepRow | null {
  if (band === 'optional') return { icon: 'activity', title: 'LINK BAND (선택)', sub: '착용하지 않아도 모든 기능을 쓸 수 있어요' };
  if (band === 'required') return { icon: 'activity', title: 'LINK BAND (권장)', sub: 'LINK BAND 사용을 권장해요. 없어도 참가할 수 있어요' };
  return null;
}

/** 상세 하단 카드: 준비물 3줄(열리기 전·진행), 완료·취소는 안내 3줄 */
export function derivePrepRows(chip: ClassChipKey, input: PrepInput): { title: string; rows: PrepRow[] } {
  if (chip === 'done') {
    return {
      title: '이번 클래스',
      rows: [
        { icon: 'clock', title: `${input.durationMin}분 진행`, sub: input.whenLabel ? `${input.whenLabel}에 시작했어요` : '클래스가 끝났어요' },
        { icon: 'users', title: input.participantCount ? `${input.participantCount}명이 함께했어요` : '함께한 클래스예요', sub: input.mode === 'one_on_one' ? '1:1 클래스' : '그룹 클래스' },
        { icon: 'file-text', title: '리포트가 준비됐어요', sub: '리포트 보기에서 확인해요' },
      ],
    };
  }
  if (chip === 'cancelled') {
    return {
      title: '안내',
      rows: [
        { icon: 'calendar-x', title: '진행자가 취소했어요', sub: input.whenLabel ? `${input.whenLabel} 클래스` : '예정된 클래스였어요' },
        { icon: 'bell', title: '새 일정을 알려드려요', sub: '일정이 정해지면 알림을 보내요' },
        { icon: 'calendar', title: '다른 클래스 보기', sub: '클래스 목록에서 확인해요' },
      ],
    };
  }
  const band = bandPrep(input.band);
  const rows: PrepRow[] = input.place === 'online'
    ? [
        { icon: 'moon', title: '조용한 곳', sub: '방해받지 않는 곳에서 입장해요' },
        { icon: 'headphones', title: '이어폰', sub: '안내 음성이 또렷하게 들려요' },
        band ?? { icon: 'phone', title: '휴대폰 무음', sub: '진행 중 알림이 울리지 않게 해요' },
      ]
    : [
        { icon: 'map-pin', title: '장소', sub: input.address || '코치에게 장소를 확인해 주세요' },
        { icon: 'phone', title: '휴대폰 무음', sub: '진행 중 알림이 울리지 않게 해요' },
        band ?? { icon: 'clock', title: '10분 전 도착', sub: '시작 전에 자리를 잡아요' },
      ];
  return { title: '준비하면 좋아요', rows };
}
