// SDD-222 V29·V30 — 네이티브 설정(Android Manifest, iOS Info.plist) 정적 검증
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const manifest = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf-8');
const plist = readFileSync(join(root, 'ios/App/App/Info.plist'), 'utf-8');

describe('SDD-222 V29 AndroidManifest', () => {
  it.each(['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_CONNECTED_DEVICE', 'WAKE_LOCK'])(
    '권한 %s 선언',
    (name) => {
      expect(manifest).toContain(`android:name="android.permission.${name}"`);
    },
  );

  it('포그라운드 서비스가 connectedDevice 타입·비공개로 선언된다', () => {
    const match = manifest.match(/<service[^>]*AndroidForegroundService[^>]*>/s);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('android:foregroundServiceType="connectedDevice"');
    expect(match![0]).toContain('android:exported="false"');
  });

  it('불필요한 권한(SYSTEM_ALERT_WINDOW)과 location 서비스 타입은 없다', () => {
    expect(manifest).not.toContain('SYSTEM_ALERT_WINDOW');
    expect(manifest).not.toMatch(/foregroundServiceType="[^"]*location/);
  });
});

describe('SDD-222 V30 Info.plist', () => {
  it('UIBackgroundModes 에 bluetooth-central 과 audio 가 모두 있다', () => {
    const block = plist.match(/<key>UIBackgroundModes<\/key>\s*<array>(.*?)<\/array>/s);
    expect(block).not.toBeNull();
    expect(block![1]).toContain('<string>bluetooth-central</string>');
    expect(block![1]).toContain('<string>audio</string>');
  });
});
