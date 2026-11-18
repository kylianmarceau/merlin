# Patches to the React Native shell's dependencies

pnpm applies these on every install (`patchedDependencies` in
`pnpm-workspace.yaml`); the Podfile compiles React Native and Expo from
`node_modules`, so a rebuild picks them up.

All three come from Ardia (https://github.com/ardia-browser/ardia, commit
c463d559fa7e682ddb13b88e950e487edd0cd45e, `patches/`), Copyright 2026 Mantra
Patel, licensed under the Apache License, Version 2.0 (`LICENSE.Apache-2.0`
here). They are carried unchanged; edits inside them are marked `[Ardia: …]`.
They are byte-identical to Ardia's root `patches/` at that commit (checked
2026-11-18), part of Ardia's own Apache-2.0 source, not its GPL-3.0 engine
patches in `engine/`.

| Patch | What it fixes |
| --- | --- |
| `react-native-macos@0.81.9` | A React view whose parent and children are all React views leaves Auto Layout (macOS 26+ engages it in every window, and its cost grew with long tab lists); mounts land in layout order during live resize; RCTTiming sleeps on a timer instead of the display link when nothing is due soon; mouse touches always match their own mouse-down, so JS never gets a null touch; hover follows layout; text-field focus, caret, undo, IME and paste fixes; network task completion races |
| `expo-modules-core@3.0.30` | On React Native's classic bridge, the JS runtime is set up on the JS thread only; it raced the JS thread from the main thread before |
| `expo-constants@18.0.14` | macOS no longer lists every installed font family at launch for `Constants.systemFonts` (about 60 ms of the main thread before the first window could appear) |

To change one: `pnpm patch <pkg>@<version>`, edit, then `pnpm patch-commit`
into this folder, and say what changed here.
