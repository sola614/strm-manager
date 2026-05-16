# Contributing to strm-manager

Thank you for contributing.

## Workflow

1. Fork the repository.
2. Create a focused branch for your change.
3. Keep changes small and explain the user-facing impact clearly.
4. Open a pull request with validation notes.

## Local Development

Install dependencies:

```bash
npm install
```

Run the frontend:

```bash
npm run dev
```

Run the backend:

```bash
npm run dev:server
```

Create a production build:

```bash
npm run build
```

## Contribution Priorities

Helpful areas for contribution include:

- bug fixes in task execution behavior
- storage provider compatibility
- UX improvements in the management panel
- test coverage
- deployment and documentation improvements

## Coding Expectations

- Keep the backend dependency footprint small unless a new dependency clearly improves maintainability.
- Prefer clear data contracts between the frontend and backend.
- Preserve single-instance scheduler assumptions unless you are intentionally redesigning deployment behavior.
- Document any new environment variables or task fields.

## Pull Request Notes

Please include:

- what changed
- why it changed
- how you verified it
- any follow-up work that remains
