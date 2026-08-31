# GoLogin Agent Browser CLI

GoLogin Agent Browser CLI lets agents run real GoLogin browser profiles, interact with pages, keep sessions alive, and manage profile/proxy operations from shell-friendly commands.

Use this CLI when the task is primarily live browser automation: login, dashboard work, repeated clicks and typing, screenshots, PDFs, uploads, warmup, profile hygiene, or browser session cleanup. If the task is mainly scrape-first reading, extraction, mapping, or crawling on a known site, use `gologin-web-access` instead.

It is designed for agent loops that need to stay simple:

- open a live browser session
- read the page as a compact text snapshot
- act on stable refs like `@e3`
- keep working across multiple CLI calls through a local daemon
- save artifacts such as screenshots and PDFs when needed
- inspect daemon health with `doctor`
- manage tabs, cookies, storage, and in-page eval without dropping to raw Playwright
- manage GoLogin API resources through first-class commands, with raw `api` available only as a fallback
- choose the runtime per task: cloud browser or local Orbita profile

Unlike generic browser automation tools, it runs on top of GoLogin profiles, proxies, fingerprinting, anti-detect capabilities, and the same command model for cloud and local runtimes.

## Runtime Model

The public product is one CLI with two runtime providers:

- `cloud`: GoLogin Cloud Browser. Use it for remote browser sessions, parallel cloud tasks, screenshots/PDFs, and workflows where the local machine should not run Orbita.
- `local`: local GoLogin Orbita. Use it for profile warmup, native desktop profile state, first-login checkpoints, local OS alignment, and workflows that should reuse local Orbita state.

Cloud is the default because it is the safest agent baseline. Select local explicitly when local profile state matters:

```bash
gologin-agent-browser open https://example.com
gologin-agent-browser open https://example.com --runtime cloud
gologin-agent-browser open https://example.com --runtime local
gologin-agent-browser local open https://example.com
```

Local-only commands such as `profile-create`, `profile-update`, `run`, `batch`, and `jobs` automatically route to the local runtime, so agents do not need the old separate binary.

## Architecture

The system has three parts:

- `gologin-agent-browser` CLI
- cloud runtime daemon
- embedded local Orbita runtime daemon

The CLI parses commands, chooses a runtime, auto-starts the matching daemon when needed, and prints compact output for agents. Runtime daemons own live browser sessions, connect through Playwright `connectOverCDP`, keep the active page in memory, build snapshots, resolve refs like `@e1`, and track session metadata such as proxy mode, idle timeout, and generated artifacts.

For cloud runtime, if you do not provide a profile id, the daemon creates a temporary GoLogin cloud profile through the GoLogin API, uses it to open the session, and attempts to delete it when the session is closed.

Temporary cloud profiles are convenient, but they inherit GoLogin backend defaults for browser line, fingerprint, and viewport. If you need predictable browser version, country proxy, or screen characteristics, create or reuse an explicit cloud profile and pass `--profile`.

For local runtime, a profile id is required for real browser sessions. Local runtime keeps compatibility with existing local-agent state under `~/.gologin-local-agent-browser/` so current warmup profiles and job history remain usable during migration.

Transport is local only:

- Unix socket at `${TMPDIR:-/tmp}/gologin-agent-browser.sock` on Unix-like systems
- localhost HTTP on `127.0.0.1:${GOLOGIN_DAEMON_PORT:-44777}`

## Installation

Node.js 18+ is required.

Install from npm:

```bash
npm install -g gologin-agent-browser-cli
```

Run it directly:

```bash
gologin-agent-browser --help
```

Or use it without a global install:

```bash
npx gologin-agent-browser-cli --help
```

Developer setup from source:

```bash
git clone https://github.com/GologinLabs/agent-browser.git
cd agent-browser
npm install
npm run build
```

## Get a Gologin Token

You need a Gologin account with API access before you can open cloud browser sessions.

1. Sign up or log in at [Gologin](https://gologin.com/).
2. In the Gologin dashboard, open `API & MCP`.
3. Open the `API` tab.
4. Click `New Token`.
5. Copy the generated access token.

Then export it in your shell:

```bash
export GOLOGIN_TOKEN='your_gologin_token'
```

API access depends on your Gologin account and plan. If token creation is unavailable in the dashboard, check your account access before troubleshooting the CLI.

Note: the local daemon reads environment variables and config on startup. If you change `GOLOGIN_TOKEN` or `~/.gologin-agent-browser/config.json`, restart the daemon before running `open` again.

If you prefer a local config file instead of an environment variable, save the same token to `~/.gologin-agent-browser/config.json`.

## Required Environment

- `GOLOGIN_TOKEN` required for `open` and REST-backed profile/proxy commands
- `GOLOGIN_PROFILE_ID` optional default profile for `open`
- `GOLOGIN_AGENT_BROWSER_RUNTIME` optional default runtime: `cloud`, `local`, or `auto`
- `GOLOGIN_DAEMON_PORT` optional. Cloud defaults to `44777`; local defaults to `44778`
- `GOLOGIN_CONNECT_BASE` optional, defaults to `https://cloudbrowser.gologin.com/connect`
- `GOLOGIN_EXECUTABLE_PATH` optional local Orbita executable path for local runtime

Optional config file:

```json
{
  "token": "from-your-own-secret-store",
  "defaultProfileId": "profile-id",
  "daemonPort": 44777,
  "connectBase": "https://cloudbrowser.gologin.com/connect"
}
```

Save it as `~/.gologin-agent-browser/config.json`.

## Quickstart

```bash
export GOLOGIN_TOKEN='your_gologin_token'

gologin-agent-browser open https://example.com
gologin-agent-browser snapshot -i
gologin-agent-browser click @e3
gologin-agent-browser close
```

## Puppeteer Cloud Browser Example

This example shows how to connect to GoLogin Cloud Browser from an external Puppeteer script using the same connect semantics used by the repo itself: build a Cloud Browser connect URL, preflight it, convert it to a WebSocket endpoint, then call `puppeteer.connect()`.

Prerequisites:

```bash
npm install
```

Set the environment variable:

```bash
export GOLOGIN_TOKEN='your_gologin_token'
```

Optional: use an existing GoLogin profile instead of creating a temporary one:

```bash
export GOLOGIN_PROFILE_ID='your_profile_id'
```

Run the example:

```bash
node examples/puppeteer-cloud-browser.mjs
```

Expected output:

```text
Connected to GoLogin Cloud Browser
Page title: Example Domain
Disconnected
```

Temporary profile behavior:

- If `GOLOGIN_PROFILE_ID` is not set, the example creates a temporary profile through the GoLogin API and deletes it in `finally`.
- If `GOLOGIN_PROFILE_ID` is set by the user, the example leaves that profile alone and only disconnects the browser session.
- The script never prints the token or the authenticated connect URL.

Local profile quickstart:

```bash
export GOLOGIN_TOKEN='your_gologin_token'

gologin-agent-browser profile-create "reddit-main" --template smm --proxy-country us
gologin-agent-browser open https://example.com --runtime local --profile your_profile_id
gologin-agent-browser snapshot -i --runtime local
gologin-agent-browser close --runtime local
```

## Decision Table

Use `gologin-agent-browser` when:

- the user explicitly wants a GoLogin browser session
- the task is login, dashboard work, or repeated interactive browsing
- screenshots, PDFs, uploads, cookies, storage, or tabs are part of the flow
- session hygiene itself is the task

Runtime choice:

- use `--runtime cloud` for cloud scale, remote browser sessions, or no-local-browser workflows
- use `--runtime local` for local Orbita, warmup, native OS, and persistent local profile workflows
- use `gologin-web-access` instead for scrape-first reading, extraction, mapping, crawling, or monitoring on a known site

## How Refs Work

`gologin-agent-browser snapshot` prints a compact page view and assigns refs like `@e1`, `@e2`, and `@e3`.

Example:

```text
- link "More information..." [ref=@e3]
```

You can then act on that element with commands like:

```bash
gologin-agent-browser click @e3
```

Refs are best-effort and should be regenerated after navigation or major DOM changes.

Most mutating commands will leave the page in `snapshot=stale` state. When that happens, run `snapshot` again before using old refs.

On dynamic pages, `find ...` is usually a better fallback than stale refs because it re-resolves against the live page instead of the last snapshot.

## More Examples

```bash
gologin-agent-browser open https://example.com --proxy-host 1.2.3.4 --proxy-port 8080 --proxy-mode http --idle-timeout-ms 300000
gologin-agent-browser open https://example.com --profile your-preconfigured-gologin-profile
gologin-agent-browser open https://example.com --session s1
gologin-agent-browser open https://example.org --session s2
gologin-agent-browser tabs
gologin-agent-browser tabopen https://www.iana.org
gologin-agent-browser tabfocus 2
gologin-agent-browser tabclose 2
gologin-agent-browser click "a[href*='iana']"
gologin-agent-browser type "textarea[name='message']" "hello world"
gologin-agent-browser focus "input[name='email']"
gologin-agent-browser press Enter
gologin-agent-browser select "select[name='plan']" pro
gologin-agent-browser check "input[name='terms']"
gologin-agent-browser uncheck "input[name='newsletter']"
gologin-agent-browser scrollintoview "#submit"
gologin-agent-browser find label "Email" fill "test@example.com"
gologin-agent-browser upload --discover
gologin-agent-browser upload "input[type='file']" /absolute/path/to/avatar.png
gologin-agent-browser wait --text "Welcome"
gologin-agent-browser cookies --json
gologin-agent-browser cookies-import cookies.json
gologin-agent-browser storage-export /tmp/storage.json
gologin-agent-browser eval "document.title" --json
gologin-agent-browser back
gologin-agent-browser forward
gologin-agent-browser reload
gologin-agent-browser screenshot page.png --annotate --press-escape
gologin-agent-browser browser list --page 1
gologin-agent-browser browser get your-profile-id
gologin-agent-browser browser name your-profile-id --name "LinkedIn AE 01"
gologin-agent-browser browser proxy your-profile-id --data '{"mode":"gologin","autoProxyRegion":"us"}'
gologin-agent-browser browser cloud-start your-profile-id
gologin-agent-browser browser cloud-stop your-profile-id
gologin-agent-browser proxy list --json
gologin-agent-browser proxy add-gologin your-profile-id --country us --type residential
gologin-agent-browser workspace list --json
gologin-agent-browser workspace profiles your-workspace-id --country US --offset 0
gologin-agent-browser cloud-usage --profile your-profile-id
gologin-agent-browser profile-cloud start your-profile-id
gologin-agent-browser profile-cloud stop your-profile-id
gologin-agent-browser profile-cookies export your-profile-id --output cookies.json
gologin-agent-browser profile-cookies import your-profile-id cookies.json --clean
gologin-agent-browser profile-fingerprint refresh your-profile-id
gologin-agent-browser profile-ua latest --os mac
gologin-agent-browser profile-ua update your-profile-id
gologin-agent-browser profile-create "LinkedIn AE 01" --template linkedin --proxy-country us
gologin-agent-browser profile-update your-profile-id --template smm --add-tags warm,logged-in
gologin-agent-browser run ./examples/runbook-warmup.json --runtime local --profile your-profile-id
gologin-agent-browser jobs
```

## Parallel Sessions

Independent cloud tasks do not have to run one by one. Use explicit session ids:

```bash
gologin-agent-browser open https://example.com --session s1
gologin-agent-browser open https://example.org --session s2
gologin-agent-browser sessions
gologin-agent-browser snapshot --session s1 -i
gologin-agent-browser snapshot --session s2 -i
```

When the slate should be reset:

```bash
gologin-agent-browser sessions --prune --older-than-ms 300000
gologin-agent-browser close --all
```

`close --all` only closes sessions tracked by the current daemon. If cloud capacity is still exhausted afterward, another daemon or external workflow is likely holding the remaining slot.

## Cookie Formats

`cookies-import` imports cookies into the currently running browser session. It accepts Playwright cookie JSON and GoLogin-exported/API cookie JSON, including GoLogin `sameSite` values such as `no_restriction` and `unspecified`, and GoLogin `expirationDate`.

Use `profile-cookies import <profileId> cookies.json --clean` when you want to write GoLogin profile cookies through the GoLogin API before launching a browser session.

## Proxy Rules

- Temporary cloud profiles support no proxy or a custom proxy host/port.
- `--proxy-country` is not available for temporary cloud profiles.
- If you need GoLogin country traffic, attach a managed proxy to a reusable profile with `proxy add-gologin <profileId> --country us`, then pass `--profile`.
- Do not invent free proxies as a fallback. If the proxy strategy matters, decide it before opening the session.

REST-backed proxy commands do not require the daemon:

```bash
gologin-agent-browser proxy list --json
gologin-agent-browser proxy traffic
gologin-agent-browser proxy add-gologin your-profile-id --country us --type residential
```

## GoLogin API Resources

GoLogin API resources are available as named CLI actions and do not start the browser daemon:

```bash
gologin-agent-browser browser list --page 1
gologin-agent-browser browser get your-profile-id
gologin-agent-browser browser create --body-file ./profile.json
gologin-agent-browser browser update your-profile-id --body-file ./profile-update.json
gologin-agent-browser browser cookies your-profile-id --output cookies.json
gologin-agent-browser browser cookies-update your-profile-id --data @cookies.json --clean-cookies true
gologin-agent-browser browser fingerprints-refresh your-profile-id another-profile-id
gologin-agent-browser browser proxy your-profile-id --data '{"mode":"gologin","autoProxyRegion":"us"}'
gologin-agent-browser browser cloud-start your-profile-id
gologin-agent-browser browser cloud-stop your-profile-id
gologin-agent-browser browser export --data '{"browserIds":["profile-id"]}' --output profiles.csv
gologin-agent-browser workspace profiles your-workspace-id --country US --offset 0
```

The resource command groups cover the current GoLogin API surface:

- `browser`: profiles, fingerprints, cookies, profile updates, cloud start/stop, clone, import/export
- `proxy`: proxy CRUD, shared proxies, GoLogin managed proxy creation, traffic
- `workspace`: workspaces, workspace profiles, member operations, transfers
- `share`: profile and folder sharing operations
- `template`: profile templates
- `folder`: folders
- `user`: user info and dev token creation
- `deleted-profile`: list and restore deleted profiles

For endpoints whose schema is broad or changes often, pass the API body with `--data '<json>'`, `--data @file.json`, or `--body-file file.json`. Common small updates also have direct flags, for example `browser name <id> --name ...`, `browser notes <id> --notes ...`, `workspace rename <id> --name ...`, and `proxy add-gologin <profileId> --country us`.

Raw `api` is still available as an escape hatch:

```bash
gologin-agent-browser api GET /browser/v2 --query page=1 --header cf-ipcountry=US
gologin-agent-browser api GET /browser/your-profile-id
gologin-agent-browser api PUT /browser/your-profile-id --body-file ./profile-update.json
gologin-agent-browser api PATCH /browser/your-profile-id/name --data '{"name":"LinkedIn AE 01"}'
gologin-agent-browser api POST /browser/browsers.csv --data '{"browserIds":["profile-id"]}' --output profiles.csv
```

`api` uses `GOLOGIN_TOKEN`, does not start the browser daemon, accepts repeated `--query key=value`, accepts API headers with `--header key=value`, and accepts JSON bodies either inline (`--data '{"x":1}'`) or from a file (`--data @payload.json` / `--body-file payload.json`).

## Commands

- `doctor [--json]`
- `api <GET|POST|PUT|PATCH|DELETE> <path> [--query k=v] [--header k=v] [--data JSON|@file] [--body-file file] [--output file] [--json]`
- `browser <list|get|create|update|delete|cookies|proxy|cloud-start|cloud-stop|...> [args] [--data JSON|@file] [--json]`
- `proxy <list|get|add-gologin|add-many|update|delete|traffic|...> [args] [--data JSON|@file] [--json]`
- `workspace <list|get|create|rename|profiles|member-add|...> [args] [--data JSON|@file] [--json]`
- `share <create|delete|create-many|delete-folder> [args] [--data JSON|@file] [--json]`
- `template <list|create|update> [args] [--data JSON|@file] [--json]`
- `folder <list|create> [args] [--data JSON|@file] [--json]`
- `user <get|dev-token> [--data JSON|@file] [--json]`
- `deleted-profile <list|restore> [--workspace <workspaceId>] [--offset <n>] [--data JSON|@file] [--json]`
- `cloud-usage --profile <profileId> | --workspace <workspaceId> [--days <1-30>] [--json]`
- `profile-cloud <start|stop> <profileId> [--json]`
- `profile-cookies <export|import> <profileId> [cookies.json] [--output <path>] [--clean] [--json]`
- `profile-fingerprint refresh <profileId...> [--json]`
- `profile-proxy <list|traffic|add-gologin> ... [--json]`
- `profile-ua <latest|update> ... [--json]`
- `profiles [--local|--remote|--all] [--json]`
- `profile <profileId> [--local|--remote] [--json]`
- `profile-create <name> [--template <linkedin|ads|facebook|smm|scraping|geo>] [--proxy-country <country> | --proxy-host <host> --proxy-port <port>]`
- `profile-update <profileId> [--template <linkedin|ads|facebook|smm|scraping|geo>] [--proxy-country <country> | --proxy-host <host> --proxy-port <port>]`
- `profile-import <profileId>`
- `profile-sync <profileId> [--json]`
- `profile-delete <profileId> [--remote]`
- `run <runbook.json> [--profile <profileId>] [--runtime local]`
- `batch <runbook.json> --targets <targets.json> [--runtime local]`
- `jobs [--json]`
- `job <jobId> [--json]`
- `open <url> [--profile <profileId>] [--session <sessionId>] [--idle-timeout-ms <ms>]`
- `open <url> [--proxy-host <host> --proxy-port <port> --proxy-mode <http|socks4|socks5> --proxy-user <user> --proxy-pass <pass>]`
- `tabs [--session <sessionId>]`
- `tabopen [url] [--session <sessionId>]`
- `tabfocus <index> [--session <sessionId>]`
- `tabclose [index] [--session <sessionId>]`
- `cookies [--session <sessionId>] [--output <path>] [--json]`
- `cookies-import <cookies.json> [--session <sessionId>]`
- `cookies-clear [--session <sessionId>]`
- `storage-export [path] [--scope <local|session|both>] [--session <sessionId>] [--json]`
- `storage-import <storage.json> [--scope <local|session|both>] [--clear] [--session <sessionId>]`
- `storage-clear [--scope <local|session|both>] [--session <sessionId>]`
- `eval <expression> [--json] [--session <sessionId>]`
- `snapshot [--session <sessionId>] [--interactive]`
- `click <target> [--session <sessionId>]`
- `dblclick <target> [--session <sessionId>]`
- `focus <target> [--session <sessionId>]`
- `type <target> <text> [--session <sessionId>]`
- `fill <target> <text> [--session <sessionId>]`
- `hover <target> [--session <sessionId>]`
- `select <target> <value> [--session <sessionId>]`
- `check <target> [--session <sessionId>]`
- `uncheck <target> [--session <sessionId>]`
- `press <key> [target] [--session <sessionId>]`
- `scroll <up|down|left|right> [pixels] [--target <target>] [--session <sessionId>]`
- `scrollintoview <target> [--session <sessionId>]`
- `wait <target|ms> [--text <text>] [--url <pattern>] [--load <state>] [--session <sessionId>]`
- `get <text|value|html|title|url> [target] [--session <sessionId>]`
- `back [--session <sessionId>]`
- `forward [--session <sessionId>]`
- `reload [--session <sessionId>]`
- `find <role|text|label|placeholder|first|last|nth> ...`
- `upload <target> <file...> [--session <sessionId>]`
- `upload --discover [--session <sessionId>]`
- `pdf <path> [--session <sessionId>]`
- `screenshot <path> [--annotate] [--press-escape] [--session <sessionId>]`
- `close [--session <sessionId>]`
- `sessions`
- `current`

## Help And Diagnostics

Subcommand help, raw API calls, and REST-backed profile/proxy commands work without a daemon round-trip:

```bash
gologin-agent-browser open --help
gologin-agent-browser screenshot --help
gologin-agent-browser api GET /user
gologin-agent-browser profile-ua latest --os mac
```

When bootstrap is flaky, inspect the local setup directly:

```bash
gologin-agent-browser doctor
gologin-agent-browser doctor --json
```

`doctor` reports whether a token is configured, which connect base is configured, which local transports are reachable, and where the daemon log is written.

When a daemon is reachable, `doctor` also reports:

- the reachable transport
- how many tracked sessions the daemon is holding
- the active session id, if there is one

`open` now performs an HTTP preflight against the Cloud Browser connect URL before the Playwright CDP handshake. That means common `403` and `503` launch failures surface early with a readable reason instead of being buried inside a generic connection error.

## File Uploads

`upload` sets files on a real `input[type=file]`. It does not drive the operating system's native file picker. If the page shows a styled upload button, discover the underlying input first:

```bash
gologin-agent-browser snapshot -i
gologin-agent-browser upload --discover
gologin-agent-browser upload @e4 /absolute/path/to/document.pdf
```

You can also use a CSS selector directly:

```bash
gologin-agent-browser upload 'input[type="file"]' /absolute/path/to/document.pdf
```

Hidden file inputs are supported. `snapshot -i` and `upload --discover` mark upload candidates with `[upload] [file-input]`, and hidden candidates with `[hidden]`.

## Example Session Flow

`snapshot` produces compact output designed for agent consumption:

```text
session=s1 url=https://example.com/
- heading "Example Domain" [ref=@e1]
- paragraph "This domain is for use in illustrative examples in documents." [ref=@e2]
- link "More information..." [ref=@e3]
- checkbox "Accept terms" [checked] [ref=@e4]
- select "Plan" [selected=Pro] [ref=@e5]
```

Agents can then use those refs:

```bash
gologin-agent-browser click @e3
gologin-agent-browser check @e4
gologin-agent-browser fill "input[name='email']" "test@example.com"
gologin-agent-browser find role button click --name "Submit"
gologin-agent-browser screenshot page.png --annotate
```

Targets can be either snapshot refs like `@e4` or raw Playwright/CSS selectors. `find` adds semantic locator flows similar to agent-browser.

If a ref stops resolving after navigation or a DOM update, prefer a fresh `snapshot` or use a semantic `find ...` command instead.

`open`, `current`, and `sessions` also expose session metadata in a shell-friendly form:

```text
session=s1 url=https://example.com snapshot=fresh proxy=http:1.2.3.4:8080 idleTimeoutMs=300000 shot=/tmp/page.png pdf=/tmp/page.pdf
```

When screenshots or PDFs are generated, `current` and `sessions` include the latest artifact paths as `shot=...` and `pdf=...`.

Supported aliases:

- `goto`, `navigate` -> `open`
- `tabnew` -> `tabopen`
- `tabswitch` -> `tabfocus`
- `js` -> `eval`
- `key` -> `press`
- `scrollinto` -> `scrollintoview`
- `quit`, `exit` -> `close`

## Current Scope

- Session persistence lasts as long as the local daemon is running. Restarting the daemon clears in-memory sessions and refs.
- Idle timeout is a local daemon policy. It does not change Gologin account-level cloud limits.
- Snapshot and ref resolution are best-effort. Dynamic pages can invalidate refs after heavy DOM changes or navigation.
- Snapshot output is compact and accessibility-informed, but it is not a full accessibility tree dump.
- Annotated screenshots are based on the current snapshot/ref model, so labels are also best-effort on highly dynamic pages.
- `screenshot` has a hard timeout and supports `--press-escape` for pages with modals, chat widgets, or overlay-driven render issues.
- The daemon keeps only the latest snapshot ref map for each session.
- Real browser sessions require a valid GoLogin account token. A profile id is optional for cloud runtime and required for local runtime.
- Cloud token-only mode works by provisioning a temporary cloud profile through the GoLogin API before connecting to Cloud Browser.
- Proxy support is cloud-profile based. Temporary profiles can be created with a custom proxy definition, and existing Gologin profiles can be reused with `--profile` if they already have a managed proxy attached.
- The raw `api` command covers the full public GoLogin REST API surface. Named profile/proxy commands are convenience shortcuts for the highest-frequency operations.
- Local Orbita runtime is bundled as a provider and keeps its existing local state directory for migration safety.
- Gologin cloud live-view URLs are not auto-fetched by default because the current endpoint can interfere with an active CDP session.
- Playwright is the automation layer on top of the selected GoLogin browser runtime. The browser runtime itself does not expose built-in agent actions such as `click()` or `type()`.

## Test Coverage

The repository includes unit tests for config loading, snapshot formatting, arg parsing, and URL construction.

A full live browser smoke test is not shipped yet. If you want one, run a manual check with:

```bash
export GOLOGIN_TOKEN='your_gologin_token'
gologin-agent-browser open https://example.com
gologin-agent-browser snapshot -i
gologin-agent-browser close
```
