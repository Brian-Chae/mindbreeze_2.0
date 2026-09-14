/**
 * SDD-034 — Playground 페이지.
 * 명상 시뮬레이터(mock)로 LINK BAND 없이 몸/마음 지표를 검증한다.
 */

import AppShell from '../../components/layout/AppShell';
import { PlaygroundMeditationSimulator } from '../../components/playground/PlaygroundMeditationSimulator';

export default function PlaygroundPage() {
  return (
    <AppShell
      title="Playground"
      sub="생체신호 진단 · 명상 시뮬레이터 (SDD-034). mock 데이터로 LINK BAND 없이 동작합니다."
    >
      <div className="mx-auto max-w-4xl space-y-6">
        <PlaygroundMeditationSimulator />
      </div>
    </AppShell>
  );
}
