# @askgina/cli

`@askgina/cli` is a Bun `1.4.x`-only CLI. Install the packed artifact with Bun;
the installed `ask-gina` command points to the compiled ESM bin at
`./dist/bin.js`. Do not run the workspace TypeScript source directly. This
repository does not publish the package.

```sh
export ASK_GINA_ACCESS_TOKEN=synthetic-fixture
ask-gina list
ask-gina call gina.listScheduledPrompts '{}'
```

Node.js, CommonJS, browser runtimes, edge runtimes, and package subpaths are not
supported.

`vp pack` writes compiled JavaScript, declarations, and maps to the ignored
`dist/` directory. The maps embed the committed TypeScript and use relative
source paths.
