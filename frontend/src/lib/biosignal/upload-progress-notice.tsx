// SDD-260 UI — 종료 후 데이터 업로드 진행 안내. 화면 이탈 가능(비차단), 점수·판정은 표시하지 않는다.
import { describeUploadProgress, type UploadProgress } from '../measurement-web/upload-progress';

export function UploadProgressNotice({ progress }: { progress: UploadProgress | null }) {
  const view = describeUploadProgress(progress);
  if (!view) return null;
  return <div className="rs-notice" role="status" aria-live="polite" data-testid="upload-progress" data-kind={view.kind}>
    <div className="nt-toast rs-notice__toast">
      <div className="rs-notice__body"><b className="nt-toast__title">{view.text}</b></div>
    </div>
  </div>;
}
