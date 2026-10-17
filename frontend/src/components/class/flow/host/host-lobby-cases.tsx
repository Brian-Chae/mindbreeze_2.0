// SDD-209 H5 — 하니스 픽스처: FH06 로비 25케이스(시안 host-b.html LOBBY)
import { LOBBY_CASES, LOBBY_DESC } from '../../../../lib/class/flow/host-lobby-fixtures';
import type { FlowCaseEntry } from '../../../../lib/class/flow/types';
import { LobbyFixture } from './LobbyFixture';

export const hostLobbyCases: Record<string, FlowCaseEntry> = Object.fromEntries(
  Object.keys(LOBBY_CASES).map((key): [string, FlowCaseEntry] => [
    `FH06:${key}`,
    { description: LOBBY_DESC[key] ?? key, render: (ctx) => <LobbyFixture caseKey={key} n={ctx.n} backdropSrc={ctx.backdropSrc} /> },
  ]),
);
