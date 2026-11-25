# Landscape scenario information

Move the phone's scenario instructions below the driving controls and keep the vehicle above the occupied dock.

1. Use a landscape-only bottom information row with compact, scrollable station copy. Hidden hints should not occupy dock space.
2. Reuse measured stage clearance for the visible driving dock, while preserving existing engineer and telemetry sheet clearance. Update on rotation, hint and HUD visibility changes; restore normal layout outside short landscape screens.
3. Verify scenario instructions on small and wide landscape phones, portrait return, normal lap, and desktop. Run relevant geometry lifecycle tests, type checks and build, then publish using the existing free deployment.

Owned source: drive CSS and shared message layout. Related unit/e2e tests and quick plan/summary only. No simulation or provider changes.
