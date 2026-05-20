# MIND BREEZE — Operator App UI Kit

A click-through recreation of the **MIND BREEZE Operator** app — the iPad-first interface a meditation instructor/counsellor uses to run sessions.

Design canvas: **1366 × 1024** (iPad Pro 11", landscape).

## Files

- `index.html` — assembled click-through. Defaults to the Session screen; navigate via the left rail.
- `AppShell.jsx` — chrome (left rail, top bar, status pill area)
- `SignIn.jsx` — Sign-in screen (Google / Apple SSO buttons centred over warm photography)
- `SessionList.jsx` — list of upcoming/past meditation classes
- `SessionRunning.jsx` — live session screen with BLE pill, seat numbers grid, action buttons
- `DeviceModal.jsx` — Link Band registration modal

## What we faithfully recreated (source: mind-breeze-app codebase)

- `Color.ts` palette → see token usage
- `Buttons.tsx` variants → `Button` component
- `Texts.tsx` ramp → `Text16` / `Text20` / `Text24` / `Text36`
- `ScreenWrapper`, `Center`, `Row`, `Padding` → layout primitives
- Real SVG icons from `assets/icons/`

## What we simplified / left out

- React Navigation routing — we use plain local state instead
- Live BLE state — represented as a static status pill
- The waiting / consent / "guest" flows — out of scope for a kit demo (covered by the codebase repo)
