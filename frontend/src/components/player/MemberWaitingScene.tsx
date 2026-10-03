// SDD-105: 준비와 시작 대기를 같은 대기실 인스턴스로 통합한다.
import { ClassWaitingRoom, type ClassWaitingRoomProps } from '../class/ClassWaitingRoom';

export function MemberWaitingScene(props: ClassWaitingRoomProps): React.ReactElement {
  return <ClassWaitingRoom {...props} />;
}
