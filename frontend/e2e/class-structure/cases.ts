export type ViewportName = 'mobile' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';
export type Viewport = { name: ViewportName; width: number; height: number };
export type CaseClass = 'R' | 'A' | 'X';

export const viewports: Viewport[] = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 834, height: 1194 },
  { name: 'tablet-landscape', width: 1194, height: 834 },
  { name: 'desktop', width: 1280, height: 720 },
];

type Screen = {
  id: string;
  prototype: string;
  role: 'host' | 'member';
  appPath: string;
  cases: Record<CaseClass, string[]>;
};

const screens: Screen[] = [
  { id: 'CH01', prototype: 'host-classes.html', role: 'host', appPath: '/classes', cases: { R: ['open', 'progress', 'idle', 'filter-draft', 'search', 'done', 'empty'], A: ['warn'], X: [] } },
  { id: 'CH02', prototype: 'host-classes.html', role: 'host', appPath: '/classes/class-1', cases: { R: ['overview', 'open', 'draft', 'done'], A: ['warn', 'rolling'], X: [] } },
  { id: 'CH03', prototype: 'host-classes.html', role: 'host', appPath: '/classes/class-1/sessions', cases: { R: ['table', 'timeline', 'cancelled'], A: ['makeup', 'rolling', 'pending', 'needs-reassign'], X: ['reassign', 'host-change', 'host-conflict', 'host-urgent', 'makeup-add'] } },
  { id: 'MC01', prototype: 'member-classes.html', role: 'member', appPath: '/app', cases: { R: ['class-open', 'class-soon', 'class-upcoming', 'counsel-next', 'only-class', 'only-counsel', 'empty'], A: ['invited'], X: [] } },
  { id: 'MC02', prototype: 'member-classes.html', role: 'member', appPath: '/app/classes', cases: { R: ['list', 'empty'], A: ['left-open', 'waitlist', 'invited'], X: ['apply'] } },
  { id: 'MC03', prototype: 'member-classes.html', role: 'member', appPath: '/app/classes/class-1', cases: { R: ['ongoing', 'cancelled'], A: ['makeup-planned', 'makeup-done', 'joined-mid', 'host-changed', 'rolling', 'completed', 'left'], X: ['makeup-pick'] } },
  { id: 'CN01', prototype: 'counseling.html', role: 'host', appPath: '/counseling', cases: { R: ['active', 'clients', 'search', 'search-empty', 'empty', 'net'], A: ['closed', 'closed-archived'], X: [] } },
  { id: 'CN02', prototype: 'counseling.html', role: 'host', appPath: '/counseling/temporary-relationship-1', cases: { R: ['active', 'ongoing', 'net'], A: ['recurring', 'closed', 'archived'], X: ['guest-pending', 'guest-active', 'guest-expired', 'closed-guest', 'scrubbed'] } },
  { id: 'CN07', prototype: 'counseling.html', role: 'member', appPath: '/app/counseling', cases: { R: ['list', 'empty', 'net'], A: ['list-open', 'invited'], X: [] } },
  { id: 'CN08', prototype: 'counseling.html', role: 'member', appPath: '/app/counseling/temporary-relationship-1', cases: { R: ['active', 'ready-now', 'no-next', 'net'], A: ['report-waiting', 'closed-me', 'closed-counselor'], X: [] } },
];

export type CaseManifestEntry = {
  screen_id: string;
  case_id: string;
  classification: CaseClass;
  role: Screen['role'];
  prototype_url: string;
  app_url: string;
  fixture_id: string;
  viewport?: Viewport;
  source_sha: 'runtime';
  app_sha: 'runtime';
  expected_copy: string[];
  allowed_difference: string[];
  excluded_reason?: string;
  reference_image?: string;
  actual_image?: string;
  diff_image?: string;
  overlay_image?: string;
  pixel_diff_ratio?: number;
  fit_violations?: string[];
  reviewer?: string;
  result: '미실행';
};

const excludedReasons: Record<string, string> = {
  'CH03:reassign': '회차 편성·변경 시트는 후속 기능',
  'CH03:host-change': '진행자 변경 시트는 후속 기능',
  'CH03:host-conflict': '진행자 충돌 시트는 후속 기능',
  'CH03:host-urgent': '긴급 진행자 변경 시트는 후속 기능',
  'CH03:makeup-add': '보강 회차 추가 시트는 후속 기능',
  'MC02:apply': '새 클래스 신청 시트는 후속 기능',
  'MC03:makeup-pick': '보강 일정 선택 시트는 후속 기능',
  'CN02:guest-pending': '비회원 입장 자격은 후속 기능',
  'CN02:guest-active': '비회원 재방문 자격은 후속 기능',
  'CN02:guest-expired': '비회원 자격 만료 흐름은 후속 기능',
  'CN02:closed-guest': '비회원 종결 정책은 후속 기능',
  'CN02:scrubbed': '개인정보 보관·삭제 정책은 후속 기능',
};

const entries: CaseManifestEntry[] = screens.flatMap((screen) =>
  (['R', 'A', 'X'] as const).flatMap((classification) =>
    screen.cases[classification].flatMap((caseId) => {
      const base = {
        screen_id: screen.id,
        case_id: caseId,
        classification,
        role: screen.role,
        prototype_url: `http://127.0.0.1:5440/class-structure-redesign/${screen.prototype}?${screen.prototype === 'counseling.html' ? `role=${screen.role}&` : ''}screen=${screen.id}&case=${caseId}${screen.id.startsWith('CH') ? '&k=mbsr' : ''}`,
        app_url: `http://127.0.0.1:5441${screen.appPath}?qaCase=${caseId}`,
        fixture_id: `${screen.role}-${classification.toLowerCase()}-${screen.id}-${caseId}`,
        source_sha: 'runtime' as const,
        app_sha: 'runtime' as const,
        expected_copy: [] as string[],
        allowed_difference: classification === 'A' ? ['verify.md 보정 규칙에 따른 미제공 데이터·기능 제거'] : [],
        ...(classification === 'X' ? { excluded_reason: excludedReasons[`${screen.id}:${caseId}`] } : {}),
        result: '미실행' as const,
      };
      if (classification === 'X') return [base];
      return viewports.map((viewport) => ({ ...base, viewport }));
    }),
  ),
);

export const caseManifest = entries;
export const visualEvidencePlan = {
  registeredCases: screens.reduce((sum, screen) => sum + screen.cases.R.length + screen.cases.A.length + screen.cases.X.length, 0),
  comparedCases: entries.filter((entry) => entry.classification !== 'X').length,
  excludedCases: entries.filter((entry) => entry.classification === 'X').length,
  sourceAppPairs: entries.filter((entry) => entry.classification !== 'X').length,
  diffImages: entries.filter((entry) => entry.classification !== 'X').length,
  overlayImages: entries.filter((entry) => entry.classification !== 'X').length,
  supplementaryStates: 10 * 6 * viewports.length,
  plannedAppCaptures: entries.filter((entry) => entry.classification !== 'X').length + 10 * 6 * viewports.length,
};

if (visualEvidencePlan.registeredCases !== 81 || visualEvidencePlan.comparedCases !== 276 || visualEvidencePlan.excludedCases !== 12 || visualEvidencePlan.plannedAppCaptures !== 516) {
  throw new Error(`시안 case/증거 산식 불일치: ${JSON.stringify(visualEvidencePlan)}`);
}
