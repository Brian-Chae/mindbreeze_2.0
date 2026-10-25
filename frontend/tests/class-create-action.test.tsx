// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { ClassCreateAction } from '../src/components/class/structure/class-create-action';
const api = vi.hoisted(() => ({ candidates: vi.fn() }));
vi.mock('../src/lib/api/class-scheduling', () => ({ schedulingApi: api }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'u1', role: 'counselor' } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let box: HTMLDivElement; let root: Root;
async function mount() { box = document.createElement('div'); document.body.append(box); root = createRoot(box); await act(async () => root.render(<MemoryRouter><ClassCreateAction /></MemoryRouter>)); }
afterEach(async () => { if (root) await act(async () => root.unmount()); box?.remove(); vi.clearAllMocks(); });
it('클래스가 없는 계정도 서버 편성이 활성일 때 새 마법사로 이동한다', async () => { api.candidates.mockResolvedValue({ instructors: [] }); await mount(); const links = [...box.querySelectorAll('a')]; expect(links.find(link => link.textContent === '새 클래스 만들기')?.getAttribute('href')).toBe('/classes/new'); expect(links.map(link => link.textContent)).toEqual(['지금 바로 시작', '새 클래스 만들기']); expect(links.map(link => link.dataset.headerAction)).toEqual(['secondary', 'primary']); });
it('스위치가 꺼졌거나 권한이 없으면 생성 CTA를 활성화하지 않는다', async () => { api.candidates.mockRejectedValue(new Error('disabled')); await mount(); expect(box.querySelector('a')).toBeNull(); expect(box.querySelector('button')?.disabled).toBe(true); });
