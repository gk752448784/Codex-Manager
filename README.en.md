<p align="center">
  <img src="assets/logo/logo.png" alt="CodexManager Logo" width="220" />
</p>

<h1 align="center">CodexManager</h1>

<p align="center">A local desktop + service toolkit for Codex-compatible account and gateway management.</p>

<p align="center">
  <a href="README.md">中文</a>
</p>

A local desktop + service toolkit for managing Codex-compatible accounts, usage, platform keys, and a built-in local gateway.

## Landing Guide
| What you want to do | Go here |
| --- | --- |
| First launch, deployment, Docker, macOS allowlist | [Runtime and deployment guide](docs/report/20260310122606850_运行与部署指南.md) |
| Configure port, proxy, database, Web password, environment variables | [Environment variables and runtime config](docs/report/20260309195355187_环境变量与运行配置说明.md) |
| Troubleshoot account selection, import failures, challenge blocks, request issues | [FAQ and account-hit rules](docs/report/20260310122606852_FAQ与账号命中规则.md) |
| Build locally, package, publish, run scripts | [Build, release, and script guide](docs/release/20260310122606851_构建发布与脚本说明.md) |

## Recent Changes
- Current latest version: `v0.1.7` (2026-03-11)
- This release rolls up the latest protocol compatibility work, desktop interaction fixes, Web auth hardening, and long-term maintainability refactors; see [CHANGELOG.md](CHANGELOG.md) for full history.
- Protocol compatibility keeps tightening around Codex / OpenAI behavior: `/v1/chat/completions`, `/v1/responses`, and Claude `/v1/messages` are now more closely aligned, including multi-MCP tool preservation, long tool-name shortening, and response restoration for Cherry Studio, OpenClaw, Claude Code, and similar clients.
- Gateway runtime and diagnostics are stronger: failure responses expose structured `errorCode` / `errorDetail` fields and trace headers, long-running SSE turns are more resilient to idle disconnects, and the Settings page now exposes upstream stream timeout and SSE keepalive controls with runtime hot reload.
- Desktop behavior was tightened as well: startup now restores dashboard / account / request-log snapshots earlier, successful login refreshes the accounts table automatically, and platform-key creation plus upstream-proxy save flows were cleaned up.
- The Web auth flow is safer: `codexmanager-web` still persists the password, but authenticated sessions are now scoped to the current Web process, so old cookies do not survive a full close-and-reopen cycle.
- The project is also undergoing long-term maintainability refactoring: the frontend entry/runtime layers, settings flow, request-log UI, Tauri command surface, service lifecycle, gateway protocol adapter, HTTP bridge, and upstream execution flow have all been split further into clearer module boundaries.
- The release pipeline stays consolidated under `release-all.yml` for one-click Windows / macOS / Linux publishing, with local frontend build fallback when prebuilt artifacts are unavailable.

## Features
- Account pool management: groups, tags, sorting, notes
- Bulk import / export: multi-file import, recursive desktop folder import for JSON, one-file-per-account export
- Usage dashboard: 5-hour + 7-day windows, plus accounts that only expose a 7-day window
- OAuth login: browser flow + manual callback parsing
- Platform keys: create, disable, delete, model binding
- Local service with configurable port
- Local OpenAI-compatible gateway for CLI and third-party tools

## Screenshots
![Dashboard](assets/images/dashboard.png)
![Accounts](assets/images/accounts.png)
![Platform Key](assets/images/platform-key.png)
![Logs](assets/images/log.png)
![Settings](assets/images/themes.png)

## Quick Start
1. Launch the desktop app and click `Start Service`.
2. Go to Accounts, add an account, and complete authorization.
3. If callback parsing fails, paste the callback URL manually.
4. Refresh usage and confirm the account status.

## Page Overview
### Desktop
- Accounts: bulk import/export, refresh accounts and usage
- Platform Keys: bind keys by model and inspect request logs
- Settings: manage ports, proxy, theme, auto-update, and background behavior

### Service Edition
- `codexmanager-service`: local OpenAI-compatible gateway
- `codexmanager-web`: browser-based management UI
- `codexmanager-start`: one command to launch service + web

## Core Docs
- Version history: [CHANGELOG.md](CHANGELOG.md)
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Testing baseline: [TESTING.md](TESTING.md)
- Security: [SECURITY.md](SECURITY.md)
- Docs index: [docs/README.md](docs/README.md)

## Topic Pages
| Page | Content |
| --- | --- |
| [Runtime and deployment guide](docs/report/20260310122606850_运行与部署指南.md) | First launch, Docker, Service edition, macOS allowlist |
| [Environment variables and runtime config](docs/report/20260309195355187_环境变量与运行配置说明.md) | App config, proxy, listen address, database, Web security |
| [FAQ and account-hit rules](docs/report/20260310122606852_FAQ与账号命中规则.md) | Account hit logic, challenge blocks, import/export, common issues |
| [Minimal troubleshooting guide](docs/report/20260307234235414_最小排障手册.md) | Fast path for service startup, forwarding, and model refresh issues |
| [Build, release, and script guide](docs/release/20260310122606851_构建发布与脚本说明.md) | Local build, Tauri packaging, Release workflow, script flags |
| [Release assets guide](docs/release/20260309195355216_发布与产物说明.md) | Platform artifacts, naming, release vs pre-release |
| [Script and release responsibility matrix](docs/report/20260309195735631_脚本与发布职责对照.md) | Which script owns which step |
| [Protocol regression checklist](docs/report/20260309195735632_协议兼容回归清单.md) | `/v1/chat/completions`, `/v1/responses`, tools regression items |
| [CHANGELOG.md](CHANGELOG.md) | Latest release notes, unreleased changes, and full version history |

## Project Structure
```text
.
├─ apps/                # Frontend and Tauri desktop app
│  ├─ src/
│  ├─ src-tauri/
│  └─ dist/
├─ crates/              # Rust core/service crates
│  ├─ core
│  ├─ service
│  ├─ start              # Service starter (launches service + web)
│  └─ web                # Service Web UI (optional embedded assets + /api/rpc proxy)
├─ docs/                # Formal project documentation
├─ scripts/             # Build and release scripts
└─ README.en.md
```

## Acknowledgements And References

- CPA (CLIProxyAPI): this project references its protocol adaptation, request forwarding, and compatibility design <https://github.com/router-for-me/CLIProxyAPI>
- Main reference areas:
- `crates/service/src/gateway/protocol_adapter/request_mapping.rs`
- `crates/service/src/gateway/protocol_adapter/response_conversion/`
- `crates/service/src/gateway/upstream/`

## Contact

<p align="center">
  <img src="assets/images/group.jpg" alt="Telegram Group QR Code" width="280" />
  <img src="assets/images/qq_group.jpg" alt="QQ Group QR Code" width="280" />
</p>

- Telegram group: <https://t.me/+8o2Eu7GPMIFjNDM1>
- QQ group: scan the QR code
- WeChat Official Account: 七线牛马
