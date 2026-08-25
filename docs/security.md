# Security

Report vulnerabilities privately to Ask Gina maintainers. Do not file public
issues that include tokens, account data, or raw eval observations.

This repository must remain private until a separate public-visibility
authority is granted. CI has `contents: read` at most for contributor code and
must not receive secrets.

Forbidden in source, packages, archives, and receipts:

- credentials, tokens, token IDs
- private application hosts and imports
- authenticated raw eval observations
- proprietary prompts beyond allowlisted fixtures
