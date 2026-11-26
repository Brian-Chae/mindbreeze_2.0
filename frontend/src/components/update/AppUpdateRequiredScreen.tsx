// SDD-335 — 구버전 앱 수업 입장 차단 화면. 스토어 업데이트로 유도한다(닫기 없음).
import { RefreshCw } from 'lucide-react';
import { FlowStateScreen } from '../class/flow/shared/FlowStateScreen';

interface Props {
  installed: string;
  required: string;
  storeUrl: string;
  onHome: () => void;
}

export function AppUpdateRequiredScreen({ installed, required, storeUrl, onHome }: Props) {
  return (
    <FlowStateScreen
      icon={<RefreshCw size={28} />}
      warn
      heading="앱을 업데이트해 주세요"
      lead={<>이 버전({installed})에서는 수업 측정이 정상적으로 되지 않아요.<br />스토어에서 최신 버전({required} 이상)으로 업데이트한 뒤 다시 입장해 주세요.</>}
      info={[{ label: '설치된 버전', value: installed || '-' }, { label: '필요한 버전', value: `${required} 이상` }]}
      note="업데이트 후에도 같은 수업에 바로 입장할 수 있어요."
      primary={{ label: '스토어에서 업데이트', onClick: () => { window.open(storeUrl, '_blank', 'noopener'); } }}
      secondary={{ label: '홈으로', onClick: onHome }}
    />
  );
}
