# Landscape scenario information

On short landscape phones, scenario instructions now sit below the driving controls at the bottom. Station text uses compact padding and font size, with a bounded scrollable area for longer copy. Hidden hints occupy no dock space.

The existing measured scene clearance also accounts for the visible manual driving dock in landscape. This keeps the vehicle above both the controls and instructions. Class/visibility observers update clearance when position changes without a resize and exclude the layout's own CSS variable writes. Portrait, desktop, Auto and hidden-HUD states release this space; existing engineer/telemetry sheet clearance remains in effect.

Validation:
- 6 new geometry lifecycle tests and 71 related mobile/controls/engineer/narration tests passed.
- Application TypeScript and strict checks of the changed unit/browser test files passed.
- Dependency boundaries passed (292 modules, 1035 dependencies); production build passed.
- Browser checks used an actual scenario selected through the UI. At CSS 844×391 and 667×376, instructions were below the drive pill and the scene ended above the entire dock; neither view had horizontal overflow. Returning to 400×840 portrait, hiding the HUD and returning to Auto reset the scene inset; restoring the HUD restored clearance.
- The browser regression spec covers touch scenario selection and rotation, but its command-line suite was not run. Interactive viewport checks used the desktop browser; a physical phone's touch controls were not operated.

No simulation, API, resource or billing changes. Privacy review found no protected values in candidate files; local configuration and generated artifacts remain ignored. Publish using the existing free deployment and confirm the scenario layout there.
