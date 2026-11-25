# Close-up measurement visibility result

The trace panel used to follow the persistent 3D engineer-layer setting, so leaving close-up kept the camber or motion-ratio graph on screen. Its visibility now also requires the close-up camera. This preserves the chosen 3D construction layer while removing the close-up-only readout from Follow and Explore.

The live motorcycle case reproduced the bug. Five lifecycle regression cases cover both vehicle classes, paused camera changes, reentry, HUD/attract visibility and explicit overlay choices. Three cases failed before the fix; all five passed afterward. The combined lifecycle and geometry tests passed all 16 cases. Application types, changed test/specification types with the repository compiler options, and the production build passed. Existing browser specifications were updated; that suite was not run.
