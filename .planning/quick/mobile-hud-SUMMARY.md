# Mobile HUD result

## Behavior

- Phone telemetry starts as a 44px launcher and opens a scrollable sheet capped at 42% of the viewport height.
- Questions and engineer answers share one dismissible sheet capped at 45% of the visible viewport. Opening either sheet closes the other.
- The 3D stage resizes above the actual sheet, keeping the vehicle visible instead of covering it with the requested information. Closing the sheet restores the scene.
- Narration remains enabled by default. Visual driving notes start folded on phones; the Notlar button reveals them. Camera choices use a compact disclosure.
- Phone controls use safe-area gutters. The engineer sheet follows visual viewport changes, uses a 16px input and dismisses the software keyboard after submission.
- Manual takeover folds mobile sheets; telemetry does not cover touch pedals. Desktop layout remains unchanged.

## Verification

- All 71 focused telemetry, engineer, narration, control and vehicle-context regression tests passed across seven files. New cases cover mobile disclosures, keyboard viewport changes and manual takeover.
- Application, worker and test/configuration TypeScript projects were checked; dependency boundaries and the production build passed.
- Browser checks used measured CSS viewports of 360x640, 400x420, 667x376, 844x400 and 1280x800. Confirmed default folded panels, mutual exclusion, readable scrolling answers, 16px input, notes and camera controls, rotation and desktop restoration.
- At 360x640 the open engineer sheet was 288px tall; the 3D stage ended above the sheet. At 400x420 the answer scrolled inside a 189px sheet and the input remained visible. Motorcycle telemetry used the correct two wheels in a 158px landscape sheet.
- Direct browser checks used built assets with the existing offline engineer fallback. The live backend is unchanged. The phone portion of the existing layout specification was updated for the new disclosures; the browser suite itself was not run.
- Software keyboard positioning was tested with a visual viewport fixture and short browser dimensions, not a physical phone keyboard.
- Private deployment/environment files remain ignored. No dependencies, paid services or provider resources were added.
