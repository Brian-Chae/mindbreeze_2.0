// FIX 백그라운드 녹음 — 네이티브 설정 정적 검증 (V7·V8·V10)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('iOS 오디오 세션', () => {
  const cfg = read('ios/App/App/AudioSessionConfig.swift');
  it('V7 playAndRecord + A2DP + defaultToSpeaker, mixWithOthers 미사용', () => {
    expect(cfg).toContain('.playAndRecord');
    expect(cfg).toContain('.allowBluetoothA2DP');
    expect(cfg).toContain('.defaultToSpeaker');
    expect(cfg).not.toMatch(/options:[^\n]*mixWithOthers|\[[^\]]*mixWithOthers/);
  });
  it('AppDelegate 가 AudioSessionConfig 를 쓰고 .playback 을 더는 쓰지 않는다', () => {
    const d = read('ios/App/App/AppDelegate.swift');
    expect(d).toContain('AudioSessionConfig.apply()');
    expect(d).not.toContain('setCategory(.playback');
    expect(d).toContain('interruptionNotification');
  });
  it('V8 UIBackgroundModes 에 audio·bluetooth-central 유지', () => {
    const plist = read('ios/App/App/Info.plist');
    const modes = plist.slice(plist.indexOf('UIBackgroundModes'), plist.indexOf('</array>', plist.indexOf('UIBackgroundModes')));
    expect(modes).toContain('<string>audio</string>');
    expect(modes).toContain('<string>bluetooth-central</string>');
  });
});

describe('Android 매니페스트', () => {
  const m = read('android/app/src/main/AndroidManifest.xml');
  it('V10 microphone FGS 선언·권한 유지', () => {
    expect(m).toContain('android.permission.FOREGROUND_SERVICE_MICROPHONE');
    expect(m).toContain('android.permission.RECORD_AUDIO');
    expect(m).toMatch(/AndroidForegroundService"\s+android:foregroundServiceType="connectedDevice\|microphone"/);
  });
});
