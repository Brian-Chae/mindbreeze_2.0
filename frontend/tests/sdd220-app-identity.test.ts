import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
const read = (name: string) => readFileSync(resolve(import.meta.dirname, '..', name), 'utf8');

it('MB 2.0의 iOS·Capacitor·Android 식별자와 법인 팀을 일치시킨다', () => {
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  expect(project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.looxidlabs\.mindbreeze2;/g) ?? []).toHaveLength(2);
  expect(project.match(/DEVELOPMENT_TEAM = XJDDLS7BEH;/g) ?? []).toHaveLength(2);
  expect(read('capacitor.config.ts')).toContain("appId: 'com.looxidlabs.mindbreeze2'");
  expect(read('android/app/build.gradle')).toContain('applicationId "com.looxidlabs.mindbreeze2"');
  const strings = read('android/app/src/main/res/values/strings.xml');
  expect(strings).toContain('<string name="package_name">com.looxidlabs.mindbreeze2</string>');
  expect(strings).toContain('<string name="custom_url_scheme">com.looxidlabs.mindbreeze2</string>');
});

it('Android namespace·Java 패키지와 dev 접미사는 유지한다', () => {
  const gradle = read('android/app/build.gradle');
  expect(gradle).toContain('namespace = "com.looxidlabs.mindbreeze"');
  expect(gradle).toContain('applicationIdSuffix ".dev"');
  expect(read('android/app/src/main/java/com/looxidlabs/mindbreeze/MainActivity.java')).toContain('package com.looxidlabs.mindbreeze;');
});
