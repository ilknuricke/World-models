# One landscape control row

The original automatic/manual switch now sits immediately after narration in one landscape toolbar row. The same scenario and assist buttons move with it. Speed, gear, status readouts and scenario instructions stay in the lower band. The original controls, handlers, accessible labels and focus survive moving; portrait and desktop restore their exact original positions.

The left toolbar is bounded by the actual right-hand controls and scrolls horizontally on narrow phones. Narration and the full mode switch remain visible together before panning. Mode and availability mirror the original driving state, and unavailable motorcycle controls stay hidden. HUD/attract and requested panels preserve their existing visibility behavior. Mode presses still unlock default narration when the browser requires a gesture.

Validation:
- 70 relevant tests passed across five files, including eight new toolbar lifecycle tests.
- Application and Node TypeScript checks passed; the changed browser spec also passed strict checking.
- Dependency boundaries passed: 293 modules, 1038 dependencies. Production build passed.
- Browser checks verified the shared top row at CSS 844×391 and 568×320, the full narrow-screen switch beside narration, actual Manual takeover, portrait restoration at 400×840, landscape return, and hidden unavailable motorcycle mode controls.
- Browser regression tests cover adjacency, initial visibility, actual mode changes, stage clearance and original-parent restoration. The command-line browser suite was not run; UI checks used viewport overrides rather than a physical phone.

Privacy review found no protected local values. Private configs/generated output remain ignored. Commit with neutral identity and publish through the existing free deployment; confirm the same row in production.
