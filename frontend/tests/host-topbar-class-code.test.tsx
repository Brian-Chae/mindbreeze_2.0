// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HostTopBar } from '../src/components/class/player/host/HostTopBar';
let root: Root;
let container: HTMLDivElement;
const copy = vi.fn();
async function render(code: string | null = '0482', copied = false) {
  await act(async () => root.render(<HostTopBar title="명상" elapsedSec={131} durationMin={30} stats={{joined:0,total:1}} onEnd={()=>{}} accessCode={code} codeCopied={copied} onCopyCode={copy} />));
}
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);copy.mockClear();HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it('선행 0을 유지하고 기존 복사 액션과 성공 피드백을 연결한다',async()=>{await render();expect(container.querySelector('.hp-entry-code__digits')?.textContent).toBe('0482');await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="클래스 입장 코드 복사"]')!.click());expect(copy).toHaveBeenCalledOnce();await render('0482',true);expect(container.textContent).toContain('복사됨');});
it.each([null,'','123','ABC1','12345'])('유효 코드가 없으면 표시하지 않는다: %s',async code=>{await render(code);expect(container.querySelector('.hp-entry-code')).toBeNull();});
it('확대 열기·닫기와 코드 갱신을 지원한다',async()=>{await render();await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="클래스 입장 코드 크게 보기"]')!.click());expect(container.querySelector('dialog')?.hasAttribute('open')).toBe(true);await render('0099');expect(container.querySelector('dialog')?.textContent).toContain('0 0 9 9');await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="입장 코드 크게 보기 닫기"]')!.click());expect(container.querySelector('dialog')?.hasAttribute('open')).toBe(false);});

it('확정 두 줄 구조는 제목·코드와 시간·접속을 배치하고 닫기 버튼을 생략한다', async () => {
  await render();
  const header = container.querySelector('header[data-pz="top"]');
  expect(header).not.toBeNull();
  expect(header?.querySelector('h1')?.textContent).toBe('명상');
  expect(header?.querySelector('.hp-topbar-info .hp-entry-code__digits')?.textContent).toBe('0482');
  expect(header?.querySelector('.hp-topbar-info .hp-time')?.textContent).toContain('02:11');
  expect(header?.querySelector('.hp-topbar-stats')?.textContent).toBe('접속0/ 1');
  expect(header?.querySelector('[data-pz="btn-close"]')).toBeNull();
  expect(header?.querySelector('[data-pz="btn-end"]')?.textContent).toBe('종료');
});
it('코드와 접속 정보가 없어도 제목과 시간 및 종료를 유지한다', async () => {
  await act(async () => root.render(<HostTopBar title="예약 명상 · 10월 22일 오후 3:05" elapsedSec={131} durationMin={30} stats={null} onEnd={() => {}} />));
  expect(container.querySelector('h1')?.textContent).toBe('예약 명상 · 10월 22일 오후 3:05');
  expect(container.querySelector('.hp-entry-code')).toBeNull();
  expect(container.querySelector('.hp-topbar-stats')).toBeNull();
  expect(container.querySelector('.hp-time')?.textContent).toBe('02:11/ 30:00');
  expect(container.querySelector('[data-pz="btn-end"]')).not.toBeNull();
});
it('종료 비활성 상태를 유지하고 클릭을 실행하지 않는다', async () => {
  const end = vi.fn();
  await act(async () => root.render(<HostTopBar title="명상" elapsedSec={0} durationMin={30} stats={null} onEnd={end} endDisabled />));
  const button = container.querySelector<HTMLButtonElement>('[data-pz="btn-end"]')!;
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(end).not.toHaveBeenCalled();
});
