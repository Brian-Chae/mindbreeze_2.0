// 일회성 오프라인 시뮬레이터 드라이버. 제품 번들에는 포함하지 않는다.
(() => {
  const screen = localStorage.getItem('sdd236-screen') || 'login';
  const user = { id: 'sdd236-fixture', name: '테스트 회원', role: 'client', email: 'fixture@example.invalid', status: 'active', onboarding_completed: true };
  if (screen === 'login') localStorage.removeItem('mb_user');
  else { localStorage.setItem('mb_user', JSON.stringify(user)); localStorage.setItem('mb_native_refresh', 'offline-fixture'); }
  window.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    let result = {};
    if (/auth\/(refresh|login)/.test(url)) result = { access_token: 'offline-fixture', user };
    else if (/notifications/.test(url)) result = { notifications: [], unread: 0, total: 0 };
    else if (/chat.*rooms/.test(url)) result = { rooms: [] };
    else if (/classes/.test(url)) result = { classes: [], total: 0, items: [] };
    else if (/counsel/.test(url)) result = { relationships: [], counselors: [], items: [], total: 0 };
    else if (/report/.test(url)) result = { reports: [], total: 0, unread: 0, items: [] };
    else if (/sessions/.test(url)) result = { sessions: [], total: 0, items: [] };
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  window.WebSocket = class { constructor() { throw new Error('SDD236 offline'); } static CLOSED=3; static OPEN=1; };
  window.XMLHttpRequest = class { open() {} setRequestHeader() {} send() { this.onerror?.(new Error('SDD236 offline')); } abort() {} addEventListener() {} };
  const nativePromise = window.Capacitor?.nativePromise;
  if (nativePromise) window.Capacitor.nativePromise = (plugin, method, options) => {
    if (plugin === 'PushNotifications') return Promise.resolve({receive: 'denied'});
    return nativePromise(plugin, method, options);
  };
  const target = screen === 'home' ? '/app' : screen === 'class' ? '/design/class-player?role=member&case=M01' : '/login';
  history.replaceState(null, '', target);
  window.sdd236Measure = () => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;padding-top:env(safe-area-inset-top);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)';
    document.body.append(probe);
    const css = getComputedStyle(probe);
    const safe = {top: css.paddingTop, left: css.paddingLeft, right: css.paddingRight}; probe.remove();
    const rect = el => { const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; };
    return { screen, path: location.pathname, innerHeight, innerWidth, dpr: devicePixelRatio, safe,
      html: rect(document.documentElement), body: rect(document.body), root: rect(document.getElementById('root')),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      buttons: [...document.querySelectorAll('button')].filter(el=>el.getBoundingClientRect().height>0).slice(0,10).map(el=>({label:el.getAttribute('aria-label')||el.textContent.trim().slice(0,25),...rect(el)})) };
  };
})();
