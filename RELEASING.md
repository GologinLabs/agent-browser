# Releasing Gologin Agent Browser CLI

## Before first public publish

1. Make sure the npm package name is still available:
   `npm view gologin-agent-browser-cli version`
2. Make sure you are logged in to npm:
   `npm whoami`
3. Add an `NPM_TOKEN` secret to the GitHub repository.

## Local release checklist

1. Update `package.json` version.
2. Run:
   `npm install`
3. Run:
   `npm run release:check`
4. Smoke-check help output:
   `node dist/cli.js --help`
5. Smoke-check diagnostics:
   `node dist/cli.js doctor`
6. Publish:
   `npm publish --access public`

## Automated publish

The repository includes GitHub Actions workflows:

- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`

Suggested flow:

1. Push to the default branch and let CI pass.
2. Create a version tag such as `v0.2.0`.
3. Push the tag.
4. GitHub Actions publishes to npm using `NPM_TOKEN`.

## Notes

- The published npm package name is `gologin-agent-browser-cli`.
- The installed command is `gologin-agent-browser`.
- Recommended install is `npm install -g gologin-agent-browser-cli`.
