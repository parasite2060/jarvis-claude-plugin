# Changelog

## [0.6.0](https://github.com/parasite2060/jarvis-claude-plugin/compare/jarvis-plugin-v0.5.0...jarvis-plugin-v0.6.0) (2026-04-24)


### Features

* **epic-11:** story 11.19 MCP dream tool accepts optional source_date ([2e43cdf](https://github.com/parasite2060/jarvis-claude-plugin/commit/2e43cdf9678d75e3ae2a24c544d8e3f3379ffbba))


### Bug Fixes

* update dependencies for @hono/node-server, hono, and vite to latest versions ([58ae574](https://github.com/parasite2060/jarvis-claude-plugin/commit/58ae574d03d16694622c7d9f45175d99e0df1265))

## [0.5.0](https://github.com/parasite2060/jarvis-claude-plugin/compare/jarvis-plugin-v0.4.0...jarvis-plugin-v0.5.0) (2026-04-18)


### Features

* **epic-10:** story 10.1 expanded client-side secret filter ([0cb547e](https://github.com/parasite2060/jarvis-claude-plugin/commit/0cb547ea964cec4dca314fe55e9513b2769d882a))
* **epic-11:** story 11.3 mcp dream tool + plugin command rewrite ([cb7ebaa](https://github.com/parasite2060/jarvis-claude-plugin/commit/cb7ebaa32137ebcb30840bca5c5dd5d632a49591))
* **epic-11:** story 11.7 plugin secret patterns JSON + parity tests ([e8adfef](https://github.com/parasite2060/jarvis-claude-plugin/commit/e8adfefe196ce05c59ac8e86a536edc9d3328f55))
* **epic-9:** implement story 9.26 — incremental transcript capture ([101b7c2](https://github.com/parasite2060/jarvis-claude-plugin/commit/101b7c2ae3ba3d71738dc3fc58ccfe269977a9c9))

## [0.4.0](https://github.com/parasite2060/jarvis-claude-plugin/compare/jarvis-plugin-v0.3.1...jarvis-plugin-v0.4.0) (2026-04-06)


### Features

* include vault file tree index in session-start context ([ebf8a76](https://github.com/parasite2060/jarvis-claude-plugin/commit/ebf8a767e1987f67abf32e1cfd5a2213dc3363ec))

## [0.3.1](https://github.com/parasite2060/jarvis-claude-plugin/compare/jarvis-plugin-v0.3.0...jarvis-plugin-v0.3.1) (2026-04-06)


### Bug Fixes

* call ensureWorkerRunning() in session-start hook ([5121f92](https://github.com/parasite2060/jarvis-claude-plugin/commit/5121f926397288add868421c805d649ca86d387e))

## [0.3.0](https://github.com/parasite2060/jarvis-claude-plugin/compare/jarvis-plugin-v0.2.1...jarvis-plugin-v0.3.0) (2026-04-06)


### Features

* switch MCP server publishing from GitHub Packages to npmjs.com ([c5a954e](https://github.com/parasite2060/jarvis-claude-plugin/commit/c5a954e5c0a67864b4e2a6c691fb0d8bcc6dc6a5))


### Bug Fixes

* add hookEventName to output + bash wrapper for Windows compatibility ([eb648ce](https://github.com/parasite2060/jarvis-claude-plugin/commit/eb648ce2483020f71c27e623ae0a96a8d7d347b5))
* inject resolved JARVIS_CACHE_DIR path into session context ([02234de](https://github.com/parasite2060/jarvis-claude-plugin/commit/02234ded8a50e8b699a2d1028c761cc40a862ab4))
* MCP server reads credentials from Claude config files as fallback ([fdbfcb7](https://github.com/parasite2060/jarvis-claude-plugin/commit/fdbfcb78b222fad195c377189c815c0ecbb4589e))
* pass userConfig to hooks via CLI args instead of env vars ([2cb0073](https://github.com/parasite2060/jarvis-claude-plugin/commit/2cb00737628928803acdbd6c4a5e7a4327ddf36f))
* put JARVIS_CACHE_DIR at top of context, not bottom ([fc3c489](https://github.com/parasite2060/jarvis-claude-plugin/commit/fc3c48920a1b7fda00c915e0047a161faee06fad))
* remove hardcoded cache path — use JARVIS_CACHE_DIR from session context ([20611a7](https://github.com/parasite2060/jarvis-claude-plugin/commit/20611a746eb332f85838e3f776b0ab5ec010bdce))
* remove worker spawn from SessionStart hook to prevent Windows libuv crash ([912b3d6](https://github.com/parasite2060/jarvis-claude-plugin/commit/912b3d677d9c6f400698f92f9db383dae4405f6b))
* revert to direct node command — issue was missing hookEventName, not the wrapper ([c405bc5](https://github.com/parasite2060/jarvis-claude-plugin/commit/c405bc5d63e52b876fb6f3987c978d06dd03e87d))
* update version to 0.2.1 in package-lock.json ([d9b9b7c](https://github.com/parasite2060/jarvis-claude-plugin/commit/d9b9b7cfcc25dd6d990cfebeafb346c0a87ce0d7))
* use env vars for config instead of reading credential files ([2441914](https://github.com/parasite2060/jarvis-claude-plugin/commit/2441914a85d4d07f65ac0b75ee8356718352557a))
* use env vars for config instead of reading credential files ([e2ac174](https://github.com/parasite2060/jarvis-claude-plugin/commit/e2ac174d5a52eaac7297aef1c4a825d2262d506f))
* use scoped .npmrc instead of --registry flag for npx ([e88d612](https://github.com/parasite2060/jarvis-claude-plugin/commit/e88d612c5d55d7b372389e13e6cdfa70aa840cc4))
* use SessionEnd instead of Stop for transcript capture ([e9738b9](https://github.com/parasite2060/jarvis-claude-plugin/commit/e9738b9e7d053e3cebb900931ad68f2120ff220b))

## [0.2.1](https://github.com/parasite2060/jarvis-claude-plugin/compare/jarvis-plugin-v0.2.0...jarvis-plugin-v0.2.1) (2026-04-05)


### Bug Fixes

* remove redundant npm version — release-please already bumps package.json ([9768ae4](https://github.com/parasite2060/jarvis-claude-plugin/commit/9768ae422501caf531b6d5a4591970c2359ce2fb))

## [0.2.0](https://github.com/parasite2060/jarvis-claude-plugin/compare/jarvis-plugin-v0.1.0...jarvis-plugin-v0.2.0) (2026-04-05)


### Features

* add extraHeaders config for custom HTTP headers (Cloudflare Access, etc.) ([f4411c9](https://github.com/parasite2060/jarvis-claude-plugin/commit/f4411c98b982bffaf9c9ae5284f6c61ce250e305))
* add local worker for background file sync ([4fdb1f2](https://github.com/parasite2060/jarvis-claude-plugin/commit/4fdb1f2cff064d7c7a3ccc41728ead62e050928f))
* add marketplace discovery for Claude Code plugin installation ([3409388](https://github.com/parasite2060/jarvis-claude-plugin/commit/34093889e02277fa658109e6677df155cfebe66b))
* enhance MCP tools with proper server integration and error handling ([6852a4c](https://github.com/parasite2060/jarvis-claude-plugin/commit/6852a4c66472351cabba5282c04fc56afe34fd54))
* enhance SessionStart hook with context injection and worker management ([ea2ba8e](https://github.com/parasite2060/jarvis-claude-plugin/commit/ea2ba8e8099fe92fa8886ecc9176cf17fad5262a))
* enhance transcript capture hooks with JSONL reading and sensitive data filtering ([8671e5c](https://github.com/parasite2060/jarvis-claude-plugin/commit/8671e5c4ee6b13ace0a8c44608189d72afe39a79))
* publish MCP server to GitHub Packages + add CI/CD pipelines ([6c2d492](https://github.com/parasite2060/jarvis-claude-plugin/commit/6c2d4927d810de8583839cc160c917843e358e86))
* scaffold claude code plugin with hooks and MCP server ([4ed6c89](https://github.com/parasite2060/jarvis-claude-plugin/commit/4ed6c89e1429bc5d8f14d1f9ae5632aa134c91aa))
* track plugin root version via release-please ([3d29e8e](https://github.com/parasite2060/jarvis-claude-plugin/commit/3d29e8ebe3c89c67e9516c868f1bcfaa68d3e3a0))
* update @modelcontextprotocol/sdk dependency to version 1.28.0 ([c07ca04](https://github.com/parasite2060/jarvis-claude-plugin/commit/c07ca049bf82ee19e3b0b9812b94852635a9d2ee))
* update dream/recall commands and memory-usage skill ([b7d48c5](https://github.com/parasite2060/jarvis-claude-plugin/commit/b7d48c53a0f6a284a77edcba2816fb160f904e3a))


### Bug Fixes

* add --registry flag to npx for GitHub Packages (no auth needed for public packages) ([189dcc2](https://github.com/parasite2060/jarvis-claude-plugin/commit/189dcc2e2a8d7a19322a23627e4a639efe999472))
* add required title field to userConfig entries ([1ec6ab8](https://github.com/parasite2060/jarvis-claude-plugin/commit/1ec6ab8849ca36b81c8a070a112d2656345a75ea))
* rename marketplace to 'jarvis', plugin to 'jarvis-plugin' ([645090a](https://github.com/parasite2060/jarvis-claude-plugin/commit/645090ac03954cca6c6a7df16f111d85113bd281))
* use ./ for marketplace plugin source path ([7f6e870](https://github.com/parasite2060/jarvis-claude-plugin/commit/7f6e87050498ac2e6a11eba4a929ee99ef50b42d))
