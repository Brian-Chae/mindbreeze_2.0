// SDD-333: "블루투스가 꺼져 있어요" 안내 아래 버튼.
// Android: [블루투스 켜기] 시스템 창(거부 시 설정 화면). iOS: [블루투스 켜기] 시스템 알림 + 안 뜨면 제어센터 안내 + [설정 열기].
// 앱이 아니거나 구버전 앱(플러그인 없음)에서는 아무것도 그리지 않아 기존 문구만 보인다.
import { useState, type ReactNode } from 'react';
import { getPlatform, isNativeApp } from '../../lib/native/platform';
import { openAppSettings, requestEnableBluetooth, type EnableBluetoothResult } from '../../lib/native/app-settings';
import { bluetoothOffHelp } from '../../lib/native/bluetooth-notice';

interface Props {
  renderButton?: (props: { label: string; onClick: () => void; testId: string }) => ReactNode;
}

function DefaultButton({ label, onClick, testId }: { label: string; onClick: () => void; testId: string }) {
  return <button type="button" data-testid={testId} className="mp-pill mp-pill--primary mp-pill--block" onClick={onClick}>{label}</button>;
}

export function BluetoothOffShortcuts({ renderButton }: Props) {
  const [result, setResult] = useState<EnableBluetoothResult | null>(null);
  if (!isNativeApp()) return null;
  const platform = getPlatform();
  const draw = renderButton ?? ((p) => <DefaultButton {...p} />);
  const turnOn = (): void => { void requestEnableBluetooth().then(setResult); };
  const settings = (): void => { void openAppSettings(); };
  const asked = result !== null && result !== 'unavailable';
  return (
    <div className="mp-perm-shortcuts" data-testid="bluetooth-off-shortcuts">
      {draw({ label: '블루투스 켜기', onClick: turnOn, testId: 'bt-turn-on' })}
      {platform === 'ios' && asked ? draw({ label: '설정 열기', onClick: settings, testId: 'bt-open-settings' }) : null}
      {platform === 'ios' || asked ? <p className="mp-note" data-testid="bt-help">{bluetoothOffHelp(platform, asked)}</p> : null}
    </div>
  );
}
