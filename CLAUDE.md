# Claude Agent Instructions

See canonical documentation:

- agent-docs/system.md  
  High-level description of what the system does and the major components involved. Examples of related files: system.md, product-overview.md, service-boundaries.md.

- agent-docs/architecture/  
  Explains how the codebase is structured and how major systems interact. Use this to understand where new code should live and how components connect. Example files: architecture/overview.md, architecture/database.md, architecture/api.md, architecture/auth.md.

- agent-docs/coding-conventions.md  
  Contains required coding rules and constraints (e.g., database migrations, dependency rules, file patterns). Always follow these when writing or modifying code, and especially when using terminal commands (like db migrations) or at a cross-roads in approaches. Example topics: database-migrations.md, dependency-rules.md, file-structure.md.

- agent-docs/bug-fixes/  
  Short records of important bugs that occurred that might break again easily if we don't document it. Example files: bug-fixes/oauth-loop.md, bug-fixes/race-condition-cache.md. Documenting what the bug was and what approach was taken to solving it. This is equally for the developer's reference as your own.

When modifying code, follow the rules defined in these documents. The /agent-docs folder is for you to keep yourself updated as you work on the project on past context. Be concise so that you can continue to maintain it for a while and not have the files blow up in size.
