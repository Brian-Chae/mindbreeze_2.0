import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { detectBetaPlatform, fetchBetaConfig, formatBytes, type BetaConfig } from '../lib/beta/beta-config';

/** 현장 QR 베타 랜딩 (SDD-254). QR 하나로 들어와 기기에 맞는 설치 경로를 안내한다. */
export default function BetaLandingPage() {
  const platform = useMemo(() => detectBetaPlatform(navigator.userAgent, navigator.maxTouchPoints), []);
  const [cfg, setCfg] = useState<BetaConfig | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchBetaConfig().then((c) => {
      if (cancelled) return;
      if (c) setCfg(c); else setFailed(true);
    });
    return () => { cancelled = true; };
  }, []);

  const support = cfg?.support.email || 'admin-mindbreeze@looxidlabs.com';

  return (
    <main className="mx-auto min-h-screen max-w-md bg-[#FAF8FB] px-5 py-8 text-[#2B2B2B]">
      <h1 className="text-2xl font-bold text-[#5F0080]">마인드브리즈 베타 앱 받기</h1>
      <p className="mt-2 text-sm">현장 클래스 참여를 위한 베타 버전이에요. 아래 순서대로 설치해 주세요.</p>

      {!cfg && !failed && <p role="status" className="mt-6 text-sm">설치 정보를 불러오는 중이에요.</p>}
      {failed && (
        <p role="alert" className="mt-6 rounded bg-white p-4 text-sm">
          설치 정보를 불러오지 못했어요. 잠시 후 다시 시도하거나 {support} 로 문의해 주세요.
        </p>
      )}
      {cfg && !cfg.landingEnabled && (
        <p className="mt-6 rounded bg-white p-4 text-sm">지금은 베타 배포가 닫혀 있어요. 담당자에게 문의해 주세요.</p>
      )}

      {cfg && cfg.landingEnabled && platform === 'desktop' && (
        <section className="mt-6 rounded bg-white p-4 text-sm">
          <h2 className="font-semibold">휴대폰으로 다시 스캔해 주세요</h2>
          <p className="mt-2">앱은 휴대폰(iPhone·Android)에서 설치해요. 휴대폰 카메라로 QR을 다시 찍어 주세요.</p>
          <p className="mt-2"><Link className="text-[#5F0080] underline" to="/login">웹으로 이용하기</Link></p>
        </section>
      )}

      {cfg && cfg.landingEnabled && platform === 'ios' && (
        <section className="mt-6 rounded bg-white p-4 text-sm" aria-labelledby="ios-title">
          <h2 id="ios-title" className="font-semibold">iPhone·iPad 설치 (TestFlight)</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>TestFlight 앱이 없다면 App Store에서 먼저 설치해요.</li>
            <li>아래 버튼으로 베타 초대를 열고 &quot;수락&quot; → &quot;설치&quot;를 눌러요.</li>
            <li>설치 후 마인드브리즈를 열고 마이크·블루투스 권한을 허용해 주세요.</li>
          </ol>
          {cfg.ios.testflightUrl ? (
            <a className="mt-4 block rounded bg-[#5F0080] px-4 py-3 text-center font-medium text-white" href={cfg.ios.testflightUrl}>
              TestFlight에서 열기
            </a>
          ) : (
            <p role="status" className="mt-4 rounded bg-[#F3E9F7] p-3">iOS 베타 링크를 준비 중이에요. 담당자에게 문의해 주세요.</p>
          )}
        </section>
      )}

      {cfg && cfg.landingEnabled && platform === 'android' && (
        <section className="mt-6 rounded bg-white p-4 text-sm" aria-labelledby="android-title">
          <h2 id="android-title" className="font-semibold">Android 설치 (APK)</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>아래 버튼으로 앱 파일을 내려받아요{cfg.android.sizeBytes > 0 ? ` (${formatBytes(cfg.android.sizeBytes)})` : ''}.</li>
            <li>&quot;출처를 알 수 없는 앱 설치&quot;를 묻는 창이 나오면 <b>설정 → 이 출처 허용</b>을 켜요.</li>
            <li>다시 파일을 열어 <b>설치</b>를 눌러요. &quot;Play 프로텍트&quot; 경고가 나오면 <b>그래도 설치</b>를 선택해요.</li>
            <li>설치 후 마이크·블루투스 권한을 허용해 주세요.</li>
          </ol>
          {cfg.android.apkUrl ? (
            <>
              <a className="mt-4 block rounded bg-[#5F0080] px-4 py-3 text-center font-medium text-white" href={cfg.android.apkUrl} download>
                앱 내려받기{cfg.android.versionName ? ` (v${cfg.android.versionName})` : ''}
              </a>
              {cfg.android.sha256 && (
                <p className="mt-2 break-all text-xs text-[#666]">파일 확인값(SHA-256): {cfg.android.sha256}</p>
              )}
            </>
          ) : (
            <p role="status" className="mt-4 rounded bg-[#F3E9F7] p-3">Android 설치 파일을 준비 중이에요. 담당자에게 문의해 주세요.</p>
          )}
          <p className="mt-3 text-xs text-[#666]">이미 설치한 앱이 있다면 새 파일로 그대로 덮어 설치돼요(데이터 유지).</p>
        </section>
      )}

      <section className="mt-6 space-y-2 text-xs text-[#555]">
        <p>이 앱은 베타 버전이에요. iOS에서 TestFlight를 사용하면 Apple에 충돌·사용 정보가 공유돼요.</p>
        <p>
          <Link className="underline" to="/terms">이용약관</Link> · <Link className="underline" to="/privacy">개인정보처리방침</Link>
        </p>
        <p>설치가 막히면 {support} 로 알려 주세요.</p>
      </section>
    </main>
  );
}
