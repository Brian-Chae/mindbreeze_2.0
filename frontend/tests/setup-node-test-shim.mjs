// node:test 스타일(.cjs/.test.cjs) 스위트를 vitest 러너에 연결하는 브리지.
//
// 이 저장소의 브라우저/API 테스트 일부는 `node:test` API(`require('node:test')`)로
// 작성되어 있어, 그대로 vitest에 넣으면 "No test suite found in file" 로 수집에 실패한다.
// setupFiles에서 node:test의 test/describe 등을 vitest 구현으로 바꿔치기해
// 동일한 테스트 본문을 vitest 러너가 실행/집계하도록 한다.
import { createRequire } from 'node:module';
import {
  test as vitestTest,
  describe as vitestDescribe,
  it as vitestIt,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';

const require = createRequire(import.meta.url);
const nodeTest = require('node:test');

/** node:test 의 test(name, fn) / test(name, options, fn) 시그니처를 vitest로 전달한다. */
function bridge(name, options, fn) {
  if (typeof options === 'function' || fn === undefined) {
    return vitestTest(name, options);
  }
  return vitestTest(name, options, fn);
}

try {
  nodeTest.test = bridge;
} catch {
  // 내장 모듈 속성을 바꿀 수 없는 환경이면 원래 node:test 러너가 그대로 동작한다.
}
try {
  nodeTest.it = vitestIt;
} catch {
  // noop
}
try {
  nodeTest.describe = vitestDescribe;
} catch {
  // noop
}
try {
  nodeTest.before = beforeAll;
  nodeTest.after = afterAll;
  nodeTest.beforeEach = beforeEach;
  nodeTest.afterEach = afterEach;
} catch {
  // noop
}
