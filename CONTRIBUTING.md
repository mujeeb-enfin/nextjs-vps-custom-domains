# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Ground rules

- **TypeScript, strict mode.** No `any` without a comment explaining why.
- **Fail loudly.** No silent fallbacks or default values for required config, and no swallowed errors. Log with `logger` (server) or `clientLog` (browser); both emit OpenTelemetry-shaped records.
- **Event-driven.** No `setInterval`, and no `setTimeout` used for polling. Use blocking Redis reads, pub/sub, SSE or `AbortController`.
- **UI.** Tailwind utilities with the tokens in `src/app/globals.css` (no raw colours in components), inline SVG icons only, a unique prefixed `id` on every interactive element (`cd_…` for the domains feature), and memoised components so a status change re-renders only the affected card.
- **Files stay under 500 lines.** Split before that.
- **Security-sensitive changes** (agent, `ncd-certctl`, sudoers, nginx templates, hostname validation, auth) need a test and a short threat note in the PR description.

## Workflow

1. Fork, create a branch from `main`.
2. `npm ci && cp .env.example .env` and run Postgres + Redis locally (`docker compose up -d db redis`).
3. Make the change with tests. DNS tests run against real public DNS; do not mock the resolver.
4. Run everything before you push:
   ```bash
   npm run lint && npm run typecheck && npm test && npm run build
   npm run test:e2e:headed
   ```
5. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`). Describe *why* in the body.
6. Open a pull request using the template.

## Reporting security issues

Not in public issues. See [SECURITY.md](SECURITY.md).
