# Ask Gina Plugin Distribution

This context defines the language for authoring one Ask Gina plugin and distributing host-specific packages without confusing local catalogs with public publication.

## Language

**Canonical skill**:
The single editable Ask Gina skill definition from which host packages are assembled.
_Avoid_: Source skill, master skill

**Plugin source**:
A committed, directly loadable plugin directory containing a host manifest and every component that manifest declares.
_Avoid_: Overlay, generated target

**Host artifact**:
A generated, installable plugin package assembled for one supported host. It is not reusable library source.
_Avoid_: Package source, plugin source

**Repo marketplace**:
A repository catalog used for authoring, testing, and private or team distribution of directly loadable plugin sources.
_Avoid_: Public marketplace, universal directory

**Universal directory**:
OpenAI's shared public plugin listing populated through the submission and review process.
_Avoid_: Repo marketplace, local marketplace
