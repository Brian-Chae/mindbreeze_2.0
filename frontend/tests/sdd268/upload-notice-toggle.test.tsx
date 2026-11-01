// @vitest-environment jsdom
// SDD-268 — 회원 업로드 안내: 기본 숨김, 연결 아이콘 토글, 이상 시 자동 표시, 내부 용어 제거 (V-N01~N08)
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  describeUploadProgress, shouldShowUploadNotice, type UploadProgress,
} from '../../src/lib/measurement-web/upload-progress';
import { MemberTopBar } from '../../src/components/class/player/member/MemberTopBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const P = (o: Partial<UploadProgress> = {}): UploadProgress => ({
  featurePending: 0, featureAcked: 0, featureRejected: 0, rawPending: 0, rawUploading: 0, rawVerified: 0, rawQuarantined: 0,
  featureState: 'idle', rawState: 'idle', complete: false, ...o,
});
const FORBIDDEN = /feature|원시|raw|EEG|PPG|ACC|업로드/i;

describe('안내 문구(내부 용어 제거, V-N06)', () => {
  it('전송 중', () => {
    expect(describeUploadProgress(P({ featurePending: 2, rawPending: 1, rawUploading: 1 }))).toEqual({
      kind: 'uploading', text: '전송 중 · 분석 데이터 2개 · 측정 기록 파일 2개',
    });
  });
  it('확인 중·모두 도착·확인 필요 문구에도 내부 용어가 없다', () => {
    const views = [
      describeUploadProgress(P({ featureAcked: 10 })),
      describeUploadProgress(P({ featureAcked: 10, complete: true })),
      describeUploadProgress(P({ featureRejected: 2, rawQuarantined: 1, complete: true })),
      describeUploadProgress(P({ featurePending: 3 })),
    ];
    for (const v of views) expect(v?.text ?? '').not.toMatch(FORBIDDEN);
    expect(views[1]).toEqual({ kind: 'done', text: '모두 도착했어요' });
    expect(views[2]?.kind).toBe('needs_review');
    expect(views[2]?.text).toContain('3건');
  });
});

describe('표시 규칙(V-N01·N04·N05·N07)', () => {
  const uploading = describeUploadProgress(P({ featurePending: 2 }));
  const done = describeUploadProgress(P({ featureAcked: 5, complete: true }));
  const review = describeUploadProgress(P({ featureRejected: 1, complete: true }));
  it('기본(닫힘)에서는 정상·진행 중이면 숨긴다', () => {
    expect(shouldShowUploadNotice(uploading, false)).toBe(false);
    expect(shouldShowUploadNotice(done, false)).toBe(false);
  });
  it('열면 표시한다', () => {
    expect(shouldShowUploadNotice(uploading, true)).toBe(true);
    expect(shouldShowUploadNotice(done, true)).toBe(true);
  });
  it('이상(needs_review)은 닫혀 있어도 표시한다', () => {
    expect(shouldShowUploadNotice(review, false)).toBe(true);
    expect(shouldShowUploadNotice(review, true)).toBe(true);
  });
  it('표시할 정보가 없으면 열어도 숨긴다', () => {
    expect(shouldShowUploadNotice(null, true)).toBe(false);
    expect(shouldShowUploadNotice(null, false)).toBe(false);
  });
});

const HEADER = { title: '명상', counselorName: '코치', myInitial: '나', elapsedSec: 10, totalSec: 600 } as never;
const CONN = { ok: true, icon: 'dot', label: '연결됨' } as never;

function mountTopBar(props: { expanded?: boolean; onToggle?: () => void; withToggle?: boolean }) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(
    <MemberTopBar header={HEADER} conn={CONN} onLeave={() => undefined}
      connToggle={props.withToggle === false ? undefined : { expanded: props.expanded ?? false, onToggle: props.onToggle ?? (() => undefined) }} />,
  ));
  return { host, root };
}

describe('연결 아이콘 토글 버튼(V-N02·N03·N08)', () => {
  it('버튼이고 aria-expanded 가 상태를 따른다, 라벨 유지', () => {
    const { host, root } = mountTopBar({ expanded: false });
    const btn = host.querySelector('[data-pz="conn"]') as HTMLElement;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-label')).toContain('연결됨');
    act(() => root.unmount());
    const b = mountTopBar({ expanded: true });
    expect((b.host.querySelector('[data-pz="conn"]') as HTMLElement).getAttribute('aria-expanded')).toBe('true');
    act(() => b.root.unmount());
  });
  it('탭하면 onToggle 이 호출된다', () => {
    const onToggle = vi.fn();
    const { host, root } = mountTopBar({ onToggle });
    act(() => { (host.querySelector('[data-pz="conn"]') as HTMLElement).click(); });
    expect(onToggle).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
  it('connToggle 이 없으면 기존처럼 표시 전용(버튼 아님)', () => {
    const { host, root } = mountTopBar({ withToggle: false });
    expect((host.querySelector('[data-pz="conn"]') as HTMLElement).tagName).not.toBe('BUTTON');
    act(() => root.unmount());
  });
});
