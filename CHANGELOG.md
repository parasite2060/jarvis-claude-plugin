# Changelog

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
