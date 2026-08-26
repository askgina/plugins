# @askgina/plugin-core

Committed `src/**`, `plugin.yaml`, `skills/**`, `evals/**`, and `targets/**` are the
canonical plugin inputs. `vp pack` derives the package `dist/` and the custom
packer creates complete host archives under the repository's ignored `dist/`
tree; generated package and host outputs are not source and are never
authoritative.

The repository may build, verify, and archive these artifacts. It does not publish,
release, deploy, or submit them: packaging creates evidence, not publication
authority.
