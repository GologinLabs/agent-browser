# GoLogin Agent CLI

GoLogin Agent CLI is a cloud browser automation CLI built for AI agents. It turns GoLogin Cloud Browser into a persistent, scriptable runtime with compact page snapshots, ref-based interaction, session memory, and shell-friendly commands.

It is designed for agent loops that need to stay simple:

- open a live browser session
- read the page as a compact text snapshot
- act on stable refs like `@e3`
- keep working across multiple CLI calls through a local daemon
- save artifacts such as screenshots and PDFs when needed

Unlike local-browser automation tools, it runs on top of a cloud browser stack built around GoLogin profiles, proxies, fingerprinting, and anti-detect capabilities.

## Why Cloud Browser

Local-browser automation is convenient, but it comes with hard limits for agent workflows that need to survive real-world websites:

- local browsers are easier to detect
- local runs usually do not carry profile-based fingerprinting
- local runs do not come with persistent cloud browser profiles
- local networking is limited unless you bolt on your own proxy layer
- local sessions are harder to standardize across agents and environments

GoLogin Agent CLI takes the opposite approach:

- cloud browser runtime instead of a local browser process
- GoLogin profiles as the session identity layer
- proxy-aware browser sessions
- fingerprint and anti-detect capabilities inherited from GoLogin
- a persistent daemon that keeps agent sessions alive across CLI calls

## Architecture

The system has two parts:

- `gologin-agent` CLI
- a persistent local daemon

The CLI parses commands, auto-starts the daemon when needed, and prints compact output for agents. The daemon owns live browser sessions, connects to GoLogin Cloud Browser through Playwright `connectOverCDP`, keeps the active page in memory, builds snapshots, resolves refs like `@e1`, and tracks session metadata such as proxy mode, idle timeout, and generated artifacts.

If you do not provide a profile id, the daemon creates a temporary GoLogin cloud profile through the GoLogin API, uses it to open the session, and attempts to delete it when the session is closed.

Transport is local only:

- Unix socket at `${TMPDIR:-/tmp}/gologin-agent.sock` on Unix-like systems
- localhost HTTP on `127.0.0.1:${GOLOGIN_DAEMON_PORT:-44777}`

## Installation

```bash
cd "/Users/eugene/Desktop/vibe coding projects/gologin-agent"
npm install
npm run build
```

Optional local linking:

```bash
npm link
```

After `npm link`, the `gologin-agent` command is available directly. Without linking, run `node dist/cli.js ...`.

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

Save it as `~/.gologin-agent/config.json`.

## Quickstart

```bash
export GOLOGIN_TOKEN=your_token

node dist/cli.js open https://example.com
node dist/cli.js open https://example.com --proxy-host 1.2.3.4 --proxy-port 8080 --proxy-mode http --idle-timeout-ms 300000
node dist/cli.js open https://example.com --profile your-preconfigured-gologin-profile
node dist/cli.js snapshot -i
node dist/cli.js current
node dist/cli.js click @e3
node dist/cli.js click "a[href*='iana']"
node dist/cli.js fill "input[name='email']" "test@example.com"
node dist/cli.js type @e4 "hello world"
node dist/cli.js focus "input[name='email']"
node dist/cli.js press Enter
node dist/cli.js select "select[name='plan']" pro
node dist/cli.js check "input[name='terms']"
node dist/cli.js uncheck "input[name='newsletter']"
node dist/cli.js scroll down 600
node dist/cli.js scrollintoview "#submit"
node dist/cli.js find label "Email" fill "test@example.com"
node dist/cli.js upload "input[type='file']" ./fixtures/avatar.png
node dist/cli.js get title
node dist/cli.js wait --text "Welcome"
node dist/cli.js pdf page.pdf
node dist/cli.js screenshot page.png --annotate
node dist/cli.js sessions
node dist/cli.js close
```

If you linked the package:

```bash
gologin-agent open https://example.com --proxy-host 1.2.3.4 --proxy-port 8080
gologin-agent snapshot -i
gologin-agent click @e3
gologin-agent fill "input[name='email']" "test@example.com"
gologin-agent screenshot page.png --annotate
gologin-agent close
```

## Commands

- `open <url> [--profile <profileId>] [--session <sessionId>] [--idle-timeout-ms <ms>]`
- `open <url> [--proxy-host <host> --proxy-port <port> --proxy-mode <http|socks4|socks5> --proxy-user <user> --proxy-pass <pass>]`
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
- `find <role|text|label|placeholder|first|last|nth> ...`
- `upload <target> <file...> [--session <sessionId>]`
- `pdf <path> [--session <sessionId>]`
- `screenshot <path> [--annotate] [--session <sessionId>]`
- `close [--session <sessionId>]`
- `sessions`
- `current`

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
gologin-agent click @e3
gologin-agent type @e4 "hello world"
gologin-agent fill "input[name='email']" "test@example.com"
gologin-agent find role button click --name "Submit"
gologin-agent screenshot page.png --annotate
```

Targets can be either snapshot refs like `@e4` or raw Playwright/CSS selectors. `find` adds semantic locator flows similar to agent-browser.

`open`, `current`, and `sessions` also expose session metadata in a shell-friendly form:

```text
session=s1 url=https://example.com snapshot=fresh proxy=http:1.2.3.4:8080 idleTimeoutMs=300000 shot=/tmp/page.png pdf=/tmp/page.pdf
```

When screenshots or PDFs are generated, `current` and `sessions` include the latest artifact paths as `shot=...` and `pdf=...`.

Supported aliases:

- `goto`, `navigate` -> `open`
- `key` -> `press`
- `scrollinto` -> `scrollintoview`
- `quit`, `exit` -> `close`

## Current Scope

- Session persistence lasts as long as the local daemon is running. Restarting the daemon clears in-memory sessions and refs.
- Idle timeout is a local daemon policy. It does not change GoLogin account-level cloud limits.
- Snapshot and ref resolution are best-effort. Dynamic pages can invalidate refs after heavy DOM changes or navigation.
- Snapshot output is compact and accessibility-informed, but it is not a full accessibility tree dump.
- Annotated screenshots are based on the current snapshot/ref model, so labels are also best-effort on highly dynamic pages.
- The daemon keeps only the latest snapshot ref map for each session.
- Real browser sessions require a valid GoLogin Cloud Browser account and token. A profile id is optional.
- Token-only mode works by provisioning a temporary cloud profile through the GoLogin API before connecting to Cloud Browser.
- Proxy support is cloud-profile based. Temporary profiles can be created with a custom proxy definition, and existing GoLogin profiles can be reused with `--profile` if they already have a managed proxy attached.
- Local Orbita is intentionally out of scope. This project targets GoLogin Cloud Browser only.
- GoLogin cloud live-view URLs are not auto-fetched by default because the current endpoint can interfere with an active CDP session.
- Playwright is the automation layer on top of GoLogin Cloud Browser. The browser runtime itself does not expose built-in agent actions such as `click()` or `type()`.

## Live Smoke Check

The project includes a smoke test path that only runs when `GOLOGIN_TOKEN` is present in the environment. If `GOLOGIN_PROFILE_ID` is also set, the smoke flow can reuse that profile; otherwise GoLogin can create a temporary session profile automatically. Secrets are never written into source files, tests, or examples.
