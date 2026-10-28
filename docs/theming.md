# Theming

Shared tokens for the Copix Desktop chat UI live in `shared/theme/tokens.css`. Import that file. It loads the self-hosted fonts in `shared/theme/fonts.css`. Do not load these families from a CDN.

`initTheme()` in `shared/theme/theme.ts` applies a theme on the document root and stores it in `localStorage` under `copix.theme`.

## Attributes

| Theme | `data-concept` | `data-theme` | `data-mode` |
| --- | --- | --- | --- |
| paper-light | `paper` | `light` | `light` |
| paper-dark | `paper` | `dark` | `dark` |
| glass-frost | `glass` | `frost` | `light` |
| glass-smoke | `glass` | `smoke` | `dark` |
| terminal-ink | `terminal` | `ink` | `dark` |
| terminal-bone | `terminal` | `bone` | `light` |

Leave `data-accent` unset for the theme's own clay and sage. `indigo-teal` and `plum-amber` replace `--accent`, `--on-accent`, and `--accent2` on any theme. They only apply when `data-mode` is `light` or `dark`. The helper sets that from the theme.

`data-reduce="1"` is the manual reduced-motion switch.

## Fonts

`--font-ui` and `--ui` are Pretendard for English and Korean, then SUIT, then Inter.

`--font-mono` and `--mono` are Geist Mono, then JetBrains Mono, then Pretendard, so Korean text in code and the terminal does not fall through to a system monospace font.

Paper headings use `--font-display` (Fraunces, then Noto Serif KR). Paper body text uses `--font-body` (Newsreader, Fraunces, Pretendard). Glass uses the UI font. Terminal uses the mono font.

The files are under `shared/theme/fonts/`. Each family has its SIL Open Font License in `OFL.txt`.

## Motion

`--dur-fast`, `--dur-med`, `--dur-slow`, and `--dur-sweep` become `0ms` under `prefers-reduced-motion: reduce` and under `data-reduce="1"`.

Caret and blink animations use `--anim-caret` and `--anim-blink`, or the `.u-caret` and `.u-blink` utilities. Both tokens are `none` when motion is reduced, and the utilities force `animation: none` in that case.

## Color

Semantic colors are `--bg`, `--pan`, `--sub`, `--text`, `--muted`, `--line`, `--hov`, `--accent`, `--on-accent`, `--accent2`, `--add` (sage), `--dl` (clay), `--addbg`, `--addfg`, `--delbg`, `--delfg`, `--inv`, and `--on-inv`. Sage and clay on paper are the darker values that clear 4.5:1.

Glass panels are translucent. Paint them over `--bg` with `backdrop-filter: blur(20px)`. Without backdrop-filter, those tokens become the same colors composited over the solid background.

Spacing: paper radius and gap are 12px, glass is 16px and 14px, terminal is 8px and 8px. The space scale is 4, 8, 12, 16, 24, 32. The rail is `--rail-w: 240px`. The stats column is `--right-w: 220px`.

## Contrast

`npm test` in `shared/theme` checks every pair in `shared/theme/TOKENS.md`. Text needs 4.5:1. Accent marks on a panel need 3:1.

This layer does not restyle the current chat shell.
