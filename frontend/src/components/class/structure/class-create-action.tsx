import { headerButtonClass } from '../../ui/styles';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../../stores/authStore';
import { schedulingApi } from '../../../lib/api/class-scheduling';

/** 기존 클래스가 없는 계정도 서버 스위치와 현재 개설 권한으로 판정한다. */
export function ClassCreateAction() {
  const user = useAuthStore(state => state.user);
  const userId = user?.id;
  const userRole = user?.role;
  const scope = `${userId}:${userRole}`;
  const [result, setResult] = useState<{ scope: string; enabled: boolean } | null>(null);
  useEffect(() => {
    if (!userRole || !['counselor', 'org_admin'].includes(userRole)) return;
    const controller = new AbortController(); let active = true;
    schedulingApi.candidates(undefined, controller.signal).then(() => {
      if (active) setResult({ scope, enabled: true });
    }).catch(() => { if (active) setResult({ scope, enabled: false }); });
    return () => { active = false; controller.abort(); };
  }, [scope, userRole]);
  const classes = headerButtonClass(true);
  return result?.scope === scope && result.enabled
    ? <div className="contents"><Link data-header-action="secondary" className={headerButtonClass()} to="/classes/now">지금 바로 시작</Link><Link data-header-action="primary" className={classes} to="/classes/new">새 클래스 만들기</Link></div>
    : <button className={`${classes} opacity-45`} disabled title="서버의 편성 활성화와 개설 권한을 확인해요">{result?.scope === scope ? '편성 준비 중' : '편성 확인 중…'}</button>;
}
