/**
 * P2-C — 표준 분포 모델 관리 패널 (SDD-036)
 *
 * platform_admin 전용. 현재 지표 스냅샷으로 baseline(눈 감기/뜨기) 저장 →
 * 표준 모델 계산(median+MAD) → 시스템 적용.
 * mindbreeze 라이트 토큰(#5F0080, bg-white, #F5EDFC) 사용.
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../lib/api/client';
import {
  activateModel,
  computeModel,
  createBaseline,
  deleteBaseline,
  listBaselines,
  listModels,
  type NormalizationBaselineDto,
  type NormalizationModelDto,
} from '../../lib/api/normalization-api';
import {
  CALIBRATION_METRIC_KEYS,
  countModelMetrics,
  getActiveModelCache,
  refreshActiveModel,
  setActiveModelFromDto,
  type CalibrationBaseline,
  type CalibrationMetricKey,
} from '../../lib/eeg/eegPersonalScore';
import type { BandRawIndices } from '../../types/playground';
import { PanelShell } from './PanelShell';

const PIPELINE_VERSION = 'v2-morlet7-linear-geomean';

const METRIC_LABEL: Record<CalibrationMetricKey, string> = {
  focusIndex: '집중 지수',
  relaxationIndex: '이완 지수',
  stressIndex: '스트레스 지수',
  totalNeuralActivity: '총 신경활동',
  faa: '좌우뇌 균형(FAA)',
  cognitiveLoad: '인지 부하',
  emotionalStability: '정서 안정성',
  autonomicStability: '자율신경 안정도(RMSSD)',
  sdnn: '심박 안정(SDNN)',
  avgHeartRate: '평균 심박',
  breathingStability: '호흡 안정',
};

interface Props {
  connected: boolean;
  rawIndices: BandRawIndices | null;
  heartRate: number | null;
  sdnn: number | null;
  rmssd: number | null;
}

function snapshotToBaseline(
  raw: BandRawIndices | null,
  extras: { rmssd: number | null; sdnn: number | null; heartRate: number | null },
): CalibrationBaseline {
  const finiteOrNull = (v: number | null | undefined): number | null =>
    v !== null && v !== undefined && Number.isFinite(v) ? v : null;

  return {
    focusIndex: finiteOrNull(raw?.focusIndex),
    relaxationIndex: finiteOrNull(raw?.relaxationIndex),
    stressIndex: finiteOrNull(raw?.stressIndex),
    totalNeuralActivity: finiteOrNull(raw?.totalNeuralActivity),
    // mindbreeze 파이프라인은 FAA 대신 hemisphericBalance(-1~1)를 제공
    faa: finiteOrNull(raw?.hemisphericBalance),
    cognitiveLoad: finiteOrNull(raw?.cognitiveLoad),
    emotionalStability: finiteOrNull(raw?.emotionalStability),
    autonomicStability: finiteOrNull(extras.rmssd !== null && extras.rmssd > 0 ? extras.rmssd : null),
    sdnn: finiteOrNull(extras.sdnn !== null && extras.sdnn > 0 ? extras.sdnn : null),
    avgHeartRate: finiteOrNull(
      extras.heartRate !== null && extras.heartRate > 0 ? extras.heartRate : null,
    ),
    breathingStability: null,
  };
}

function formatValue(v: number | null): string {
  if (v === null) return '--';
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

function formatDate(isoOrTs: string | number): string {
  const d = typeof isoOrTs === 'number' ? new Date(isoOrTs) : new Date(isoOrTs);
  if (Number.isNaN(d.getTime())) return '알 수 없음';
  return d.toLocaleString('ko-KR');
}

function hasAnySample(baseline: CalibrationBaseline): boolean {
  return CALIBRATION_METRIC_KEYS.some((k) => baseline[k] !== null);
}

export function NormalizationPanel({
  connected,
  rawIndices,
  heartRate,
  sdnn,
  rmssd,
}: Props) {
  const [closedBaseline, setClosedBaseline] = useState<CalibrationBaseline | null>(null);
  const [openBaseline, setOpenBaseline] = useState<CalibrationBaseline | null>(null);
  const [baselines, setBaselines] = useState<NormalizationBaselineDto[]>([]);
  const [models, setModels] = useState<NormalizationModelDto[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [birthDate, setBirthDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [, setCacheTick] = useState(0);

  const loadData = useCallback(async () => {
    try {
      const [bs, ms] = await Promise.all([listBaselines(), listModels()]);
      setBaselines(bs);
      setModels(ms);
      await refreshActiveModel();
      setCacheTick((t) => t + 1);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '목록을 불러오지 못했습니다.';
      setMessage(msg);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const captureStage = useCallback(
    (stage: 'closed' | 'open') => {
      if (!connected || !rawIndices) {
        setMessage('밴드가 연결되고 지표가 수신된 뒤 스냅샷을 캡처하세요.');
        return;
      }
      const baseline = snapshotToBaseline(rawIndices, { rmssd, sdnn, heartRate });
      if (!hasAnySample(baseline)) {
        setMessage('캡처할 유효 지표가 없습니다.');
        return;
      }
      if (stage === 'closed') setClosedBaseline(baseline);
      else setOpenBaseline(baseline);
      setMessage(
        stage === 'closed'
          ? '눈 감기(이완) 스냅샷을 캡처했습니다.'
          : '눈 뜨기(각성) 스냅샷을 캡처했습니다.',
      );
    },
    [connected, rawIndices, rmssd, sdnn, heartRate],
  );

  const uploadBaseline = useCallback(async () => {
    if (!closedBaseline || !openBaseline) return;
    if (!hasAnySample(closedBaseline) || !hasAnySample(openBaseline)) {
      setMessage('측정 샘플이 없어 기준을 생성할 수 없습니다. 다시 캡처하세요.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const created = await createBaseline({
        closed: closedBaseline,
        open: openBaseline,
        device_id: null,
        pipeline_version: PIPELINE_VERSION,
        gender: gender === '' ? null : gender,
        birth_date: birthDate === '' ? null : birthDate,
      });
      setMessage(
        `기준 데이터를 저장했습니다 (id=${String(created.id).slice(0, 8)}…). 표준 데이터베이스에 추가됨.`,
      );
      await loadData();
    } catch (err) {
      setMessage(
        err instanceof ApiError
          ? `기준 생성 실패 (${err.status}): ${err.message}`
          : `기준 생성 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [closedBaseline, openBaseline, gender, birthDate, loadData]);

  const handleDeleteBaseline = useCallback(
    async (id: string) => {
      if (!window.confirm('이 측정 데이터를 표준 데이터베이스에서 삭제하시겠습니까?')) return;
      setBusy(true);
      try {
        await deleteBaseline(id);
        setMessage('기준 데이터를 삭제했습니다.');
        await loadData();
      } catch (err) {
        setMessage(
          err instanceof ApiError
            ? `기준 삭제 실패 (${err.status}): ${err.message}`
            : `기준 삭제 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [loadData],
  );

  const handleComputeModel = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const model = await computeModel();
      setMessage(
        `표준 모델 v${model.version} 계산 완료 (n=${model.n_samples}). 시스템 적용 버튼으로 활성화하세요.`,
      );
      await loadData();
    } catch (err) {
      setMessage(
        err instanceof ApiError
          ? `표준 모델 계산 실패 (${err.status}): ${err.message}`
          : `표준 모델 계산 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [loadData]);

  const handleActivateModel = useCallback(async () => {
    if (!selectedModelId) {
      setMessage('시스템 적용할 표준 모델을 목록에서 선택하세요.');
      return;
    }
    setBusy(true);
    try {
      const active = await activateModel(selectedModelId);
      setActiveModelFromDto(active);
      setCacheTick((t) => t + 1);
      setMessage(`표준 모델 v${active.version}을 시스템에 적용했습니다 (n=${active.n_samples}).`);
      await loadData();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : '시스템 적용에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }, [selectedModelId, loadData]);

  const panelState = !connected ? 'disconnected' : rawIndices ? 'ready' : 'waiting';
  const activeModel = getActiveModelCache();
  const activeMetricsCount = countModelMetrics(activeModel);
  const metricTotal = CALIBRATION_METRIC_KEYS.length;
  const normLabel = activeModel
    ? `표준 모델 v${activeModel.version} (n=${activeModel.n_samples}, ${activeMetricsCount}/${metricTotal} 지표)`
    : '코호트 상수 (SDD-040 §A2 B0)';

  return (
    <PanelShell
      title="P2-C · 표준 분포 모델 관리"
      subtitle="측정 스냅샷 → 표준 DB → 표준 모델(median+MAD) 계산 → 시스템 적용"
      state={panelState}
    >
      <div className="space-y-4">
        <p className="text-xs text-[#6F6F6F]">
          현재 정규화 기준:{' '}
          <span className={activeModel ? 'font-medium text-[#1F8A5B]' : 'font-medium text-[#8A6B1F]'}>
            {normLabel}
          </span>
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-[#6F6F6F]">
            측정자 성별
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as 'male' | 'female' | '')}
              disabled={busy}
              className="rounded-md border border-[#EFEFEF] bg-white px-2 py-1.5 text-sm text-[#1F1F1F] disabled:opacity-50"
            >
              <option value="">선택</option>
              <option value="male">남성</option>
              <option value="female">여성</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#6F6F6F]">
            측정자 생년월일
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              disabled={busy}
              className="rounded-md border border-[#EFEFEF] bg-white px-2 py-1.5 text-sm text-[#1F1F1F] disabled:opacity-50"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              { stage: 'closed' as const, title: '1. 눈 감기(이완)', baseline: closedBaseline },
              { stage: 'open' as const, title: '2. 눈 뜨기(각성)', baseline: openBaseline },
            ] as const
          ).map(({ stage, title, baseline }) => (
            <div key={stage} className="rounded-xl border border-[#EFEFEF] bg-[#F5EDFC]/p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#1F1F1F]">{title}</span>
                {baseline && (
                  <span className="rounded bg-[#E6F8F3] px-1.5 py-0.5 text-[11px] text-[#1F8A5B]">
                    캡처됨
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-[#6F6F6F]">
                {stage === 'closed'
                  ? '눈을 감고 이완한 상태에서 현재 지표를 스냅샷으로 저장합니다.'
                  : '눈을 뜨고 각성한 상태에서 현재 지표를 스냅샷으로 저장합니다.'}
              </p>
              <button
                type="button"
                onClick={() => captureStage(stage)}
                disabled={!connected || !rawIndices || busy}
                className="mt-3 rounded-lg bg-[#5F0080] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4B0066] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {baseline ? '다시 캡처' : '현재 지표 캡처'}
              </button>
            </div>
          ))}
        </div>

        {(closedBaseline || openBaseline) && (
          <BaselineTable closed={closedBaseline} open={openBaseline} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void uploadBaseline()}
            disabled={busy || !closedBaseline || !openBaseline}
            className="rounded-lg bg-[#1F8A5B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#19724B] disabled:cursor-not-allowed disabled:opacity-40"
          >
            측정 데이터 저장 (표준 DB)
          </button>
          <button
            type="button"
            onClick={() => void handleComputeModel()}
            disabled={busy || baselines.length < 5}
            className="rounded-lg bg-[#5F0080] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4B0066] disabled:cursor-not-allowed disabled:opacity-40"
            title={baselines.length < 5 ? '기준 데이터 최소 5개 필요' : '전체 데이터로 분포 계산'}
          >
            표준 모델 계산
          </button>
          <button
            type="button"
            onClick={() => void handleActivateModel()}
            disabled={busy || !selectedModelId}
            className="rounded-lg border border-[#C9B0E8] bg-[#F5EDFC] px-3 py-1.5 text-xs font-medium text-[#5F0080] hover:bg-[#EBDEF7] disabled:cursor-not-allowed disabled:opacity-40"
          >
            시스템 적용
          </button>
        </div>

        {baselines.length < 5 && (
          <p className="text-[11px] text-[#8A6B5F]">
            표준 모델 계산은 기준 데이터가 최소 5개 이상일 때 가능합니다 (현재 {baselines.length}개).
          </p>
        )}

        {message && <p className="text-xs text-[#6F6F6F]">{message}</p>}

        <ModelList
          items={models}
          selectedId={selectedModelId}
          busy={busy}
          onSelect={setSelectedModelId}
        />

        <BaselineList
          items={baselines}
          busy={busy}
          onDelete={(id) => void handleDeleteBaseline(id)}
        />
      </div>
    </PanelShell>
  );
}

function BaselineTable({
  closed,
  open,
}: {
  closed: CalibrationBaseline | null;
  open: CalibrationBaseline | null;
}) {
  return (
    <div className="overflow-x-auto">
      <h3 className="mb-2 text-xs font-semibold text-[#5F0080]">측정 스냅샷</h3>
      <table className="w-full min-w-[420px] text-left text-xs">
        <thead className="text-[#6F6F6F]">
          <tr>
            <th className="py-1 pr-2 font-medium">지표</th>
            <th className="py-1 pr-2 font-medium">눈 감기</th>
            <th className="py-1 pr-2 font-medium">눈 뜨기</th>
          </tr>
        </thead>
        <tbody className="text-[#1F1F1F]">
          {CALIBRATION_METRIC_KEYS.map((key) => (
            <tr key={key} className="border-t border-[#EFEFEF]">
              <td className="py-1 pr-2 text-[#6F6F6F]">{METRIC_LABEL[key]}</td>
              <td className="py-1 pr-2 tabular-nums">{formatValue(closed?.[key] ?? null)}</td>
              <td className="py-1 pr-2 tabular-nums">{formatValue(open?.[key] ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelList({
  items,
  selectedId,
  busy,
  onSelect,
}: {
  items: NormalizationModelDto[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#EFEFEF] bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold text-[#5F0080]">표준 모델 목록 ({items.length})</h3>
      {items.length === 0 ? (
        <p className="text-xs text-[#6F6F6F]">계산된 표준 모델이 없습니다.</p>
      ) : (
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead className="text-[#6F6F6F]">
            <tr>
              <th className="py-1 pr-2 font-medium">선택</th>
              <th className="py-1 pr-2 font-medium">버전</th>
              <th className="py-1 pr-2 font-medium">n_samples</th>
              <th className="py-1 pr-2 font-medium">지표 수</th>
              <th className="py-1 pr-2 font-medium">생성 시각</th>
              <th className="py-1 pr-2 font-medium">상태</th>
            </tr>
          </thead>
          <tbody className="text-[#1F1F1F]">
            {items.map((item) => {
              const metricCount = countModelMetrics(item);
              return (
                <tr key={item.id} className="border-t border-[#EFEFEF]">
                  <td className="py-1.5 pr-2">
                    <input
                      type="radio"
                      name="model-select"
                      checked={String(selectedId) === String(item.id)}
                      disabled={busy}
                      onChange={() => onSelect(String(item.id))}
                    />
                  </td>
                  <td className="py-1.5 pr-2 font-mono text-[11px]">v{item.version}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{item.n_samples}</td>
                  <td className="py-1.5 pr-2 tabular-nums">
                    {metricCount}/{CALIBRATION_METRIC_KEYS.length}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums">{formatDate(item.created_at)}</td>
                  <td className="py-1.5 pr-2">
                    {item.is_active ? (
                      <span className="rounded bg-[#E6F8F3] px-1.5 py-0.5 text-[10px] text-[#1F8A5B]">
                        active
                      </span>
                    ) : (
                      <span className="text-[#C0C0C0]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BaselineList({
  items,
  busy,
  onDelete,
}: {
  items: NormalizationBaselineDto[];
  busy: boolean;
  onDelete: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-xl border border-[#EFEFEF] bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold text-[#5F0080]">
        표준 데이터베이스 (측정 기록, {items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-xs text-[#6F6F6F]">저장된 측정 데이터가 없습니다.</p>
      ) : (
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="text-[#6F6F6F]">
            <tr>
              <th className="py-1 pr-2 font-medium">id</th>
              <th className="py-1 pr-2 font-medium">성별</th>
              <th className="py-1 pr-2 font-medium">생년월일</th>
              <th className="py-1 pr-2 font-medium">생성 시각</th>
              <th className="py-1 pr-2 font-medium">상세</th>
              <th className="py-1 pr-2 font-medium" />
            </tr>
          </thead>
          <tbody className="text-[#1F1F1F]">
            {items.map((item) => {
              const itemId = String(item.id);
              const isExpanded = expandedId === itemId;
              return (
                <Fragment key={item.id}>
                  <tr className="border-t border-[#EFEFEF]">
                    <td className="max-w-[90px] truncate py-1.5 pr-2 font-mono text-[11px] text-[#6F6F6F]">
                      {itemId.slice(0, 8)}
                    </td>
                    <td className="py-1.5 pr-2">
                      {item.gender === 'male' ? '남성' : item.gender === 'female' ? '여성' : '--'}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums">{item.birth_date ?? '--'}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{formatDate(item.created_at)}</td>
                    <td className="py-1.5 pr-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setExpandedId(isExpanded ? null : itemId)}
                        className="rounded border border-[#EFEFEF] px-2 py-0.5 text-[11px] text-[#5F0080] hover:bg-[#F5EDFC] disabled:opacity-40"
                      >
                        {isExpanded ? '접기' : '상세'}
                      </button>
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(itemId)}
                        className="rounded border border-[#F5C6C2] px-2 py-0.5 text-[11px] text-[#B3261E] hover:bg-[#FDECEC] disabled:opacity-40"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-t border-[#EFEFEF] bg-[#F5EDFC]">
                      <td colSpan={6} className="py-3 pr-2">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 text-[11px] font-semibold text-[#5F0080]">
                              눈 감기 (이완)
                            </p>
                            <table className="w-full text-[11px]">
                              <tbody>
                                {CALIBRATION_METRIC_KEYS.map((k) => (
                                  <tr key={k}>
                                    <td className="py-0.5 pr-2 text-[#6F6F6F]">{METRIC_LABEL[k]}</td>
                                    <td className="py-0.5 text-right tabular-nums">
                                      {formatValue(item.closed?.[k] ?? null)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] font-semibold text-[#5F0080]">
                              눈 뜨기 (각성)
                            </p>
                            <table className="w-full text-[11px]">
                              <tbody>
                                {CALIBRATION_METRIC_KEYS.map((k) => (
                                  <tr key={k}>
                                    <td className="py-0.5 pr-2 text-[#6F6F6F]">{METRIC_LABEL[k]}</td>
                                    <td className="py-0.5 text-right tabular-nums">
                                      {formatValue(item.open?.[k] ?? null)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
