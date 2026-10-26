import { WellnessNotice } from '../components/legal/wellness-notice';
export function MeasurementGuidePage() {
  return <main className="mx-auto max-w-3xl space-y-6 p-6 text-ink-primary">
    <h1 className="text-2xl font-bold">측정 방법과 한계</h1><WellnessNotice />
    <p>LINK BAND의 2채널 이마 EEG에서 얻은 주파수 대역별 신호와 비율을 바탕으로 집중도·이완도·스트레스의 흐름을 추정합니다. 이 지표는 생각이나 감정을 직접 읽는 값이 아닙니다.</p>
    <p>개인차, 센서 착용 위치와 접촉 상태, 눈 깜빡임, 움직임, 주변 환경에 따라 결과가 달라질 수 있습니다. 데이터가 부족한 구간은 해석을 보류하고 당시의 느낌과 함께 살펴보세요.</p>
    <p>수치의 상승·하강만으로 건강 상태를 판단할 수 없으며 의학적 판단의 근거로 사용할 수 없습니다. LINK BAND 착용과 뇌파 수집 동의는 선택입니다.</p>
    <a href="/crisis-help">긴급 도움 안내</a>
  </main>;
}
