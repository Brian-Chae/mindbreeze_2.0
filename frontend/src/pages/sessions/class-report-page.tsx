import { useParams } from 'react-router-dom';
import { ClassReportLoader } from '../../components/class-report/ClassNarrativeReport';
export default function ClassReportPage() {
  const { id } = useParams<{ id:string }>();
  if(!id) return <p>회차를 찾을 수 없어요.</p>;
  return <ClassReportLoader sessionId={id}/>;
}
