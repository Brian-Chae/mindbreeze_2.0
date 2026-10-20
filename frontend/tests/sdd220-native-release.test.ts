import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
const read = (name: string) => readFileSync(resolve(import.meta.dirname, '..', name), 'utf8');
it('TS28 Capacitor 네 패키지가 8.5.3 이상 동일 버전이다', () => {
 const pkg = JSON.parse(read('package.json'));
 const versions: string[] = ['core','ios','android','cli'].map(key => pkg.dependencies[`@capacitor/${key}`]);
 expect(new Set(versions).size).toBe(1);
 expect(versions[0]).toBe('8.5.3');
});
it('TS1 버전·암호화·Privacy Resources 등록', () => {
 expect(JSON.parse(read('package.json')).version).toBe('1.0.0');
 const p = read('ios/App/App.xcodeproj/project.pbxproj');
 expect(p).toContain('MARKETING_VERSION = 1.0.0;');
 expect(p).toContain('CURRENT_PROJECT_VERSION = 2;');
 expect(p).toContain('TARGETED_DEVICE_FAMILY = "1,2"');
 expect(read('ios/App/App/Info.plist')).toContain('<key>ITSAppUsesNonExemptEncryption</key>');
 expect(p).toMatch(/PrivacyInfo.xcprivacy.*isa = PBXBuildFile/);
 expect(p).toMatch(/PrivacyInfo.xcprivacy.*isa = PBXFileReference/);
 expect(p.match(/PrivacyInfo.xcprivacy in Resources/g)).toHaveLength(2);
});
it('TS25 승인된 한국어·영어 권한 목적', () => {
 const spec = read('../specs/sdd-220-store-review-readiness/spec.md');
 const ko = read('ios/App/App/Info.plist');
 expect(existsSync(resolve(import.meta.dirname, '../ios/App/App/en.lproj/InfoPlist.strings'))).toBe(true);
 const en = read('ios/App/App/en.lproj/InfoPlist.strings');
 for (const line of spec.split('\n').filter(line => /^\| `NS.*UsageDescription`/.test(line))) {
  const [,key,korean,english] = line.split('|').map(s => s.trim());
  expect(ko).toContain(`<key>${key.replaceAll('`','')}</key>`);
  expect(ko).toContain(korean); expect(en).toContain(english);
 }
});
it('TS29 release 서명 누락 거부·버전', () => {
 const g = read('android/app/build.gradle');
 expect(g).toContain('throw new GradleException');
 expect(g).toContain('"1.0.0"'); expect(g).toContain('"2"');
 const m = read('android/app/src/main/AndroidManifest.xml');
 expect(m).toContain('android:maxSdkVersion="30"');
 expect(m).toContain('android:usesPermissionFlags="neverForLocation"');
});
it('TS30 기본 cap 스크립트 prod 검증', () => {
 const p = JSON.parse(read('package.json'));
 for (const n of ['cap:sync','cap:ios','cap:android']) expect(p.scripts[n]).toContain('build:prod');
 expect(p.scripts['build:prod']).toContain('check-release-bundle.mjs');
});

it('TS30 실제 검사기는 개발 주소와 시안 파일을 거부한다', async () => {
 const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
 // @ts-expect-error Node 전용 릴리스 검사기에는 선언 파일이 없다.
 const { checkReleaseBundle } = await import('../scripts/check-release-bundle.mjs');
 const dir = await mkdtemp(resolve(import.meta.dirname, 'sdd220-bundle-'));
 try {
  await writeFile(resolve(dir, 'index.html'), '<script>https://dev-api.example.test</script>');
  await expect(checkReleaseBundle(dir)).rejects.toThrow('개발 서버 주소');
  await writeFile(resolve(dir, 'index.html'), 'http://localhost:8000/api/v1');
  await expect(checkReleaseBundle(dir)).rejects.toThrow('개발 서버 주소');
  await writeFile(resolve(dir, 'index.html'), 'https://api.mindbreeze.looxidlabs.com');
  expect((await checkReleaseBundle(dir)).bytes).toBeGreaterThan(0);
  await writeFile(resolve(dir, 'chat-test.html'), 'fixture');
  await expect(checkReleaseBundle(dir)).rejects.toThrow('시험 산출물');
 } finally { await rm(dir, { recursive: true }); }
});
it('TS40 Apple 로그인 capability와 entitlement를 선언한다', () => {
 expect(read('ios/App/App/App.entitlements')).toContain('<key>com.apple.developer.applesignin</key>');
 expect(read('ios/App/App.xcodeproj/project.pbxproj')).toContain('com.apple.SignInWithApple');
});
