// @vitest-environment jsdom
// SDD-222 T-J9 — background-session (V22~V27, 부록 A 시그니처)
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  platform: 'android' as 'android' | 'ios' | 'web',
  calls: [] as string[],
  pluginImports: 0,
  bleStates: { BLUETOOTH_CONNECT: 'granted' } as Record<string, string>,
  bleCheck: null as null | (() => Promise<Record<string, string>>),
  notif: 'granted' as string,
  createChannel: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  requestPerm: vi.fn(),
}));

vi.mock('../src/lib/native/platform', () => ({
  isNativeApp: () => h.platform !== 'web',
  getPlatform: () => h.platform,
}));
vi.mock('@capawesome-team/capacitor-android-foreground-service', () => {
  h.pluginImports += 1;
  return {
    Importance: { Min: 1, Low: 2, Default: 3, High: 4, Max: 5 },
    ServiceType: { Location: 8, Microphone: 128 },
    ForegroundService: {
      createNotificationChannel: (o: unknown) => { h.calls.push('channel'); return h.createChannel(o); },
      startForegroundService: (o: unknown) => { h.calls.push('start'); return h.start(o); },
      stopForegroundService: () => { h.calls.push('stop'); return h.stop(); },
      checkPermissions: async () => ({ display: h.notif }),
      requestPermissions: async (...a: unknown[]) => { h.calls.push('requestPerm'); h.requestPerm(...a); return { display: h.notif === 'prompt' ? 'denied' : h.notif }; },
    },
  };
});
vi.mock('@capacitor-community/bluetooth-le', () => ({
  BluetoothLe: { checkPermissions: () => (h.bleCheck ? h.bleCheck() : Promise.resolve(h.bleStates)) },
}));

const setUa = (ua: string) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
const ANDROID_14 = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const ANDROID_13 = 'Mozilla/5.0 (Linux; Android 13; SM-S908N) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

async function load() {
  vi.resetModules();
  return import('../src/lib/native/background-session');
}

beforeEach(() => {
  h.platform = 'android'; h.calls.length = 0; h.pluginImports = 0;
  h.bleStates = { BLUETOOTH_CONNECT: 'granted' }; h.bleCheck = null; h.notif = 'granted';
  h.createChannel.mockReset().mockResolvedValue(undefined);
  h.start.mockReset().mockResolvedValue(undefined);
  h.stop.mockReset().mockResolvedValue(undefined);
  h.requestPerm.mockReset();
  setUa(ANDROID_14);
});

describe('background-session — Android', () => {
  it('V22 채널(LOW)을 먼저 만들고 connectedDevice(16)·고정 문구·아이콘으로 FGS 를 1회 시작한다', async () => {
    const m = await load();
    await m.startBackgroundSession();
    expect(h.calls).toEqual(['channel', 'start']);
    const channel = h.createChannel.mock.calls[0][0] as { id: string; name: string; importance: number };
    expect(channel.importance).toBe(2);
    const opts = h.start.mock.calls[0][0] as Record<string, unknown>;
    expect(m.FGS_TYPE_CONNECTED_DEVICE).toBe(16);
    expect(opts.serviceType).toBe(16);
    expect(opts.smallIcon).toBe('ic_stat_mindbreeze');
    expect(opts.notificationChannelId).toBe(channel.id);
    expect(opts.title).toContain('명상 클래스 진행 중');
    expect(opts.body).toContain('명상 클래스 진행 중');
    expect(typeof opts.id).toBe('number');
  });

  it('V24 start 를 연속 2번 호출해도 시작은 1회, stop 을 연속 2번 호출해도 종료는 1회다', async () => {
    const m = await load();
    await Promise.all([m.startBackgroundSession(), m.startBackgroundSession()]);
    await m.startBackgroundSession();
    expect(h.start).toHaveBeenCalledTimes(1);
    await Promise.all([m.stopBackgroundSession(), m.stopBackgroundSession()]);
    await m.stopBackgroundSession();
    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it('시작한 적 없으면 stop 은 플러그인을 호출하지 않는다', async () => {
    const m = await load();
    await m.stopBackgroundSession();
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('종료 후 다시 시작할 수 있다', async () => {
    const m = await load();
    await m.startBackgroundSession(); await m.stopBackgroundSession(); await m.startBackgroundSession();
    expect(h.start).toHaveBeenCalledTimes(2);
    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it('시작이 진행되는 도중 stop 이 호출되면 시작이 끝난 뒤 반드시 종료한다', async () => {
    let release: () => void = () => undefined;
    h.start.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const m = await load();
    const starting = m.startBackgroundSession();
    await vi.waitFor(() => expect(h.start).toHaveBeenCalled());
    const stopping = m.stopBackgroundSession();
    release();
    await Promise.all([starting, stopping]);
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.calls.at(-1)).toBe('stop');
  });

  it('V26 시작 중 예외(권한 거부 등)는 삼키고 던지지 않으며, 정리용 stop 후 재시도할 수 있다', async () => {
    h.start.mockRejectedValueOnce(new Error('SecurityException'));
    const m = await load();
    await expect(m.startBackgroundSession()).resolves.toBeUndefined();
    expect(h.stop).toHaveBeenCalledTimes(1);
    await m.startBackgroundSession();
    expect(h.start).toHaveBeenCalledTimes(2);
  });

  it('채널 생성이 실패해도 서비스 시작은 시도한다(기본 채널로 폴백)', async () => {
    h.createChannel.mockRejectedValueOnce(new Error('channel'));
    const m = await load();
    await m.startBackgroundSession();
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('Android 14+ 에서 BLUETOOTH_CONNECT 가 허용되지 않았으면 시작하지 않고, 허용 후 재시도하면 시작한다', async () => {
    h.bleStates = { BLUETOOTH_CONNECT: 'denied' };
    const m = await load();
    await m.startBackgroundSession();
    expect(h.start).not.toHaveBeenCalled();
    h.bleStates = { BLUETOOTH_CONNECT: 'granted' };
    await m.startBackgroundSession();
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('Android 13 이하는 BLE 권한 상태와 무관하게 시작한다', async () => {
    setUa(ANDROID_13);
    h.bleStates = { BLUETOOTH_CONNECT: 'denied' };
    const m = await load();
    await m.startBackgroundSession();
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('Android 14+ 에서 권한 조회 자체가 실패하면(검증 불가) 시작을 시도한다', async () => {
    h.bleCheck = () => Promise.reject(new Error('no such method'));
    const m = await load();
    await m.startBackgroundSession();
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('V27 알림 권한이 아직 묻지 않은 상태면 요청하고, 거부돼도 서비스 시작은 수행한다', async () => {
    h.notif = 'prompt';
    const m = await load();
    await m.startBackgroundSession();
    expect(h.calls).toEqual(['requestPerm', 'channel', 'start']);
  });

  it('V27 알림 권한이 거부된 상태여도 다시 묻지 않고 서비스 시작은 수행한다', async () => {
    h.notif = 'denied';
    const m = await load();
    await m.startBackgroundSession();
    expect(h.requestPerm).not.toHaveBeenCalled();
    expect(h.start).toHaveBeenCalledTimes(1);
  });
});

describe('background-session — iOS·웹', () => {
  it.each(['ios', 'web'] as const)('V23 %s 에서는 플러그인을 로드하지도 호출하지도 않는다', async (platform) => {
    h.platform = platform;
    const m = await load();
    await m.startBackgroundSession();
    await m.stopBackgroundSession();
    expect(h.pluginImports).toBe(0);
    expect(h.calls).toEqual([]);
  });
});
