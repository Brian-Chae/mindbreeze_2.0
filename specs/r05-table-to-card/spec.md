# SDD-R05 — 테이블 → 카드 전환 (모바일)

> 상위 기획: `.hermes/plans/2026-05-20_responsive-mobile.md`
> 선행 조건: R01 (AppShell 반응형) 완료 후

## 대상 페이지 (2개)

| 페이지 | 파일 | 문제 |
|---|---|---|
| UserManagementPage | `pages/admin/UserManagementPage.tsx` | `<table>` → 모바일 가로 overflow |
| AdminReviewDetailPage | `pages/admin/AdminReviewDetailPage.tsx` | `lg:grid-cols-3` 좌우 분할 → 모바일에서 세로 스택 |

## 작업 내용

### 1. UserManagementPage — 테이블 → 카드 뷰

**데스크톱 (md:)** — 기존 `<table>` 유지: `hidden md:block`

**모바일 (<md:)** — 카드 리스트: `block md:hidden`
```jsx
<div className="block md:hidden space-y-3">
  {users.map(u => (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold">{u.name}</span>
        <StatusBadge suspended={u.suspended} />
      </div>
      <div className="text-[13px] text-[#6F6F6F]">{u.email}</div>
      <div className="flex items-center justify-between mt-3">
        <RoleBadge role={u.role} />
        {u.suspended ? <UnsuspendBtn /> : <SuspendBtn />}
      </div>
    </div>
  ))}
</div>
```

### 2. AdminReviewDetailPage — 좌우 분할 → 세로 스택

현재: `grid grid-cols-1 lg:grid-cols-3`
- `lg:col-span-1` (기본정보) → 모바일에서 전체 너비
- `lg:col-span-2` (AI 분석·액션) → 모바일에서 전체 너비
- 이미 `grid-cols-1 lg:grid-cols-3` 적용되어 있어서 **변경 불필요**

AI 검증 카드 내부: 추출필드 `grid-cols-2` → 모바일에서도 유지 (2열은 괜찮음)

## 주의
- 테이블/카드 마크업만 분기, 데이터 로직은 동일하게 사용
- `hidden md:block` / `block md:hidden` 패턴으로 구현
- 기존 검색·필터·페이지네이션 공유
- `cd frontend && npm run build` 검증
