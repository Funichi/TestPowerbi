---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

1. Read `guidelines.md` in this folder (a pinned local copy of the Vercel guidelines; it is not fetched at runtime).
2. Read the files the user specified (or ask which files/pattern to review).
3. Check them against every rule in `guidelines.md`.
4. Output findings in the terse `file:line` format described there.
