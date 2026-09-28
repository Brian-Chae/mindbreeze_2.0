// SDD-095: 클래스 템플릿 · 복제 API 계약 테스트

import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../src/lib/api/client';
import {
  createSessionFromTemplate,
  duplicateSession,
  listSessionTemplates,
  saveSessionAsTemplate,
} from '../src/lib/api/session';

vi.mock('../src/lib/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
  refreshAccessToken: vi.fn(),
  tokenStorage: { getAccess: vi.fn(() => 'token') },
}));

beforeEach(() => vi.clearAllMocks());

it('복제는 POST /sessions/{id}/duplicate 로 호출하고 빈 payload 를 보낸다', async () => {
  await duplicateSession('session-1');
  expect(apiClient.post).toHaveBeenCalledWith('/sessions/session-1/duplicate', {});
});

it('복제 시 일정/제목/force 오버라이드가 그대로 전달된다', async () => {
  const scheduledAt = '2026-10-01T05:00:00.000Z';
  await duplicateSession('session-1', { scheduled_at: scheduledAt, title: '복제본', force: true });
  expect(apiClient.post).toHaveBeenCalledWith('/sessions/session-1/duplicate', {
    scheduled_at: scheduledAt,
    title: '복제본',
    force: true,
  });
});

it('복제 대상 id 는 경로 인코딩을 거친다', async () => {
  await duplicateSession('a/b');
  expect(apiClient.post).toHaveBeenCalledWith('/sessions/a%2Fb/duplicate', {});
});

it('템플릿 저장은 POST /sessions/{id}/save-as-template 로 제목을 함께 보낸다', async () => {
  await saveSessionAsTemplate('session-1');
  expect(apiClient.post).toHaveBeenCalledWith('/sessions/session-1/save-as-template', {
    title: null,
  });

  await saveSessionAsTemplate('session-1', '주간 명상');
  expect(apiClient.post).toHaveBeenLastCalledWith('/sessions/session-1/save-as-template', {
    title: '주간 명상',
  });
});

it('템플릿 목록은 GET /sessions/templates 로 조회한다', async () => {
  await listSessionTemplates();
  expect(apiClient.get).toHaveBeenCalledWith('/sessions/templates');
});

it('템플릿에서 시작은 복제 경로를 재사용한다', async () => {
  await createSessionFromTemplate('template-1', { title: '이번 주 수업' });
  expect(apiClient.post).toHaveBeenCalledWith('/sessions/template-1/duplicate', {
    title: '이번 주 수업',
  });
});
