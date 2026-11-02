// SDD-277 B — 밴드 없이 참여한 입장(측정·capture.start 없음)은 보고할 총량이 없다.
// 서버는 폰 보고가 없으면 expected_unknown("집계 대기")으로 두고 final 이 영영 오지 않으므로,
// 회차가 끝난 뒤 "만든 것이 없음"을 feature 0 · raw 0/0/0 · final=true 로 한 번 알려 닫는다.
//  - 측정한 흔적(outbox 창·원시 청크·큐 항목·이미 보고한 값)이 하나라도 있으면 보내지 않는다(측정한 사람을 0 으로 덮지 않는다).
//  - 입장 자격 사본을 보고 레코드에 함께 영속해, "홈으로"·탭 종료·오프라인 뒤에도 앱 셸 훅이 보고를 마친다(SDD-275 경로 재사용).
import { BiosignalQueue } from './durable-queue';
import { getExpectedHub } from './expected-hub';
import type { ExpectedScope, StoredEntryAuth } from './expected-reporter';
import { IdbOutboxStore, MetricOutbox } from '../measurement-web/metric-outbox';

export type NoBandFinalResult = 'reported' | 'has_data' | 'unavailable';

/** 이 scope 에서 측정 흔적이 있는지(없을 때만 0 final 을 보낼 수 있다) */
async function hasMeasuredData(scope: ExpectedScope): Promise<boolean> {
  const outbox = new MetricOutbox({ scope, store: new IdbOutboxStore(), send: async () => { throw new Error('observe_only'); } });
  if ((await outbox.snapshot()).length > 0) return true;
  const queue = new BiosignalQueue({ ...scope, deviceAlias: 'LINK-BAND' }, 'no-band-final');
  if (await queue.hasStoredObjects()) return true;
  if ((await queue.allPackets()).length > 0) return true;
  if ((await queue.receipts()).length > 0) return true;
  return false;
}

export async function reportNoBandFinal(args: { scope: ExpectedScope; entryAuth?: StoredEntryAuth | null }): Promise<NoBandFinalResult> {
  const { scope, entryAuth } = args;
  const hub = getExpectedHub();
  if (!hub || !scope.participantId) return 'unavailable';
  if (await hasMeasuredData(scope)) return 'has_data';
  // 이미 측정값을 보고한 기록(feature>0 또는 raw>0)이 있으면 0 으로 덮지 않는다
  const prior = (await hub.reporter.listRecords()).find((r) => r.accountId === scope.accountId && r.sessionId === scope.sessionId && r.participantId === scope.participantId);
  const rep = prior?.report ?? null;
  if (rep && (rep.feature > 0 || (rep.raw !== null && (rep.raw.eeg > 0 || rep.raw.ppg > 0 || rep.raw.acc > 0)))) return 'has_data';
  await hub.observeWebFeatureTotal(scope, 0, true, { raw: { eeg: 0, ppg: 0, acc: 0 }, entryAuth: entryAuth ?? null });
  return 'reported';
}
