# Landscape menus outside the vehicle scene

Short landscape phones now reserve separate top and bottom HUD bands. The renderer receives the clear middle area, measured from visible controls and panels rather than drawing menus over the vehicle. The same resize/visibility lifecycle handles automatic driving, manual scenarios, launchers, touch steering/pedals, camera options, sheets and bounded auxiliary popovers. Menu positions depend on the viewport, independently of the resized scene.

The top toolbar uses one row, including narrow landscape phones. During manual landscape driving, suspension choices open with **Görünüm**. Scenario instructions stay below the driving controls. Pedals are shorter but retain touch-sized targets. Optional notes and the physics graph dock below the scene; opened panels scroll within bounded heights. Dense readouts temporarily yield while camera or question/telemetry menus are open. Portrait and desktop release the landscape insets.

Validation:
- Shared layout lifecycle tests cover top/bottom regions, visible popovers, camera expansion, Auto/manual controls, independent touch controls, rotation and cleanup.
- 71 related mobile/controls/engineer/narration tests passed. Application and Node TypeScript passed; dependency boundaries passed (292 modules, 1035 dependencies); production build passed.
- Supported browser UI checks at CSS 844×391 and 568×320 found no relevant menu rectangle intersecting the actual stage. Actual scenario selection, camera options, physics readout, telemetry and engineer panels were exercised. Scenario driving kept a clear middle scene; bounded scenario selection can temporarily leave a smaller preview on very short screens.
- Rotation to 400×840 portrait and 1280×800 desktop restored the full scene bounds. No simulation state or provider changes were needed.
- Browser regression specs include touch geometry and short landscape cases. The command-line browser suite was not run; interactive checks used viewport overrides in the desktop browser, not a physical phone or software keyboard.

Privacy checks preserve ignored local configuration, generated outputs and neutral commit identity. Publish only through the existing free deployment, then confirm the public scenario layout and health version.
