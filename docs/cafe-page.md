# Additional café page

`/cafe` is an independent full-screen route, copied from `feature/cafe-interface` at `bd5fa11`. It includes the illustrated coffee/matcha scene, five milk and sugar presets, a served drink and fund receipt, and Dutch/English switching.

The existing young-professionals pages, navigation, look switcher, store, API schema, dependencies and backend are unchanged. The only existing source file changed is `frontend/src/App.tsx`, to register the extra lazy-loaded route outside the normal `Layout`. No menu link is added; open `/cafe` directly.

Café CSS defines its own font and heading tokens within `.cafe-page`. It does not change the root `data-style` or the saved sunny/night/swiss look. Existing pages keep their original appearance, including after visiting the café.

The café calls the existing `/api/portfolio` endpoint with the same preset-to-risk mapping. Additional optional money fields on the young-professionals API need no changes. Its optional starting amount is display-only, not a monthly contribution or an alteration to the engine calculation. It has its own order and language storage keys and does not write the existing plan store.

## Run and verify

Use the existing frontend and backend development commands, then open `http://localhost:5740/cafe`. The normal page uses the configured API; there is no silent synthetic-data fallback.

The existing `npm run dev:mock` can also show the café, with explicit consent and labeling for its fixed demo. The independent café tests intercept the API rather than relying on production market data:

```sh
cd frontend
npm run typecheck
npm test
npm run build
npx playwright test --config playwright.cafe.config.ts
npm run e2e
```

The café test server uses port 5742. Integration tests verify all three existing looks, both languages, responsive serving, no plan-state writes, and unchanged navigation and typography after leaving `/cafe`. Original engine warning text, fund names and identifiers are preserved.
