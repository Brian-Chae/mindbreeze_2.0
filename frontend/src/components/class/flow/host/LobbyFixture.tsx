// SDD-209 H5~H6 — 하니스용 로비 래퍼. 시안 입력(host-lobby-fixtures)을 같은 모델에 통과시켜 화면을 그린다.
import { LOBBY_ADDRESS, LOBBY_START_TEXT, LOBBY_TITLE, buildLobbyFixture } from '../../../../lib/class/flow/host-lobby-fixtures';
import { LobbyScreen } from './LobbyScreen';

interface LobbyFixtureProps {
  caseKey: string;
  /** 인원 변형(쿼리 n=) */
  n?: number | null;
  backdropSrc: string;
}

export function LobbyFixture({ caseKey, n, backdropSrc }: LobbyFixtureProps) {
  const fixture = buildLobbyFixture(caseKey, n ?? undefined);
  return (
    <LobbyScreen
      {...fixture.ctx}
      title={LOBBY_TITLE}
      address={LOBBY_ADDRESS}
      startText={LOBBY_START_TEXT}
      model={fixture.model}
      backdropSrc={backdropSrc}
      onBack={() => undefined}
      onStart={() => undefined}
      onRemind={() => undefined}
      onInviteAdd={() => undefined}
      onInviteSheet={() => undefined}
      onDock={() => undefined}
    />
  );
}
