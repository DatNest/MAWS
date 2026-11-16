# MAWS Universal · Lite

Standalone SillyTavern UI extension ported from the attached **MAWS Universal — универсальный ролевой движок — Light** Tavern Helper script (engine v43). Original quest/scene/social mechanics and the MAWS chat metadata key are preserved.

## Install

1. **Back up the chat and the MAWS profile JSON first.**
2. Disable the **old MAWS Tavern Helper script** in Tavern Helper (otherwise two copies can fight over the same prompt and panels).
3. Copy the entire `MAWS_Universal_Lite_Extension` folder into `SillyTavern/data/<your-user>/extensions/` (if your ST build uses legacy paths, `public/scripts/extensions/third-party/` can also work). Restart SillyTavern or refresh the page.
4. Or upload this folder **as the root of your own Git repository** and use **Extensions → Install Extension → repository URL**. A local `.zip` is not a repository URL and cannot be pasted into that field.
5. Open the last bot reply; the MAWS card will appear there. Its normal sections and custom theme are retained.

## Performance changes

- Only the most recent three and near-viewport message shells are decorated per repaint. Scrolling lazily reveals archived MAWS panels.
- Cached chat-state normalization and memoized latest-bot index avoid redundant scans of the full conversation.
- Projection cache is bounded to 16 entries; the cache is invalidated on chat edits/switches.
- Chat scrolling is throttled; in-progress streaming replies do not cause MAWS to recompute every token.
- The existing chat-local metadata storage (`maws_engine_universal_v1`) and profile format remain unchanged.

## Compatibility and limitations

- SillyTavern's `SillyTavern.getContext()` and `setExtensionPrompt()` are required. Model-assisted tasks also require the **Connection Manager** and a selected service profile.
- Worldbook operations in the source rely on optional **Tavern Helper worldbook functions**. Those functions may not be exposed to native UI extensions in your installation; worldbook buttons may report that their API is unavailable. The base scene, NPC, relationship, quest, prompt, save/import, and theme interfaces do not depend on them.
- This port has automated **syntax, manifest and pure-logic tests**, not a live integration test in the user's SillyTavern instance. Performance improvements are structural; actual browser FPS and compatibility with every other extension are not guaranteed.
- If chat editing or other HUD extensions replace message markup, the source's mutation observer still repairs the visible MAWS decoration.
- For a smoother first installation, keep existing chats backed up and check that metadata is loading for each distinct chat before discarding your Tavern Helper script export.

## Tests

`node tests/core.test.cjs` tests the manifest, API, timeline/calendars, state tags and prompt generation. These pass in the build environment.

`python tests/browser_smoke.py` provides a browser smoke test with a fake SillyTavern context for local environments where Playwright and Chromium are available. This **was not executed successfully** in the build environment because browser navigation is administratively blocked; it is not proof of compatibility with a real ST installation.

## Uninstall

Disable/delete the folder and reload SillyTavern. Existing MAWS metadata stays in the chat unless you remove it separately. Reactivate the original Tavern Helper script only after disabling this extension.

## Files

- `manifest.json`: SillyTavern package descriptor.
- `index.js`: wait-for-SillyTavern loader.
- `engine.js`: original feature logic with targeted rendering/cache/event optimizations.
- `style.css`: readability/accessibility finishing layer.
- `tests/`: browser-independent smoke and structural tests.
