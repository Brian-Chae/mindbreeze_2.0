// SDD-209 H8 — FH10 닫힘·오류 문구와 오류 분기. 서버 오류 메시지 원문은 화면에 절대 쓰지 않는다(404/403/네트워크 분기).
import { ApiError } from '../../api/client';

export type HostStateKind = 'closed' | 'closed-0' | 'closed-revisit' | 'error' | 'error-notfound' | 'error-forbidden' | 'error-network';
export type HostStateIcon = 'door-closed' | 'alert' | 'lock' | 'wifi-off';
export type HostRowIcon = 'clock' | 'copy' | 'list' | 'refresh' | 'link' | 'user' | 'wifi-off';
export type HostStateAction = 'clone' | 'retry' | 'list' | 'home';

export interface HostStateRow {
  icon: HostRowIcon;
  title: string;
  sub: string;
}

export interface HostStateCopy {
  top: string;
  icon: HostStateIcon;
  warn: boolean;
  heading: string;
  lead: string;
  rows: HostStateRow[];
  primary: { label: string; action: HostStateAction };
  secondary: { label: string; action: HostStateAction };
}

const NEW_CLASS_ROW: HostStateRow = { icon: 'copy', title: '다시 열 수는 없어요', sub: '같은 설정으로 새 클래스를 만들 수 있어요' };
const LIST_ROW: HostStateRow = { icon: 'list', title: '목록에서 찾아도 돼요', sub: '내 클래스는 목록에 모여 있어요' };
const CLONE = { label: '같은 설정으로 새 클래스', action: 'clone' } as const;
const TO_LIST = { label: '클래스 목록으로', action: 'list' } as const;
const RETRY = { label: '다시 시도', action: 'retry' } as const;

/** closedAtText: 방금 닫은 경우에만 클라이언트가 가진 시각(재진입엔 서버에 저장된 값이 없다 — F25/AD4) */
export function hostStateCopy(kind: HostStateKind, opts: { waiting?: number; closedAtText?: string | null } = {}): HostStateCopy {
  const closedAt: HostStateRow[] = opts.closedAtText ? [{ icon: 'clock', title: '닫은 시각', sub: opts.closedAtText }] : [];
  const waiting = opts.waiting ?? 0;
  switch (kind) {
    case 'closed':
    case 'closed-0': {
      const none = kind === 'closed-0' || waiting <= 0;
      return {
        top: '클래스 닫힘', icon: 'door-closed', warn: false, heading: '클래스를 닫았어요',
        lead: none ? '대기 중이던 회원은 없었어요.' : `대기 중이던 회원 ${waiting}명에게 클래스가 닫혔다고 안내했어요.`,
        rows: [...closedAt, NEW_CLASS_ROW], primary: CLONE, secondary: TO_LIST,
      };
    }
    case 'closed-revisit':
      return {
        top: '클래스 닫힘', icon: 'door-closed', warn: false, heading: '이미 닫힌 클래스예요',
        lead: '이 클래스는 닫혀서 다시 열 수 없어요.',
        rows: [NEW_CLASS_ROW, { icon: 'list', title: '목록에서 찾아도 돼요', sub: '내 클래스는 목록에 모여 있어요' }],
        primary: CLONE, secondary: TO_LIST,
      };
    case 'error-notfound':
      return {
        top: '문제가 생겼어요', icon: 'alert', warn: true, heading: '찾을 수 없는 클래스예요', lead: '삭제됐거나 주소가 잘못됐을 수 있어요.',
        rows: [{ icon: 'link', title: '주소를 다시 확인해요', sub: '링크가 끝까지 복사됐는지 확인해요' }, LIST_ROW],
        primary: { label: '클래스 목록으로', action: 'list' }, secondary: { label: '다시 시도', action: 'retry' },
      };
    case 'error-forbidden':
      return {
        top: '문제가 생겼어요', icon: 'lock', warn: true, heading: '내가 연 클래스가 아니에요', lead: '이 클래스는 다른 상담사가 열었어요. 내 클래스는 목록에서 확인해요.',
        rows: [{ icon: 'user', title: '호스트만 열 수 있어요', sub: '클래스를 만든 상담사가 열고 진행해요' }, { icon: 'list', title: '내 클래스 보기', sub: '목록에서 내가 만든 클래스를 찾아요' }],
        primary: { label: '내 클래스 보기', action: 'list' }, secondary: { label: '홈으로', action: 'home' },
      };
    case 'error-network':
      return {
        top: '연결이 끊겼어요', icon: 'wifi-off', warn: true, heading: '연결이 끊겼어요', lead: '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
        rows: [{ icon: 'wifi-off', title: '네트워크를 확인해요', sub: 'Wi-Fi나 모바일 데이터가 켜져 있는지 봐요' }, { icon: 'refresh', title: '연결되면 이어서 진행해요', sub: '다시 시도를 누르면 돼요' }],
        primary: RETRY, secondary: TO_LIST,
      };
    default:
      return {
        top: '문제가 생겼어요', icon: 'alert', warn: true, heading: '클래스를 불러오지 못했어요', lead: '잠시 뒤 다시 시도해 주세요. 계속 안 되면 클래스 목록에서 다시 들어와 주세요.',
        rows: [{ icon: 'refresh', title: '잠시 기다렸다가 다시 시도해요', sub: '일시적인 문제일 수 있어요' }, { icon: 'list', title: '목록에서 다시 들어와도 돼요', sub: '내 클래스는 목록에서 찾을 수 있어요' }],
        primary: RETRY, secondary: TO_LIST,
      };
  }
}

/** 로딩·시작 오류 → 화면 종류. 서버 message 는 폴백에도 쓰지 않는다 */
export function deriveHostStateKind(input: { error: unknown; online?: boolean }): Extract<HostStateKind, `error${string}`> {
  if (input.online === false) return 'error-network';
  const e = input.error;
  if (e instanceof ApiError) {
    if (e.status === 404) return 'error-notfound';
    if (e.status === 403) return 'error-forbidden';
    if (e.status === 408 || e.status === 503 || e.status === 0) return 'error-network';
    return 'error';
  }
  if (e instanceof TypeError) return 'error-network';
  return 'error';
}
