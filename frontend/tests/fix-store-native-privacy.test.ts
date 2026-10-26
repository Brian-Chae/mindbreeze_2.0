// [MB261026][FIX] Facebook SDK 제거·개인정보 매니페스트 정합 — 네이티브 설정 정적 가드
// 근거: specs/fix-store-native-privacy/verify.md V1~V6
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../capacitor.config';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf-8');

describe('V1~V4 Facebook SDK 제거', () => {
  it('V1 SocialLogin 공급자: Facebook 끔, Google·Apple 유지', () => {
    const providers = (config.plugins?.SocialLogin as { providers?: Record<string, boolean> } | undefined)?.providers;
    expect(providers).toEqual(expect.objectContaining({ google: true, facebook: false, apple: true }));
  });

  it('V2 cap sync 없이 gradle을 돌려도 Facebook이 들어오지 않게 루트 속성으로 막는다', () => {
    const props = read('android/gradle.properties');
    expect(props).toMatch(/^socialLogin\.facebook\.include=false$/m);
  });

  it.each([
    'com.google.android.gms.permission.AD_ID',
    'android.permission.ACCESS_ADSERVICES_AD_ID',
    'android.permission.ACCESS_ADSERVICES_ATTRIBUTION',
    'android.permission.ACCESS_ADSERVICES_CUSTOM_AUDIENCE',
    'android.permission.ACCESS_ADSERVICES_TOPICS',
  ])('V3 광고 ID 권한 %s 는 병합에서 제거한다', (name) => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toMatch(new RegExp(`<uses-permission\\s+android:name="${name.replaceAll('.', '\\.')}"\\s+tools:node="remove"\\s*/>`));
  });

  it('V4 iOS SPM 해석 결과에 facebook-ios-sdk가 없다', () => {
    const resolved = read('ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved');
    expect(resolved).not.toMatch(/facebook/i);
    expect(resolved).toContain('"identity" : "googlesignin-ios"');
  });
});

describe('V5 PrivacyInfo.xcprivacy 정합', () => {
  const plist = read('ios/App/App/PrivacyInfo.xcprivacy');
  const P = 'NSPrivacyCollectedDataTypePurpose';
  const T = 'NSPrivacyCollectedDataType';

  // 수집 유형별 목적 집합(dict 블록 단위로 파싱)
  const collected = new Map<string, string[]>();
  for (const block of plist.match(/<dict>\s*<key>NSPrivacyCollectedDataType<\/key>[\s\S]*?<\/dict>/g) ?? []) {
    const type = block.match(/<key>NSPrivacyCollectedDataType<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? '';
    const purposes = [...block.matchAll(/<string>(NSPrivacyCollectedDataTypePurpose\w+)<\/string>/g)].map((m) => m[1]);
    expect(block).toMatch(/<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/);
    expect(block).toMatch(/<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>/);
    collected.set(type, purposes);
  }

  // APP 창구 App Store Connect 저장 13유형(store-readiness-20261025)과 1:1
  const expected = [
    'Name', 'EmailAddress', 'PhoneNumber', 'PhysicalAddress', 'Health', 'EmailsOrTextMessages',
    'PhotosorVideos', 'AudioData', 'OtherUserContent', 'UserID', 'DeviceID', 'ProductInteraction', 'OtherDataTypes',
  ].map((t) => `${T}${t}`);
  // 선택 연구 활용(연구 동의자) 대상 — research_export_service.py 내보내기 열
  const research = ['Name', 'UserID', 'Health', 'ProductInteraction', 'OtherDataTypes'].map((t) => `${T}${t}`);

  it('수집 유형은 13개이며 민감 정보(SensitiveInfo)는 건강으로 신고한다', () => {
    expect([...collected.keys()].sort()).toEqual([...expected].sort());
    expect(plist).not.toContain(`${T}SensitiveInfo`);
  });

  it('추적 없음·추적 도메인 없음', () => {
    expect(plist).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(plist).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  });

  it('연구 대상 유형은 앱 기능+기타 목적, 나머지는 앱 기능만', () => {
    for (const [type, purposes] of collected) {
      const want = research.includes(type) ? [`${P}AppFunctionality`, `${P}Other`] : [`${P}AppFunctionality`];
      expect({ type, purposes: [...purposes].sort() }).toEqual({ type, purposes: [...want].sort() });
    }
  });

  it('Required Reason API: UserDefaults(CA92.1)만 선언', () => {
    const apis = [...plist.matchAll(/<string>(NSPrivacyAccessedAPICategory\w+)<\/string>/g)].map((m) => m[1]);
    expect(apis).toEqual(['NSPrivacyAccessedAPICategoryUserDefaults']);
    expect(plist).toContain('<string>CA92.1</string>');
  });
});
