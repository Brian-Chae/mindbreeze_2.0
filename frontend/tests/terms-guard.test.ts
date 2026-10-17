// SDD-211 T3 — 금지어 영역 분리 가드. meditation 합성 결과는 현행 BANNED_COPY 와 바이트 동일해야 하고,
// counseling 규칙은 정의만 있을 뿐 어떤 검사 경로에도 적용되지 않는다.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TERM_KEYS, term } from '../src/lib/terms';

// @ts-expect-error — .mjs 하니스 모듈(타입 선언 없음). 런타임 동작만 검증한다.
const lib = (await import('../e2e/class-flow/lib.mjs')) as {
  BANNED_COPY: string;
  composeBanned: (area: 'meditation' | 'counseling') => string;
  copyConfig: (area?: 'meditation' | 'counseling') => { banned: string };
  scanSources: (roots: string[], exts?: string[], area?: 'meditation' | 'counseling') => { hits: { kind: string; text: string }[] };
};

/** SDD-209 시점의 BANNED_COPY 원문 복사본(바이트 비교 기준). */
const ORIGINAL_BANNED_COPY = '세션|수업|오픈|참여하기|그래도 시작|LB |1:N|대시보드로|6자리|게스트|인증 코드|OTP|\\bQR\\b|귀 뒤|귀뒤|귀에|연결해야 입장|30일 보관|관리자가 삭제를 지시하기 전까지|표시 이름만|정원 10 고정|그룹은 최대 10명';

const BANNED_DIR = resolve(__dirname, '../e2e/class-flow/banned');
const readRules = (name: string): string[] => JSON.parse(readFileSync(join(BANNED_DIR, `${name}.json`), 'utf8')) as string[];

describe('FE-GUARD 금지어 영역 분리', () => {
  it('FE-GUARD-01 composeBanned("meditation") 이 현행 BANNED_COPY 원문과 같다', () => {
    expect(lib.composeBanned('meditation')).toBe(ORIGINAL_BANNED_COPY);
  });
  it('FE-GUARD-02 common 19 + meditation 3 = 현행 22개 항목', () => {
    const common = readRules('common');
    const meditation = readRules('meditation');
    expect(common).toHaveLength(19);
    expect(meditation).toEqual(['세션', '수업', '오픈']);
    expect([...meditation, ...common]).toEqual(ORIGINAL_BANNED_COPY.split('|'));
  });
  it('FE-GUARD-03 BANNED_COPY export 가 유지되고 copyConfig 기본 영역이 meditation 이다', () => {
    expect(lib.BANNED_COPY).toBe(ORIGINAL_BANNED_COPY);
    expect(lib.copyConfig().banned).toBe(ORIGINAL_BANNED_COPY);
    expect(lib.copyConfig('meditation').banned).toBe(ORIGINAL_BANNED_COPY);
  });
  it('FE-GUARD-04 counseling 규칙은 `상담 세션` 을 허용한다', () => {
    const re = new RegExp(lib.composeBanned('counseling'), 'g');
    expect('상담 세션 3회차'.match(re)).toBeNull();
  });
  it('FE-GUARD-05 counseling 규칙은 `세션 예약`·`클래스 열기` 를 적발한다', () => {
    const re = new RegExp(lib.composeBanned('counseling'), 'g');
    expect('세션 예약'.match(re)).toEqual(['세션']);
    expect('클래스 열기'.match(re)).toEqual(['클래스']);
    expect('수업 오픈'.match(re)).toEqual(['수업', '오픈']);
  });
  it('FE-GUARD-05b counseling 영역도 공통 금지어 19개를 포함한다', () => {
    const re = new RegExp(lib.composeBanned('counseling'), 'g');
    for (const word of readRules('common')) {
      if (word.startsWith('\\b')) continue;
      expect(word.match(re), word).not.toBeNull();
    }
  });
  it('FE-GUARD-06 용어 사전 값에 meditation 금지어(세션|수업|오픈 및 공통 규칙)가 0건이다', () => {
    const re = new RegExp(lib.composeBanned('meditation'));
    for (const key of TERM_KEYS) {
      expect(re.test(term(key, 'meditation')), `${key}`).toBe(false);
    }
  });
  it('FE-GUARD-07 counseling 규칙 적용 경로 0: 하니스 호출부·기존 가드가 counseling 을 참조하지 않는다', () => {
    for (const file of ['e2e/class-flow/fit.mjs', 'e2e/class-flow/selftest.mjs', 'tests/class-flow-shell-terms.test.ts']) {
      expect(readFileSync(resolve(__dirname, '..', file), 'utf8'), file).not.toMatch(/counseling/);
    }
  });
});

describe('scanSources 영역 인자', () => {
  const dir = mkdtempSync(join(tmpdir(), 'terms-guard-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'a.ts'), 'export const a = "세션을 시작해요";\nexport const b = "상담 세션";\nexport const c = "클래스 열기";\n');

  it('기본(meditation)은 `세션` 만 잡고 `클래스` 는 잡지 않는다', () => {
    const texts = lib.scanSources([dir]).hits.filter((h) => h.kind === 'srcBanned').map((h) => h.text);
    expect(texts).toEqual(['세션']);
  });
  it('counseling 영역은 `상담 세션` 은 통과, 맨 `세션`·`클래스` 는 적발', () => {
    const texts = lib.scanSources([dir], ['.ts'], 'counseling').hits.filter((h) => h.kind === 'srcBanned').map((h) => h.text);
    expect(texts).toEqual(['세션', '클래스']);
  });
});
