# Gologin Agent Browser CLI

Gologin Agent Browser CLI is a cloud browser automation CLI built for AI agents. It turns Gologin Cloud Browser into a persistent, scriptable runtime with compact page snapshots, ref-based interaction, session memory, and shell-friendly commands.

Use this CLI when the task is primarily a live cloud-browser session: login, dashboard work, repeated clicks and typing, screenshots, PDFs, uploads, or session cleanup. If the task is mainly scrape-first reading, extraction, mapping, or crawling on a known site, use `gologin-web-access` instead. If it must run inside a local Orbita profile with persistent local state, use `gologin-local-agent-browser` instead.

It is designed for agent loops that need to stay simple:

- open a live browser session
- read the page as a compact text snapshot
- act on stable refs like `@e3`
- keep working across multiple CLI calls through a local daemon
- save artifacts such as screenshots and PDFs when needed
- inspect daemon health with `doctor`
- manage tabs, cookies, storage, and in-page eval without dropping to raw Playwright

Unlike local-browser automation tools, it runs on top of a cloud browser stack built around Gologin profiles, proxies, fingerprinting, and anti-detect capabilities.

## Why Cloud Browser

Local-browser automation is convenient, but it comes with hard limits for agent workflows that need to survive real-world websites:

- local browsers are easier to detect
- local runs usually do not carry profile-based fingerprinting
- local runs do not come with persistent cloud browser profiles
- local networking is limited unless you bolt on your own proxy layer
- local sessions are harder to standardize across agents and environments

Gologin Agent Browser CLI takes the opposite approach:

- cloud browser runtime instead of a local browser process
- Gologin profiles as the session identity layer
- proxy-aware browser sessions
- fingerprint and anti-detect capabilities inherited from Gologin
- a persistent daemon that keeps agent sessions alive across CLI calls

## Architecture

The system has two parts:

- `gologin-agent-browser` CLI
- a persistent local daemon

The CLI parses commands, auto-starts the daemon when needed, and prints compact output for agents. The daemon owns live browser sessions, connects to Gologin Cloud Browser through Playwright `connectOverCDP`, keeps the active page in memory, builds snapshots, resolves refs like `@e1`, and tracks session metadata such as proxy mode, idle timeout, and generated artifacts.

If you do not provide a profile id, the daemon creates a temporary Gologin cloud profile through the Gologin API, uses it to open the session, and attempts to delete it when the session is closed.

Temporary cloud profiles are convenient, but they inherit GoLogin backend defaults for browser line, fingerprint, and viewport. If you need predictable browser version, country proxy, or screen characteristics, create or reuse an explicit cloud profile and pass `--profile`.

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

- `GOLOGIN_TOKEN` required for `open`
- `GOLOGIN_PROFILE_ID` optional default profile for `open`
- `GOLOGIN_DAEMON_PORT` optional, defaults to `44777`
- `GOLOGIN_CONNECT_BASE` optional, defaults to `https://cloudbrowser.gologin.com/connect`

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

## Decision Table

Use `gologin-agent-browser` when:

- the user explicitly wants a cloud browser session
- the task is login, dashboard work, or repeated interactive browsing
- screenshots, PDFs, uploads, cookies, storage, or tabs are part of the flow
- session hygiene itself is the task

Use another GoLogin CLI when:

- the task is scrape-first reading, extraction, mapping, crawling, or monitoring on a known site -> `gologin-web-access`
- the task depends on a local Orbita profile, persistent local cookies, or repeated rendered-DOM navigation on this machine -> `gologin-local-agent-browser`

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
gologin-agent-browser upload "input[type='file']" /absolute/path/to/avatar.png
gologin-agent-browser wait --text "Welcome"
gologin-agent-browser cookies --json
gologin-agent-browser storage-export /tmp/storage.json
gologin-agent-browser eval "document.title" --json
gologin-agent-browser back
gologin-agent-browser forward
gologin-agent-browser reload
gologin-agent-browser screenshot page.png --annotate --press-escape
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

## Proxy Rules

- Temporary cloud profiles support no proxy or a custom proxy host/port.
- `--proxy-country` is not available for temporary cloud profiles.
- If you need GoLogin country traffic, create or reuse a preconfigured cloud profile and pass `--profile`.
- Do not invent free proxies as a fallback. If the proxy strategy matters, decide it before opening the session.

## Commands

- `doctor [--json]`
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
- `pdf <path> [--session <sessionId>]`
- `screenshot <path> [--annotate] [--press-escape] [--session <sessionId>]`
- `close [--session <sessionId>]`
- `sessions`
- `current`

## Help And Diagnostics

Subcommand help now works without a daemon round-trip:

```bash
gologin-agent-browser open --help
gologin-agent-browser screenshot --help
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
- Real browser sessions require a valid Gologin Cloud Browser account and token. A profile id is optional.
- Token-only mode works by provisioning a temporary cloud profile through the Gologin API before connecting to Cloud Browser.
- Proxy support is cloud-profile based. Temporary profiles can be created with a custom proxy definition, and existing Gologin profiles can be reused with `--profile` if they already have a managed proxy attached.
- Local Orbita is intentionally out of scope. This project targets Gologin Cloud Browser only.
- Gologin cloud live-view URLs are not auto-fetched by default because the current endpoint can interfere with an active CDP session.
- Playwright is the automation layer on top of Gologin Cloud Browser. The browser runtime itself does not expose built-in agent actions such as `click()` or `type()`.

## Test Coverage

The repository includes unit tests for config loading, snapshot formatting, arg parsing, and URL construction.

A full live browser smoke test is not shipped yet. If you want one, run a manual check with:

```bash
export GOLOGIN_TOKEN='your_gologin_token'
gologin-agent-browser open https://example.com
gologin-agent-browser snapshot -i
gologin-agent-browser close
```
