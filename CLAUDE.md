# Math Lord – notes for Claude

A VR maths game for a child: a problem hangs on a cloud, five numbered boxes rise on balloons, the
right one has to be cut with a sword. Plain three.js + TypeScript + Vite, no framework. The UI is Hungarian.

## Where the owner plays it

- As a Claude artifact, opened in the headset's browser: https://claude.ai/artifact/AtRnxa6EeyXGDDWXgBEKY7
- After every change: `npm run build:single`, then publish `dist-artifact.html` to that URL (same URL,
  so the link keeps working). A change is not "visible" before that.
- The page must work as one file with no network requests of its own (only the Google Fonts
  stylesheet, which has a fallback): no fetch(), no asset files.

## Checks

- `npm test` – the arithmetic (`src/math.ts`).
- `npm run typecheck`
- `npm run build:single && npm run smoke` – plays a whole game in a headless browser with an emulated
  Quest 3 (iwer): enter VR, trigger, cut, three mistakes, fall, restart. Needs a Playwright with its own Chromium.
- No real headset is available to Claude: say so when a change touches how things feel in the hand
  (sword angle, reach, speeds) – the owner tests those.

## Layout

- `src/math.ts` – problems, levels, wrong answers. `src/game.ts` – the round, boxes, sword, hits.
- `src/world.ts` – sky, land, clouds, tower. `src/board.ts` – the writing on the cloud and on the boxes.
- `src/main.ts` – page, renderer, headset session, controllers, screen (mouse / touch) mode.
- The sword hangs on the headset's grip space (`getControllerGrip`), blade along its −z: the line of
  the controller's handle, 45° above the pointing ray on a Quest. `SWORD_TILT` in `src/main.ts` leans it.
- Headset picture settings (resolution steps, foveation off by default, single-sample crisp shadow,
  `local-floor`) come from the Gardrób VR viewer in kepes/online-cabinet.
