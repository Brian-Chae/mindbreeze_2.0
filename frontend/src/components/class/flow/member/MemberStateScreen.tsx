// SDD-209 M1 — FM10 취소됨·종료·미오픈·오류·끊김·입장 정보 만료(풀스크린 상태 카드). 서버 오류 문구는 노출하지 않는다.
import type { ReactNode } from 'react';
import { CalendarX, Clock, Key, TriangleAlert, WifiOff } from 'lucide-react';
import type { FlowStateKind } from '../../../../lib/class/flow/member-machine';
import { FlowStateScreen } from '../shared/FlowStateScreen';

interface StateCopy {
  icon: ReactNode;
  warn: boolean;
  heading: string;
  lead: (when: string | null) => ReactNode;
  secondRow: (when: string | null) => readonly [string, string];
  note: string;
  primary: string;
  secondary: string;
}

const COPY: Record<FlowStateKind, StateCopy> = {
  cancelled: {
    icon: <CalendarX size={28} />, warn: false, heading: '클래스가 취소됐어요',
    lead: () => <>진행자가 클래스를 취소했어요.<br />새 일정이 정해지면 알려드릴게요.</>,
    secondRow: (when) => ['원래 일정', when ?? '-'],
    note: '입장했던 내용은 저장되지 않아요.', primary: '클래스 목록 보기', secondary: '홈으로',
  },
  closed: {
    icon: <CalendarX size={28} />, warn: false, heading: '이미 끝난 클래스예요',
    lead: () => <>종료되었거나 취소된 클래스예요.<br />다른 클래스를 확인해 주세요.</>,
    secondRow: () => ['상태', '종료됨'],
    note: '다른 클래스는 목록에서 확인할 수 있어요.', primary: '클래스 목록 보기', secondary: '홈으로',
  },
  notyet: {
    icon: <Clock size={28} />, warn: false, heading: '아직 열리지 않았어요',
    lead: (when) => <>{when ? `${when}에 열려요.` : '곧 열려요.'}<br />먼저 입장해서 기다릴 수 있어요.</>,
    secondRow: (when) => ['시작', when ?? '-'],
    note: '열리면 자동으로 입장해요.', primary: '입장 대기하기', secondary: '홈으로',
  },
  error: {
    icon: <TriangleAlert size={28} />, warn: true, heading: '잠시 문제가 생겼어요',
    lead: () => <>클래스 정보를 불러오지 못했어요.<br />잠시 후 다시 시도해 주세요.</>,
    secondRow: () => ['상태', '불러오지 못했어요'],
    note: '문제가 계속되면 진행자에게 알려 주세요.', primary: '다시 시도', secondary: '홈으로',
  },
  offline: {
    icon: <WifiOff size={28} />, warn: true, heading: '네트워크 연결이 끊겼어요',
    lead: () => <>연결이 돌아오면 자동으로 이어져요.<br />이 화면을 닫지 말고 기다려 주세요.</>,
    secondRow: () => ['연결 상태', '다시 연결하는 중'],
    note: '와이파이나 모바일 데이터를 확인해 주세요.', primary: '다시 연결', secondary: '나가기',
  },
  'entry-expired': {
    icon: <Key size={28} />, warn: false, heading: '입장 정보가 만료됐어요',
    lead: () => <>입장 정보를 더는 쓸 수 없어요.<br />코드를 다시 입력해 주세요.</>,
    secondRow: () => ['상태', '다시 입력이 필요해요'],
    note: '코드는 코치에게 받을 수 있어요.', primary: '코드 입력하기', secondary: '나가기',
  },
};

interface MemberStateScreenProps {
  kind: FlowStateKind;
  classTitle: string;
  /** `오늘 오후 3:00` — 취소·미오픈 카드의 일정 줄 */
  whenLabel: string | null;
  /** SDD-231: 미오픈 카드에 보여 줄 남은 시간(`시작까지 3시간 남았어요`). 없으면 생략 */
  countdown?: string | null;
  backdropSrc?: string;
  onPrimary: () => void;
  onSecondary: () => void;
}

export function MemberStateScreen({ kind, classTitle, whenLabel, countdown = null, backdropSrc, onPrimary, onSecondary }: MemberStateScreenProps) {
  const copy = COPY[kind];
  const [secondLabel, secondValue] = copy.secondRow(whenLabel);
  return (
    <FlowStateScreen
      icon={copy.icon}
      warn={copy.warn}
      heading={copy.heading}
      lead={kind === 'notyet' && countdown ? <>{copy.lead(whenLabel)}<br />{countdown}</> : copy.lead(whenLabel)}
      info={[{ label: '클래스', value: classTitle }, { label: secondLabel, value: secondValue }]}
      note={copy.note}
      primary={{ label: copy.primary, onClick: onPrimary }}
      secondary={{ label: copy.secondary, onClick: onSecondary }}
      backdropSrc={backdropSrc}
    />
  );
}
