// 정의되지 않은 경로 진입 시 표시하는 전역 404 페이지

import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-surface-canvas flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <p className="font-mono text-sm text-brand-primary tracking-widest">404</p>
        <h1 className="font-display text-3xl font-light text-ink-primary">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="text-sm text-ink-secondary">
          주소가 잘못되었거나 이동된 페이지입니다.
        </p>
        <Link
          to="/"
          className="inline-flex h-11 items-center justify-center rounded-pill bg-brand-primary px-6 text-sm font-medium text-ink-on-brand hover:bg-brand-primary-hover"
        >
          홈으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
