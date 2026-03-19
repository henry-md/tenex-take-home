Databases:
You are ONLY allowed to make db migrations with `npx prisma migrate dev --name <migration_name>`, and regenerate the client with `npx prisma generate`, and absolutely nothing else. If that doesn't work, you are not even allowed to run it again! You must give me your suggestion for what to run. NEVER, EVER, under ANY CIRCUMSTANCES can you run things like `db push`, `migrate deploy`, `db pull`, or anything else. This is punishable by death.

Package management:
Prefer `pnpm` over `npm` for install, dev, build, lint, and other package-script commands unless there is a specific reason not to.

Verification:
After code changes, especially UI/component edits, always run a compiler check (`pnpm exec tsc --noEmit`) before finishing. Lint is not enough on its own.

Commits:
Never commit anything. Let the user do git add, etc, unless explicitly asked.
