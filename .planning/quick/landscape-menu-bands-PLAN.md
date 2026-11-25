# Keep landscape menus outside the vehicle scene

1. Measure the visible landscape HUD at the top and bottom and give the renderer only the clear middle area. Include automatic/manual controls, launchers, touch controls and opened panels.
2. Dock optional notes and physics readouts in a bounded bottom area. Keep all menu offsets based on the viewport, so resizing the scene cannot create a feedback loop.
3. Verify normal driving, scenario selection, camera options, phone rotation, sheets and hidden controls. Run lifecycle/regression checks, review privacy, commit/push and publish through the existing free deployment.

Owned source: shared message layout/base/message CSS and relevant control/drive/teaching-overlay CSS. Related unit/browser tests and quick plan/summary. No simulation, API, resource or billing changes.
