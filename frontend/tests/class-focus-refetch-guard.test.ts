import { beforeEach, expect, it } from 'vitest';
import {
  FOCUS_REFETCH_MIN_INTERVAL_MS, classReadRevision, invalidateClassReads,
  invalidateClassReadsOnFocus, resetFocusRefetchGuard,
} from '../src/lib/class-structure/invalidation';

beforeEach(() => resetFocusRefetchGuard());

it('focus 재조회는 30초 안에 한 번만 일어난다', () => {
  const before = classReadRevision();
  invalidateClassReadsOnFocus(1_000_000);
  invalidateClassReadsOnFocus(1_000_000 + FOCUS_REFETCH_MIN_INTERVAL_MS - 1);
  expect(classReadRevision()).toBe(before + 1);
  invalidateClassReadsOnFocus(1_000_000 + FOCUS_REFETCH_MIN_INTERVAL_MS);
  expect(classReadRevision()).toBe(before + 2);
});

it('쓰기 후 즉시 갱신(invalidateClassReads)은 가드를 받지 않는다', () => {
  const before = classReadRevision();
  invalidateClassReads();
  invalidateClassReads();
  expect(classReadRevision()).toBe(before + 2);
});
