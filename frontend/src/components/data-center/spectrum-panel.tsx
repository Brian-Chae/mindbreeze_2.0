import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { SpectrumResponse } from '../../lib/api/data-center-measurement';
export function SpectrumPanel({ data }: { data: SpectrumResponse }) {
 return <section className="dc-spectrum"><h3>파워 스펙트럼 (PSD)</h3>{!data.computable ? <p>계산 불가 · {data.reason ?? '연속된 2–30초 EEG 구간 필요'}</p> : <><p className="dc-measure-note">{data.method} · {data.unit} · Welch {data.window_sec}초 / overlap {data.overlap*100}% · 선택 구간 서버 계산</p>{data.channels.map(channel=><div key={channel.name}><strong>{channel.name}</strong><ResponsiveContainer width="100%" height={200}><LineChart data={data.freq_hz.map((hz,i)=>({ hz, psd:channel.psd[i] }))}><XAxis dataKey="hz" unit=" Hz"/><YAxis width={45}/><Tooltip/><Line dataKey="psd" dot={false} stroke="#338c86" isAnimationActive={false}/></LineChart></ResponsiveContainer></div>)}</>}</section>;
}
