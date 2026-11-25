# Independent physics overlays

Make the construction lines, ghost pose and load arrows an explicit visitor choice in every camera view.

1. Remove close-up's automatic overlay selection. Reuse the existing overlay store state, initially clean.
2. Add an accessible pressed-state toggle beside camera choices, inside the compact mobile display menu. Keep the close-up measurement card scoped to close-up.
3. Cover camera/vehicle changes, paused toggles and measurement visibility; verify desktop and phone layouts, then publish with the existing free deployment.

Owned files: controls source/CSS, teaching-overlays source, related feature/e2e tests, README and this quick plan/summary. No simulation, dependency, binding or secret changes.
