// @vitest-environment jsdom
// 호흡·HRV 미표시 — 상담사 표면에서 호흡·HRV 가 항상 보이고, 값이 없으면 '측정 중'(점수·판정 없음)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HostMinis } from '../src/components/class/player/host/HostPersonParts';
import { SessionParticipantCardGrid } from '../src/components/session/SessionParticipantCardGrid';
import { SessionMonitorTable } from '../src/components/session/SessionMonitorTable';
import { EMPTY_HOST_VALUES, type HostParticipant } from '../src/lib/class/host-player-case';
import type { SessionLiveMetric } from '../src/lib/api/session';

let root: Root; let box: HTMLDivElement;
beforeEach(() => { box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); });
afterEach(() => { act(() => root.unmount()); box.remove(); });

const person = (band: HostParticipant['band'], values = EMPTY_HOST_VALUES): HostParticipant => ({
  id: 'p1', name: '회원', band, values, lowBattery: false, hand: false, speaking: false, agoLabel: null, checkin: [], attention: null,
});
const row = (over: Partial<SessionLiveMetric> = {}): SessionLiveMetric => ({
  participant_id: 'p1', display_name: '회원', is_guest: false, band_connected: true, device_status: 'ok', band_battery: 80,
  avg_efficiency: 50, current_efficiency: 50, heart_rate: 72, respiratory_rate: null, sdnn: null, last_eeg_at: new Date().toISOString(), ...over,
} as SessionLiveMetric);

describe('상담사 1:1 카드(HostMinis)', () => {
  it('착용 중 호흡·HRV 값이 없으면 측정 중', async () => {
    await act(async () => root.render(<HostMinis participant={person('on', { ...EMPTY_HOST_VALUES, bpm: 72 })} selected="relaxation" />));
    const t = box.textContent ?? '';
    expect((t.match(/측정 중/g) ?? []).length).toBe(2);
  });
  it('값이 있으면 숫자', async () => {
    await act(async () => root.render(<HostMinis participant={person('on', { ...EMPTY_HOST_VALUES, respiration: 14, hrv: 42 })} selected="hrv" />));
    expect(box.textContent).toContain('14'); expect(box.textContent).toContain('42'); expect(box.textContent).not.toContain('측정 중');
  });
  it('밴드 미착용은 측정 중이 아니라 —', async () => {
    await act(async () => root.render(<HostMinis participant={person('off')} selected="hrv" />));
    expect(box.textContent).not.toContain('측정 중');
  });
});

describe('레거시 모니터 카드·표', () => {
  it('카드에 HRV 타일이 있고 값 없으면 측정 중, 값이 있으면 숫자', async () => {
    await act(async () => root.render(<SessionParticipantCardGrid participants={[row()]} filter={null} selectedId={null} onSelect={() => undefined} />));
    expect(box.textContent).toContain('HRV'); expect(box.textContent).toContain('호흡수');
    expect((box.textContent?.match(/측정 중/g) ?? []).length).toBe(2);
    await act(async () => root.render(<SessionParticipantCardGrid participants={[row({ respiratory_rate: 13.4, sdnn: 41.6 })]} filter={null} selectedId={null} onSelect={() => undefined} />));
    expect(box.textContent).toContain('13'); expect(box.textContent).toContain('42'); expect(box.textContent).not.toContain('측정 중');
  });
  it('접촉 불량 행은 측정 중이 아니라 -', async () => {
    await act(async () => root.render(<SessionParticipantCardGrid participants={[row({ device_status: 'lead_off' })]} filter={null} selectedId={null} onSelect={() => undefined} />));
    expect(box.textContent).not.toContain('측정 중');
  });
  it('표에 HRV 열이 있다', async () => {
    await act(async () => root.render(<SessionMonitorTable participants={[row()]} filter={null} />));
    expect([...box.querySelectorAll('th')].map((h) => h.textContent)).toContain('HRV');
    expect((box.textContent?.match(/측정 중/g) ?? []).length).toBe(2);
  });
});
