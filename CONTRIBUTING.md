# Contributing to Masu

Thanks for helping. Masu should read a reference the way a good teacher does, and nobody can check that alone. Contributions in English or Spanish are both fine.

## Ways to help (no code needed)

- **Report a bad reading.** Open an issue with the "Bad reading" template: the image (only one you have the right to share: your own photo or drawing, or public domain), the mode and step, a screenshot, and what a draftsman or painter would do instead. A quick sketch over the screenshot is worth a page of text.
- **Teach a rule.** Many readings come from written rules (proportions, where the contour gets heavier, how a hand folds). If a rule is wrong or missing, open an issue with "Drawing rule" and cite where it comes from (a book, a course, your own teaching).
- **Translate.** See [Translations](#translations).
- **Share test images.** Public-domain or CC0 references for hard cases (strong foreshortening, back views, sitting poses, hands holding things) help everyone. Link them in an issue with their license.

## Code

```bash
npm install
npm run setup     # models, once (~1 GB)
npm run dev
npm test
```

- TypeScript strict, React 19, Zustand for state. Everything runs in the browser; heavy models run in Web Workers (`src/workers/`).
- Geometry and readings live in `src/lib/` and must be pure and tested (`*.test.ts`, Vitest). Drawing (`src/ui/*-draw.ts`, `overlays.ts`) turns readings into SVG primitives.
- **Never invent.** If the evidence is weak, return nothing or say how sure the reading is. A joint outside the figure does not count; a light that the face contradicts is not stated.
- Test in the **dark theme**: it is the one most people use, and some bugs only show there.
- Before a pull request: `npx tsc --noEmit -p .` and `npm test` must pass. For visual changes, attach before/after screenshots (the scripts in `dev/` help: `matriz.mjs`, `interfaz.mjs`, `diagnostico.mjs`).
- Code comments and identifiers are mostly in Spanish (the project started that way). New code may use either language; keep the surrounding style.

## Translations

All visible text is in `src/i18n/`:

1. Copy `src/i18n/en.ts` to `src/i18n/<code>.ts` (for example `pt.ts`) and translate the values, not the keys. Keep `{placeholders}` as they are. For a word that changes with a number, write `{n|singular|plural}` (for example `'{n} {n|square|squares}'`): the form is picked with the language's plural rules.
2. Register the language in `src/i18n/index.ts` (the `Locale` type, the dictionary map and the browser-language detection).
3. Run `npx tsc --noEmit -p .`: it fails if a key is missing.
4. Open the app, switch the language and check that nothing overflows its panel.

Use the words a drawing teacher in that language would use ("terminator", "cast shadow", "block-in"), not a literal translation.

## Models

Do not commit model files. New models must run locally in the browser (ONNX, MediaPipe or Transformers.js), be added to `scripts/setup.mjs` with their download URL, and have their license listed in the README. Prefer Apache-2.0, MIT or similar; non-commercial models must be marked as such.

## Images and privacy

Do not commit photos of people who have not agreed to it, nor copyrighted images. `ejemplos/` is ignored by git on purpose; the shared test images live in `docs/examples/` and are public domain or CC0, with their source in `docs/examples/SOURCES.md`.

## Conduct

Be kind, assume good faith, critique the drawing and not the person. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
