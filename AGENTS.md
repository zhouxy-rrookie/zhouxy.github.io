# AGENTS.md

This file provides guidance for agentic coding assistants working on this repository.

## Project overview

This is a **Hexo v6.3.0** static blog site (`hexo-site`), written in Chinese by **zhxy**. The active theme is **Butterfly v5.5.3**. Content lives in `source/_posts/` as Markdown files with YAML front matter. Theme customizations (CSS, JS, injected HTML) are in `source/_data/`.

## Commands

All commands are run from the project root and use **npm** as the package manager.

```bash
npm install              # Install dependencies
npm run server           # Start local dev server (http://localhost:4000)
npm run build            # Generate static site into public/
npm run clean            # Delete public/ (run before a fresh build)
npm run deploy           # Deploy to GitHub Pages (git push to main)
```

There are no test scripts, linters, or formatters configured at the project level. There is no CI beyond Dependabot for npm updates.

## Project structure

```
_config.yml              # Hexo site config (site metadata, deploy target, theme)
source/
  _posts/                # Blog posts (*.md with YAML front matter)
  _data/                 # Theme overrides injected into <head> and <body>
    head.swig            # HTML injected into <head> (canvas, overlay divs)
    scripts.swig         # JavaScript injected into page (cyberpunk UI effects)
    styles.styl          # Stylus overrides (glassmorphism, neon, animations)
    variables.styl       # CSS variable overrides (border-radius)
    link.yml             # Friend-link data
  about/ categories/ tags/ link/ schedule/  # Static pages
  CNAME                  # Custom domain: zhxylabflow.xyz
scaffolds/               # Templates for hexo new
themes/butterfly/        # Active theme (v5.5.3)
public/                  # Generated output (gitignored)
```

## Blog post conventions

### Front matter (YAML)

Every post must include this header block:

```yaml
---
title: 文章标题
mathjax: true
tags:
    - 标签一
    - 标签二
categories: 分类名
cover: https://img.cdn1.vip/i/xxxxx.webp
---
```

- `mathjax: true` — required on all posts (MathJax renders inline `$...$` and block `$$...$$`).
- `tags` — YAML list, indented under `tags:`.
- `categories` — single string (not a list).
- `cover` — external CDN image URL for the post cover card.

### Markdown body

- Use `#`, `##`, `###` ATX-style headings.
- Use `---` for horizontal rules.
- Use triple backticks with language hint for code blocks: ` ```python`, ` ```c`.
- LaTeX math: `$...$` inline, `$$...$$` block display.
- File names use underscore-separated English: `c_language_oop_robotics_blog.md`, `rsl_rl_source_analysis.md`.
- All prose is Chinese; technical terms may use English inline.

### Creating a new post

```bash
npx hexo new post "my-new-post-title"
```

This generates a draft from `scaffolds/post.md`. Edit the file in `source/_posts/`, then `npm run server` to preview. Commit and push source; deployment is handled separately via `npm run deploy`.

## Code style guidelines

### JavaScript (theme scripts in `themes/butterfly/scripts/`)

- CommonJS only (`require` / `module.exports`). No ES modules. No TypeScript.
- Every file opens with `'use strict'`.
- `const` for bindings; `let` when reassignment is needed. No `var`.
- `camelCase` for variables, functions, and file names.
- Destructure imports where practical: `const { foo } = require('bar')`.
- Group imports: Node built-ins → third-party → local.
- Prefer arrow functions for callbacks and short helpers. Use `function` declarations for named logic.
- Return early for invalid conditions rather than nesting deeply.
- Use descriptive `new Error('message')` with Hexo's `log.error()` / `log.warn()`.
- Guard against missing or wrong-shaped data with type checks before array/string operations.

### CSS (Stylus in `source/_data/styles.styl` and `variables.styl`)

- Stylus syntax: no braces, no semicolons, 2-space indentation.
- CSS custom properties defined under `:root` for theming.
- Section headers use `/* ====== N. Section Name ====== */` comment blocks.
- `!important` used liberally to override theme defaults.
- `rgba()` colors with transparency for glassmorphism effects.
- `@keyframes` for animations. Pixel sizes mixed with `rem` for typography.

### JavaScript (injected effects in `scripts.swig`)

- Wrapped in IIFEs `(() => { ... })()` to avoid global namespace pollution.
- Global config objects use `SCREAMING_SNAKE_CASE` (e.g. `const CYBER = { ... }`).
- Use `requestAnimationFrame` for animation loops.
- Throttle scroll/mousemove handlers with a `ticking` boolean guard.
- Avoid external libraries — rely on Canvas API and vanilla DOM methods.

### YAML configuration

- 2-space indentation.
- Double-hash `##` for sub-comments.
- Quotes only when the value contains special characters or leading/trailing spaces.

## Theme customizations

Custom CSS, JS, and HTML are injected through `source/_data/`:

| File | Injected into | Purpose |
|------|--------------|---------|
| `head.swig` | `<head>` | Canvas elements (cyberwave, particles), cursor glow, HUD decorations |
| `scripts.swig` | end of `<body>` | Particle system, cyberpunk wave animation, scroll effects, light/dark mode detection |
| `styles.styl` | global `<style>` | Glassmorphism cards, neon text, pink/blue border glow, code block styling |
| `variables.styl` | global `<style>` | `border-radius` variable overrides |

When modifying blog appearance, prefer adding Stylus/CSS in `source/_data/styles.styl` over editing the theme's own files — this survives theme updates.

## Dependencies and theme

- **Hexo v6.3.0** with `hexo-renderer-markdown-it` for Markdown, `hexo-renderer-stylus` for Stylus, `hexo-renderer-pug` for templates.
- **Butterfly theme v5.5.3** in `themes/butterfly/`. Its `_config.yml` controls layout, widgets, comments, analytics, etc.
- **MathJax** enabled per-post via front matter.
- **Live2D** mascot (`hibiki` model) via `hexo-helper-live2d`.
- **Local search** via `hexo-generator-search` and `hexo-generator-searchdb`.
