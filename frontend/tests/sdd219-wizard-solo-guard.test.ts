// SDD-219 A14 — 상담 비공개 중 명상이 아닌 유형의 1:1 편성 차단
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCreatePayload, createInitialDraft, createInitialState, isSoloAllowed, wizardReducer } from '../src/lib/class/class-wizard';

afterEach(() => vi.unstubAllEnvs());

describe('SDD-219 A14 마법사 1:1 가드', () => {
  it('비공개: 명상만 1:1 허용', () => {
    vi.stubEnv('VITE_COUNSELING_ENABLED', 'false');
    expect(isSoloAllowed('meditation')).toBe(true);
    for (const t of ['other', 'clinical', 'hypnosis'] as const) expect(isSoloAllowed(t)).toBe(false);
  });

  it('비공개: 기타 유형에서 1:1 선택은 그룹으로 보정', () => {
    vi.stubEnv('VITE_COUNSELING_ENABLED', 'false');
    let st = createInitialState();
    st = wizardReducer(st, { type: 'patch', patch: { type: 'other' } });
    st = wizardReducer(st, { type: 'setSize', size: 'solo' });
    expect(st.draft.size).toBe('group');
  });

  it('비공개: 1:1 상태에서 유형을 기타로 바꾸면 그룹으로 보정', () => {
    vi.stubEnv('VITE_COUNSELING_ENABLED', 'false');
    let st = createInitialState();
    st = wizardReducer(st, { type: 'setSize', size: 'solo' });
    expect(st.draft.size).toBe('solo');
    st = wizardReducer(st, { type: 'patch', patch: { type: 'other' } });
    expect(st.draft.size).toBe('group');
  });

  it('비공개: 명상 1:1 은 유지되고 페이로드도 one_on_one', () => {
    vi.stubEnv('VITE_COUNSELING_ENABLED', 'false');
    const draft = { ...createInitialDraft(), size: 'solo' as const };
    expect(buildCreatePayload(draft, new Date(), false).participant_mode).toBe('one_on_one');
  });

  it('비공개: 상담 분류로 이어질 페이로드(기타+1:1)는 만들어지지 않음', () => {
    vi.stubEnv('VITE_COUNSELING_ENABLED', 'false');
    const draft = { ...createInitialDraft(), type: 'other' as const, size: 'solo' as const };
    const p = buildCreatePayload(draft, new Date(), false);
    expect(p.type === 'custom' && p.participant_mode === 'one_on_one').toBe(false);
  });

  it('공개(on): 기존 동작 유지', () => {
    vi.stubEnv('VITE_COUNSELING_ENABLED', 'true');
    let st = createInitialState();
    st = wizardReducer(st, { type: 'patch', patch: { type: 'other' } });
    st = wizardReducer(st, { type: 'setSize', size: 'solo' });
    expect(st.draft.size).toBe('solo');
  });
});
