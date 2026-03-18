Before you consider any task done, no matter how minor, run `pnpm run build` and make sure it passes. This is the required final verification step.

After you make any sort of change, run a linting error to make sure you didn't just create any compiler errors or eggregious linter errors (some small amt of linter errors are sometimes ok but we should try to avoid them).

UI content:
Do not include developer-facing implementation details in the product UI. Avoid sidebars, helper copy, or labels that tell the user about required env vars, API routing, auth wiring, or other setup details the end user does not need.
