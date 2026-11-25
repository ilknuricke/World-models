# Speed readout at the top of the landscape vehicle window

Moved the existing live speed and gear node into a compact, read-only badge at the upper-left of the landscape vehicle scene. The original node and its update path are preserved; portrait and desktop restore its original position. Manual mode, vehicle availability, HUD visibility and cleanup remain synchronized.

Collapsed the empty bottom driving pill and unlit lamp slot while retaining actual warnings and return notices. The shared layout mirrors the sibling stage's top inset without measuring or reserving space for the badge. The badge temporarily hides if expanded menus leave less than its required height, then recovers when space returns.

Validation: related unit tests, application and tooling TypeScript checks, strict checks for changed tests, dependency boundaries and production build passed. Browser checks used phone-size viewports for narrow and wide landscape, scenario driving, portrait restoration and combined-menu containment. The very short scene case was reproduced and verified fixed. Browser E2E specifications were updated and typechecked; they were not executed through the command-line browser runner.

Privacy review found no personal values or credentials in the changes. Publishing uses only the existing free configuration and resources.
