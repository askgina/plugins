# @askgina/sdk

`@askgina/sdk` ships as compiled ESM for Node.js `>=24` and Bun `>=1.4`.
Install and consume the packed artifact rather than importing workspace source
files. This repository does not publish the package.

Import only from the package root:

```ts
import { createClient } from "@askgina/sdk";

const client = createClient({ accessToken: process.env.ASK_GINA_ACCESS_TOKEN ?? "" });
```

CommonJS, browser runtimes, edge runtimes, and package subpaths such as
`@askgina/sdk/...` are not supported.

`vp pack` writes compiled JavaScript, declarations, and maps to the ignored
`dist/` directory. The maps embed the committed TypeScript and use relative
source paths.
