import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthShell from '../../components/auth/AuthShell';
import GoogleLoginButton from '../../components/auth/GoogleLoginButton';
import AppleLoginButton from '../../components/auth/AppleLoginButton';
import { useSocialSignupStore, type SocialCredential } from '../../stores/social-signup-store';
import { resolvePostLoginPath } from '../../lib/auth-routing';
export default function RegisterStartPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const begin = useSocialSignupStore((s) => s.begin);
  const token = params.get('token') ?? undefined;
  function confirm(credential: SocialCredential) { begin({ credential, inviteToken: token, role: 'client', rememberMe: true }); navigate('/signup/confirm'); }
  return <AuthShell variant="member" title="회원 가입"><main className="space-y-5">
    <h2 className="text-2xl font-semibold">나를 위한 시간,<br />여기서 시작해요</h2>
    <p className="text-sm text-white/80">사용할 계정을 선택해 주세요.</p>
    <GoogleLoginButton inviteToken={token} onNeedsSignupInfo={confirm} onSuccess={(user) => user && navigate(resolvePostLoginPath(user))} />
    <AppleLoginButton inviteToken={token} role="client" onNeedsSignupInfo={(_code, credential) => credential && confirm(credential)} onSuccess={(user) => user && navigate(resolvePostLoginPath(user))} />
    <p className="text-xs text-white/80">Apple은 iOS 앱에서 이용할 수 있어요.</p>
    <div className="flex items-center gap-4 text-xs text-white/80"><span className="h-px flex-1 bg-white/20" />또는<span className="h-px flex-1 bg-white/20" /></div>
    <Link to={`/register/client${params.size ? `?${params}` : ''}`} className="flex h-[52px] items-center justify-center rounded-full bg-[#5F0080] font-semibold">이메일로 가입하기</Link>
    <p className="text-center text-sm">이미 계정이 있나요? <Link to="/login?role=client" className="underline">로그인</Link></p>
  </main></AuthShell>;
}
