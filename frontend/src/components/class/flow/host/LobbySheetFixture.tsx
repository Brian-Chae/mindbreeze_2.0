// SDD-209 H6 — 하니스용 로비 시트 래퍼(FH06a 11케이스). 시트 안 조작(재발송·재생·토글)은 화면 안에서만 동작한다.
import { useState } from 'react';
import type { LeadOffStatus } from '../../../../lib/eeg/types/eeg';
import { LOBBY_ADDRESS, LOBBY_CODE, LOBBY_START_TEXT, LOBBY_TITLE, buildLobbyFixture } from '../../../../lib/class/flow/host-lobby-fixtures';
import type { AwayRow } from '../../../../lib/class/flow/host-invite-remind';
import { LobbyScreen } from './LobbyScreen';
import type { LobbySheetKind } from '../../../../lib/class/flow/host-lobby-model';
import { LobbySheets, type LobbyChatMessage } from './LobbySheets';

export interface LobbySheetCase {
  kind: LobbySheetKind;
  /** 배경 로비 케이스 키 */
  lobby: 'g-on-3' | 'g-on-8';
  /** 내 밴드 상태 */
  band?: { connected: boolean; leadOff: LeadOffStatus | null };
  chatEnabled?: boolean;
}

/** 시안 invite 시트의 입장 전 회원 3명(초대했어요 / 요청 결과 / 요청 실패) */
const AWAY_DEMO: AwayRow[] = [
  { id: 'a1', name: '현우', status: null },
  { id: 'a2', name: '수아', status: 'queued' },
  { id: 'a3', name: '하은', status: 'failed' },
];

const TRACKS = [
  { id: 't1', title: '숲속 새벽' },
  { id: 't2', title: '계곡 물소리' },
  { id: 't3', title: '고요한 종소리' },
];

const MESSAGES: LobbyChatMessage[] = [
  { id: 'c1', from: '서연', text: '안녕하세요, 잘 들려요' },
  { id: 'c2', from: '민준', text: '음악이 좋아요' },
  { id: 'c3', from: '나', text: '곧 시작할게요', mine: true },
];

export function LobbySheetFixture({ spec, backdropSrc }: { spec: LobbySheetCase; backdropSrc: string }) {
  const fixture = buildLobbyFixture(spec.lobby);
  const [kind, setKind] = useState<LobbySheetKind | null>(spec.kind);
  const [away, setAway] = useState<AwayRow[]>(spec.lobby === 'g-on-8' ? [] : AWAY_DEMO);
  const [copied, setCopied] = useState(false);
  const [track, setTrack] = useState<string | null>('t1');
  const [playing, setPlaying] = useState(true);
  const [volume, setVolume] = useState(0.6);
  const [connected, setConnected] = useState(spec.band?.connected ?? false);
  const [chatOn, setChatOn] = useState(spec.chatEnabled ?? true);
  const [draft, setDraft] = useState('');
  const raised = [{ id: 'r1', name: '민준' }, { id: 'r2', name: '지우' }];
  const speaking = [{ id: 's1', name: '서연' }];
  return (
    <LobbyScreen
      {...fixture.ctx}
      title={LOBBY_TITLE}
      address={LOBBY_ADDRESS}
      startText={LOBBY_START_TEXT}
      model={fixture.model}
      backdropSrc={backdropSrc}
      sheetOpen={kind !== null}
      sheet={
        <LobbySheets
          kind={kind}
          onClose={() => setKind(null)}
          invite={{
            invited: fixture.model.stats.invited,
            inRoom: fixture.model.stats.inRoom,
            away,
            code: LOBBY_CODE,
            codeCopied: copied,
            onCopyCode: () => setCopied(true),
            onRemind: (ids) => setAway((prev) => prev.map((row) => (ids.includes(row.id) ? { ...row, status: 'queued' } : row))),
            onInviteAdd: () => undefined,
          }}
          bgm={{
            tracks: TRACKS, selectedId: track, playing, progress: 0.36, timeText: '01:20 / 03:40', volume,
            onSelect: setTrack, onTogglePlay: () => setPlaying((p) => !p), onVolume: setVolume,
          }}
          band={{ connected, leadOff: spec.band?.leadOff ?? null, onConnect: () => setConnected(true), onDisconnect: () => setConnected(false) }}
          speak={{ raised, speaking, onAllow: () => undefined, onStop: () => undefined }}
          chat={{ enabled: chatOn, messages: MESSAGES, draft, onDraft: setDraft, onToggle: () => setChatOn((v) => !v), onSend: () => setDraft('') }}
        />
      }
      onBack={() => undefined}
      onStart={() => undefined}
      onRemind={() => undefined}
      onInviteAdd={() => undefined}
      onInviteSheet={() => setKind('invite')}
      onDock={(k) => setKind(k)}
    />
  );
}
