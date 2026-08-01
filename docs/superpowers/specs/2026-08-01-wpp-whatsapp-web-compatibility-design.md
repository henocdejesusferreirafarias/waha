# WPP compatibility hotfix for WhatsApp Web 2.3000.1044306241

## Context

WAHA Core 2026.7.2 resolves `@wppconnect-team/wppconnect` 2.2.3 and
`@wppconnect/wa-js` 4.4.1. The production WPP session runs WhatsApp Web
2.3000.1044306241. WA-JS versions before 4.4.3 cannot resolve `MsgStore` after
the WhatsApp Web module change introduced in 2.3000.1044096409.

The incompatibility has two observed effects:

- `POST /api/sendText` reaches WPPConnect but fails in `getMessageById` with
  `Cannot read properties of undefined (reading 'get')`, while the WhatsApp
  message remains pending with ACK 0.
- The global webhook is configured for `message.any`, but WAHA never logs
  `Sending POST`. WA-JS registers the underlying message event through
  `MsgStore.on('add', ...)`, so the missing store prevents the event from
  reaching WAHA's webhook conductor.

The fork is `henocdejesusferreirafarias/waha`, with `core` as its default
branch. EasyPanel will build the existing Dockerfile directly from that branch.

## Goal

Restore WPP text sending and `message.any` event production on the current
WhatsApp Web version without changing WAHA API responses, webhook payloads,
session configuration, or the n8n workflow.

## Non-goals

- Changing from the WPP engine.
- Adapting n8n to another engine's payload.
- Deploying or restarting the production container.
- Publishing a prebuilt image to a container registry.
- Refactoring the WPP session implementation.

## Dependency strategy

Replace moving Git branch specifications with exact compatible releases:

- `@wppconnect-team/wppconnect`: 2.2.6
- `@wppconnect/wa-js`: 4.5.0

WPPConnect 2.2.5 first incorporated the WA-JS 4.4.3 compatibility fix, and
2.2.6 updates the supported WhatsApp Web version data. WA-JS 4.5.0 includes
the MsgStore compatibility fix plus the subsequent loader-settling fix for
cold starts and reconnections. Exact releases make EasyPanel rebuilds
reproducible and prevent a future rebuild from silently resolving a different
Git commit.

The Yarn lockfile must resolve those exact versions. No application code or
DTO changes are required.

## Regression protection

Add a focused unit test next to the WPP engine that reads the installed package
metadata and asserts the minimum safe versions:

- WPPConnect is at least 2.2.5.
- WA-JS is at least 4.4.3.

The test must first be observed failing with the current 2.2.3/4.4.1 lock and
then passing after the dependency update. This protects the fork from an
accidental lockfile rollback while allowing deliberate future upgrades.

## Validation

Run the following layers in order:

1. Immutable dependency installation.
2. Focused WPP dependency compatibility test.
3. Full unit test suite.
4. Lint.
5. TypeScript/Nest build.
6. Linux/AMD64 Docker build from the repository Dockerfile with Chromium and
   `WHATSAPP_DEFAULT_ENGINE=WPP`.
7. Inspect the built image to confirm the resolved WPPConnect and WA-JS
   versions and the WPP default engine.

The local checks prove dependency selection, compilation, tests, and Docker
packaging. They cannot prove a live WhatsApp send or webhook delivery without
a paired account. Those runtime checks remain a post-deployment acceptance
step in EasyPanel and must not be reported as completed by this change.

## GitHub delivery

Work on `fix/wpp-wa-web-104430`, push the branch to the fork, and open a pull
request against `core`. The pull request will include the diagnosis, exact
dependency changes, red/green regression evidence, and Docker verification.

Squash merge requires a separate explicit approval. After merge, EasyPanel can
build the existing Dockerfile from `core`; no GHCR workflow or registry setup
is needed.

## Acceptance criteria

- `package.json` and `yarn.lock` resolve the selected exact WPP releases.
- The regression test fails on the original dependency set and passes on the
  corrected set.
- Unit tests, lint, and application build complete successfully.
- A Linux/AMD64 WPP Docker image builds successfully from the unchanged
  EasyPanel entrypoint, the repository Dockerfile.
- Image inspection reports WPPConnect 2.2.6, WA-JS 4.5.0, and WPP as the
  default engine.
- No WAHA endpoint, response DTO, webhook event name, or payload shape changes.
- No production container is modified by this work.
