const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** 세션 유형·제목에서 부모를 추측하지 않고 명시된 영역과 식별자만 해석한다. */
export function resolveLegacySessionPath(sessionId: string, response: unknown): string {
  if (!validId(sessionId) || !response || typeof response !== 'object' || Array.isArray(response)) return '/classes';
  if ('area' in response && response.area === 'meditation' && 'class_id' in response && validId(response.class_id)) {
    return `/classes/${encodeURIComponent(response.class_id)}/sessions/${encodeURIComponent(sessionId)}`;
  }
  // 현행 세션 응답에는 미제공이다. 명시적으로 가산된 경우에만 사용한다.
  if ('area' in response && response.area === 'counseling' && 'counseling_relationship_id' in response && validId(response.counseling_relationship_id)) {
    return `/counseling/${encodeURIComponent(response.counseling_relationship_id)}/sessions/${encodeURIComponent(sessionId)}`;
  }
  return '/classes';
}
