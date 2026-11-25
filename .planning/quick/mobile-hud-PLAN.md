# Mobile HUD

## Objective

Keep the vehicle and track visible on phones while preserving access to telemetry, engineer questions and spoken Turkish explanations.

## Tasks

1. Fold telemetry into a touch-sized launcher and bounded, dismissible panel. Coordinate with the existing engineer-open state.
2. Show engineer questions and answers together in one mobile sheet. Preserve speech priority, request cancellation and vehicle context.
3. Compact the remaining phone controls and make visual driving notes optional; keep narration enabled by default.

## Ownership

- Telemetry: `src/features/telemetry-panel/` and its focused regression tests.
- Engineer: `src/features/engineer/` and its focused regression tests.
- Shared layout: `src/ui/`, `src/features/controls/`, responsive driving overrides and documentation.

## Verification

Run type and dependency checks, focused telemetry/engineer/narration tests and the production build. Check portrait phones, landscape phones, short keyboard-like viewports and desktop in the browser, including panel toggles, long answers, vehicle changes and narration. Inspect privacy and neutral commit metadata before publishing through the existing free setup.
