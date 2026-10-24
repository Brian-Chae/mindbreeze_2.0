import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { WaveformResponse, WaveformChannel } from '../../lib/api/data-center-measurement';
// segment마다 독립 dataKey를 부여해 동일 시간축에서 경계 연결을 차단한다.
// eslint-disable-next-line react-refresh/only-export-components
export function waveformSeries(data: WaveformResponse, channel: WaveformChannel) {
 return data.segments.map(segment => data.t_us.slice(segment.point_start, segment.point_end).flatMap((time, offset) => {
  const index = segment.point_start + offset;
  const gap = data.gaps.some(g => BigInt(time) >= BigInt(g.start_us) && BigInt(time) < BigInt(g.end_us));
  const point = { seconds: Number(time) / 1e6, value: gap ? null : channel.values?.[index] ?? null, min: gap ? null : channel.min?.[index] ?? null, max: gap ? null : channel.max?.[index] ?? null };
  const previous = offset > 0 ? data.t_us[index-1] : null;
  const crossed = previous !== null && data.gaps.some(g => BigInt(g.start_us) < BigInt(time) && BigInt(g.end_us) > BigInt(previous));
  return crossed ? [{ seconds: Number(time)/1e6, value:null, min:null, max:null }, point] : [point];
 }));
}
export function SignalWaveform({ data }: { data: WaveformResponse }) {
 if (data.availability !== 'available' || data.method === 'none') return <div className="dc-measure-empty"><h3>{data.signal_type.toUpperCase()} · 미수집 / 원파형 없음</h3><p>{data.unavailable_reason ?? data.availability}</p><p>파생 지표 보유 여부와 원파형 수집 여부는 다릅니다. 미수집을 0으로 표시하지 않습니다.</p></div>;
 return <div><p className="dc-measure-note">{data.nominal_rate_hz ?? '미확인'} Hz · {data.method === 'raw' ? '원본 해상도' : '최소·최대 요약선'} · 전체 {data.source_sample_count.toLocaleString()}개 중 {data.returned_count.toLocaleString()}개 표시 · 경과 초 기준</p>
 {data.channels.map(channel => {
 const series=waveformSeries(data,channel);
 const points=series.flatMap((segment,i)=>segment.map(point=>({ seconds:point.seconds, [`s${i}_value`]:point.value, [`s${i}_min`]:point.min, [`s${i}_max`]:point.max })));
 return <section className="dc-wave-channel" key={channel.name}><strong>{channel.name} · {channel.unit}</strong><div className="dc-wave-frame" role="img" aria-label={`${data.signal_type} ${channel.name} 파형, segment 사이 미연결`}>
 <ResponsiveContainer width="100%" height={185}><LineChart data={points} margin={{ left:0, right:10, top:10, bottom:5 }}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="seconds" type="number" allowDuplicatedCategory={false} domain={[Number(data.from_us ?? '0')/1e6, Number(data.to_us ?? '0')/1e6]} unit="초"/><YAxis width={45}/><Tooltip/>{series.flatMap((_,i)=>(data.method === 'raw' ? ['value'] : ['min','max']).map(key=><Line key={`${i}-${key}`} dataKey={`s${i}_${key}`} name={`${channel.name} · segment ${data.segments[i].segment_id} ${key}`} stroke={key==='max'?'#338c86':'#7a429f'} dot={points.length<20?{r:2}:false} connectNulls={false} isAnimationActive={false}/>))}</LineChart></ResponsiveContainer>
 </div></section>;
 })}
 {data.gaps.length > 0 && <div className="dc-measure-note">결측 구간 · 선으로 연결하지 않음{data.gaps.map((g,i)=><p key={i}>{Number(g.start_us)/1e6}–{Number(g.end_us)/1e6}초 · {g.reason}</p>)}</div>}</div>;
}
