// 앱 백그라운드 세션 — Android Foreground Service 제어 (SDD-222 G5, plan §3.4·부록 A)
// Android 에서만 FGS 플러그인을 동적 import 로 호출한다. iOS·웹은 로드·호출 모두 하지 않는다(no-op).
// iOS 는 UIBackgroundModes(네이티브 설정)가 담당한다.
// start/stop 은 직렬화·멱등이며, 실패해도 예외를 던지지 않는다(수업 화면 보호).

import { createLogger } from '../eeg/logger';
import { getPlatform } from './platform';

const logger = createLogger('background-session');

/** Android ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE — 플러그인 enum 에는 없어 숫자로 전달한다 */
export const FGS_TYPE_CONNECTED_DEVICE = 16;
/** Android ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE — 상담사 온라인 수업의 음성 송출 유지(D3) */
export const FGS_TYPE_MICROPHONE = 128;
export const FGS_NOTIFICATION_ID = 2220;
export const FGS_CHANNEL_ID = 'mindbreeze_class_session';
/** Track A(Android)가 res/drawable 에 만드는 리소스 이름 — 변경 금지 */
export const FGS_SMALL_ICON = 'ic_stat_mindbreeze';
export const FGS_NOTIFICATION_TEXT = '명상 클래스 진행 중';

// connectedDevice 타입은 Android 14(API 34)부터 BLUETOOTH_CONNECT 보유가 시작 조건이다.
const ANDROID_FGS_PERMISSION_GATE_VERSION = 14;

export interface BackgroundSessionOptions {
  /** 상담사 온라인 수업처럼 마이크를 송출하는 경우 true — 서비스 타입에 microphone 을 더한다 */
  microphone?: boolean;
}

let running = false;
let desiredMicrophone = false;
let desired = false;
let chain: Promise<void> = Promise.resolve();

type ForegroundServiceModule = typeof import('@capawesome-team/capacitor-android-foreground-service');

const isAndroid = (): boolean => getPlatform() === 'android';

/** UA 의 Android 메이저 버전. 파싱 실패 시 null */
function androidMajorVersion(): number | null {
  if (typeof navigator === 'undefined') return null;
  const match = /Android\s+(\d+)/i.exec(navigator.userAgent);
  return match ? Number(match[1]) : null;
}

/**
 * Android 14+ 에서 BLE(BLUETOOTH_CONNECT) 권한이 허용됐는지.
 * 명시적으로 허용되지 않은 경우에만 false — 조회 불가(API 없음·오류)는 시작을 시도하도록 true.
 * (시작이 실패해도 start 쪽에서 삼킨다.)
 */
async function isBleConnectAllowed(): Promise<boolean> {
  const major = androidMajorVersion();
  if (major !== null && major < ANDROID_FGS_PERMISSION_GATE_VERSION) return true;
  try {
    const { BluetoothLe } = await import('@capacitor-community/bluetooth-le');
    const plugin = BluetoothLe as unknown as { checkPermissions?: () => Promise<Record<string, string>> };
    if (!plugin.checkPermissions) return true;
    const state = (await plugin.checkPermissions()).BLUETOOTH_CONNECT;
    return state === undefined || state === 'granted';
  } catch (error: unknown) {
    logger.warn('BLE 권한 상태 조회 실패 — 시작을 시도합니다', error);
    return true;
  }
}

/** 알림 권한(Android 13+)이 아직 묻지 않은 상태면 1회 요청한다. 거부돼도 서비스는 시작한다(알림만 제한). */
async function ensureNotificationPermission(fgs: ForegroundServiceModule): Promise<void> {
  try {
    const { display } = await fgs.ForegroundService.checkPermissions();
    if (display === 'prompt') {
      await fgs.ForegroundService.requestPermissions();
    }
  } catch (error: unknown) {
    logger.warn('알림 권한 확인 실패 — 알림 없이 진행합니다', error);
  }
}

type FgsStartOptions = Parameters<ForegroundServiceModule['ForegroundService']['startForegroundService']>[0];
type FgsServiceType = FgsStartOptions['serviceType'];

async function doStart(): Promise<void> {
  if (!(await isBleConnectAllowed())) {
    logger.warn('BLE 권한이 없어 백그라운드 서비스를 시작하지 않습니다');
    return;
  }
  const fgs = await import('@capawesome-team/capacitor-android-foreground-service');
  try {
    await ensureNotificationPermission(fgs);
    // 채널은 한 번 만들면 중요도를 바꿀 수 없으므로 start 전에 LOW 로 만들어 둔다(소리·진동·헤드업 없음).
    try {
      await fgs.ForegroundService.createNotificationChannel({
        id: FGS_CHANNEL_ID,
        name: FGS_NOTIFICATION_TEXT,
        description: '수업 중 뇌파 측정 기기 연결과 데이터 전송을 유지합니다.',
        importance: fgs.Importance.Low,
      });
    } catch (error: unknown) {
      logger.warn('알림 채널 생성 실패 — 기본 채널로 진행합니다', error);
    }
    const startWith = (type: number): Promise<void> =>
      fgs.ForegroundService.startForegroundService({
        id: FGS_NOTIFICATION_ID,
        title: FGS_NOTIFICATION_TEXT,
        body: FGS_NOTIFICATION_TEXT,
        smallIcon: FGS_SMALL_ICON,
        serviceType: type as FgsServiceType,
        notificationChannelId: FGS_CHANNEL_ID,
        silent: true,
      });
    if (desiredMicrophone) {
      try {
        await startWith(FGS_TYPE_CONNECTED_DEVICE | FGS_TYPE_MICROPHONE);
      } catch (error: unknown) {
        // 마이크 권한 거부 등으로 microphone 타입 시작이 거부돼도 BLE 유지는 지켜야 한다(H10).
        logger.warn('마이크 타입 서비스 시작 실패 — connectedDevice 로 재시도합니다', error);
        await startWith(FGS_TYPE_CONNECTED_DEVICE);
      }
    } else {
      await startWith(FGS_TYPE_CONNECTED_DEVICE);
    }
    running = true;
  } catch (error: unknown) {
    logger.error('백그라운드 서비스 시작 실패', error);
    // 일부만 시작됐을 수 있으므로 정리한다(알림이 남지 않게).
    try {
      await fgs.ForegroundService.stopForegroundService();
    } catch {
      // 정리 실패는 무시
    }
    running = false;
  }
}

async function doStop(): Promise<void> {
  running = false;
  try {
    const fgs = await import('@capawesome-team/capacitor-android-foreground-service');
    await fgs.ForegroundService.stopForegroundService();
  } catch (error: unknown) {
    logger.warn('백그라운드 서비스 종료 실패', error);
  }
}

/** 최신 desired 상태에 맞춰 한 번에 하나씩만 실행한다(시작 도중 종료 요청 포함). */
async function sync(): Promise<void> {
  if (desired && !running) await doStart();
  else if (!desired && running) await doStop();
}

function enqueue(): Promise<void> {
  chain = chain.then(sync, sync);
  return chain;
}

/** 수업 진행 중 서비스 시작. Android 외에는 no-op. 이미 실행 중이면 no-op. */
export function startBackgroundSession(options: BackgroundSessionOptions = {}): Promise<void> {
  if (!isAndroid()) return Promise.resolve();
  desired = true;
  // 실행 중에는 타입을 바꾸지 않는다(멱등) — 다음 시작부터 적용된다.
  if (!running) desiredMicrophone = options.microphone === true;
  return enqueue();
}

/** 서비스 종료. 시작한 적이 없거나 이미 종료됐으면 no-op. 멱등. */
export function stopBackgroundSession(): Promise<void> {
  if (!isAndroid()) return Promise.resolve();
  desired = false;
  return enqueue();
}
