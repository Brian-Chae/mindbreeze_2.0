import type { ReactNode } from 'react';
import { isNativeApp } from '../../lib/native/platform';
import { OPERATIONS_EMAIL, ORGANIZATION_WEB_URL } from '../../lib/legal-copy';
export function NativeOrganizationGate({ children }: { children: ReactNode }) {
  if (!isNativeApp()) return <>{children}</>;
  return <main className="mx-auto max-w-xl space-y-6 p-6 text-ink-primary">
    <h1 className="text-2xl font-bold">기관 도입 안내</h1>
    <p>기관 도입은 웹 또는 영업 문의로 진행됩니다</p>
    <p>웹 주소를 브라우저에 입력해 주세요: <span className="break-all">{ORGANIZATION_WEB_URL}</span></p>
    <a href={`mailto:${OPERATIONS_EMAIL}`} className="text-brand-primary underline">기관 도입 문의</a>
  </main>;
}
