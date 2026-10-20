import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { TermArea } from '../../../lib/terms';
import { isCounselingEnabled } from '../../../lib/feature-flags';

export interface ReadStateViewProps {
  status: 'loading' | 'empty' | 'error' | 'not_found' | 'success';
  area?: TermArea;
  backTo?: string;
  onRetry?: () => void;
  children?: ReactNode;
}

/** 오류 객체를 받지 않아 서버 원문이 사용자 안내로 전파되지 않는다. */
export function ReadStateView({ status, area = 'meditation', backTo, onRetry, children }: ReadStateViewProps) {
  if (status === 'success') return <>{children}</>;
  const message = status === 'loading' ? '불러오는 중이에요'
    : status === 'empty' ? area === 'counseling' ? '아직 상담이 없어요' : '아직 클래스가 없어요'
      : status === 'not_found' ? '내용을 찾을 수 없어요' : '목록을 불러오지 못했어요';
  return (
    <div className="cs-read-state" role={status === 'error' ? 'alert' : 'status'} aria-busy={status === 'loading'}>
      <p>{message}</p>
      {status === 'error' && onRetry && <button type="button" onClick={onRetry}>다시 시도</button>}
      {status === 'not_found' && <Link to={backTo ?? (area === 'counseling' && isCounselingEnabled() ? '/counseling' : '/classes')}>목록으로 돌아가기</Link>}
    </div>
  );
}

export interface ReadFieldProps { value?: string | number | boolean | null }

/** 0·false는 제공된 값으로 표시하며 null·undefined만 누락으로 취급한다. */
export function ReadField({ value }: ReadFieldProps) {
  return <span>{value == null ? '데이터 없음' : typeof value === 'boolean' ? value ? '예' : '아니요' : value}</span>;
}
