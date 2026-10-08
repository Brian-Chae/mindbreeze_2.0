/* SDD-192: MIND BREEZE 웹 푸시 서비스 워커.
 * - push: payload(title/body/data{deeplink,message_id}) → 시스템 알림은 항상 표시(tag 로 중복 병합).
 *   열려 있는 앱 창에는 알림 목록 갱신 메시지도 보낸다.
 * - notificationclick: 허용된 딥링크만 열어 창을 포커스한다.
 * payload 는 서버에서 비식별(이름·상담 내용 없음)로 만들어 온다.
 */

// 딥링크 허용 규칙 — lib/native/push.ts allowedPushDeeplink 와 동일하게 유지한다.
function allowedDeeplink(value) {
  if (typeof value !== 'string' || /[\\%\s\u0000-\u001f]/.test(value)) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  var path = value.split(/[?#]/, 1)[0];
  if (path.split('/').some(function (p) { return p === '.' || p === '..'; })) return null;
  var ok = path === '/app' || path.indexOf('/app/') === 0 || path === '/agent' ||
    path === '/chat' || path.indexOf('/chat/') === 0;
  return ok ? value : null;
}

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = {}; }
  var title = payload.title || 'MIND BREEZE';
  var data = payload.data || {};

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      clients.forEach(function (c) { if (c.postMessage) c.postMessage({ type: 'mb-push-received' }); });
      return self.registration.showNotification(title, {
        body: payload.body || '',
        icon: '/apple-touch-icon.png',
        tag: data.message_id || undefined,
        data: { deeplink: allowedDeeplink(data.deeplink) },
      });
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var path = allowedDeeplink(event.notification.data && event.notification.data.deeplink) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      var target = clients.find(function (c) { return 'focus' in c; });
      if (target) {
        target.postMessage({ type: 'mb-push-navigate', path: path });
        return target.focus();
      }
      return self.clients.openWindow(path);
    })
  );
});
