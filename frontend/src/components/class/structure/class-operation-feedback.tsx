import { operationInput, type useClassOperation } from './class-operation-state';

export function OperationFeedback({ operation, admin = false }: { operation: ReturnType<typeof useClassOperation>; admin?: boolean }) {
  return <>{admin && <label className="block space-y-2 text-sm">센터 관리자 변경 사유<textarea className={operationInput} value={operation.reason} maxLength={1000} onChange={e => operation.setReason(e.target.value)} /></label>}{operation.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{operation.error}</p>}{operation.message && <p role="status" className="text-sm text-emerald-800">{operation.message}</p>}</>;
}
