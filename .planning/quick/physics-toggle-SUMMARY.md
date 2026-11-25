# Independent physics overlays

The Turkish **Fizik** pressed-state button controls construction lines, ghost rest pose and load arrows through the existing overlay store state. It starts off, remains selected across camera and vehicle changes, and updates immediately while paused. Close-up no longer enables it automatically. The measurement card still requires both close-up and an enabled physics layer.

On compact screens the existing camera opener is now **Görünüm** and exposes the physics toggle beside camera choices. It adds no permanent toolbar width. The button keeps a dark surface for contrast over the sky. Camera key hints hide below 1400 px so the extra control stays clear of the suspension selector.

Validation:
- 18 teaching-overlay tests and 71 related controls/mobile/engineer/narration tests passed.
- Application, Worker and Node TypeScript checks passed; the three changed browser specs also passed strict checking.
- Dependency boundaries passed: 292 modules, 1035 dependencies. Production build passed.
- Browser interaction verified default off, explicit on/off, camera transitions and close-up reentry; both car and motorcycle were checked while paused. Screenshots confirmed the vehicle construction disappears when switched off.
- Actual CSS viewports checked at 320×640, 360×640, 667×376 and 1280×800. The mobile menu fits without horizontal overflow; desktop camera/physics controls retain a gap from suspension controls. Enter activates the toggle and Escape closes the mobile menu.
- Local static preview does not provide API services; this change is entirely client store/render behavior. No API or provider changes were made. Browser specs were updated but their command-line suite was not run; browser checks used the supported UI tool.

Privacy review found no protected local configuration values in candidate source files. Local configuration and generated outputs remain ignored. Publish using the existing free deployment and verify the same controls there.
