# WPP WhatsApp Web Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore WPP text sending and `message.any` event production on WhatsApp Web 2.3000.1044306241 by pinning compatible WPPConnect dependencies without changing WAHA or n8n contracts.

**Architecture:** Keep the WAHA WPP adapter unchanged and correct the incompatible vendor layer by replacing moving Git branch dependencies with exact npm releases. Add a focused unit test that reads the installed package metadata and enforces the minimum versions containing the MsgStore fix, then validate the same dependency set inside the repository Docker image used by EasyPanel.

**Tech Stack:** Node.js, TypeScript, Jest, Yarn 4.17.1, NestJS, WPPConnect, WA-JS, Docker, GitHub CLI.

## Global Constraints

- Keep the WPP engine and existing WAHA API, response DTO, webhook event name, and payload shape unchanged.
- Pin `@wppconnect-team/wppconnect` exactly to `2.2.6`.
- Pin `@wppconnect/wa-js` exactly to `4.5.0`.
- Enforce minimum safe versions WPPConnect `2.2.5` and WA-JS `4.4.3` in the regression test.
- Do not change n8n, production containers, EasyPanel services, or publish to GHCR.
- Build the existing repository `Dockerfile` for Linux/AMD64 with Chromium and `WHATSAPP_DEFAULT_ENGINE=WPP`.
- Commit subjects for this Core-only change must start with `[core]`.
- Push a branch and open a pull request against `core`; do not merge without separate explicit approval.

---

### Task 1: Guard and correct the WPP dependency set

**Files:**

- Create: `src/core/engines/wpp/dependencies.test.ts`
- Modify: `package.json:63-64`
- Modify: `yarn.lock`

**Interfaces:**

- Consumes: package metadata exposed by `@wppconnect-team/wppconnect/package.json` and `@wppconnect/wa-js/package.json`.
- Produces: a Jest regression test named `WPP dependency compatibility` and an immutable lock resolving WPPConnect 2.2.6 plus WA-JS 4.5.0.

- [ ] **Step 1: Install the original immutable dependency set and confirm the incompatible baseline**

Run:

```powershell
corepack yarn install --immutable
node -e "console.log(require('@wppconnect-team/wppconnect/package.json').version, require('@wppconnect/wa-js/package.json').version)"
```

Expected: installation succeeds and the version line is `2.2.3 4.4.1`.

- [ ] **Step 2: Write the focused compatibility test**

Create `src/core/engines/wpp/dependencies.test.ts` with:

```typescript
import wppconnectPackage = require('@wppconnect-team/wppconnect/package.json');
import waJsPackage = require('@wppconnect/wa-js/package.json');

function isVersionAtLeast(actual: string, minimum: string): boolean {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);

  for (let index = 0; index < minimumParts.length; index += 1) {
    if (actualParts[index] > minimumParts[index]) {
      return true;
    }
    if (actualParts[index] < minimumParts[index]) {
      return false;
    }
  }

  return true;
}

describe('WPP dependency compatibility', () => {
  it('uses a WPPConnect release containing the MsgStore compatibility fix', () => {
    expect(isVersionAtLeast(wppconnectPackage.version, '2.2.5')).toBe(true);
  });

  it('uses a WA-JS release containing the MsgStore compatibility fix', () => {
    expect(isVersionAtLeast(waJsPackage.version, '4.4.3')).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test and observe the required RED state**

Run:

```powershell
corepack yarn test:unit src/core/engines/wpp/dependencies.test.ts --runInBand
```

Expected: both tests fail with `Expected: true` and `Received: false`, proving the locked 2.2.3/4.4.1 packages violate the compatibility floors.

- [ ] **Step 4: Apply the minimal dependency correction**

In `package.json`, replace only the two WPP dependency declarations:

```json
"@wppconnect-team/wppconnect": "2.2.6",
"@wppconnect/wa-js": "4.5.0",
```

Regenerate the lock from those exact declarations:

```powershell
corepack yarn install
```

Expected: `package.json` and the root workspace section of `yarn.lock` contain exact `2.2.6` and `4.5.0` selectors, with no Git branch selector remaining for either package.

- [ ] **Step 5: Run the focused test and observe the GREEN state**

Run:

```powershell
corepack yarn test:unit src/core/engines/wpp/dependencies.test.ts --runInBand
```

Expected: both compatibility tests pass.

- [ ] **Step 6: Prove the installed and locked dependency versions**

Run:

```powershell
corepack yarn install --immutable
node -e "console.log(require('@wppconnect-team/wppconnect/package.json').version, require('@wppconnect/wa-js/package.json').version)"
rg -n 'wppconnect-team/wppconnect@(npm:)?2\.2\.6|wppconnect/wa-js@(npm:)?4\.5\.0|github:wppconnect-team/(wppconnect|wa-js)' package.json yarn.lock
git diff --check
```

Expected: immutable install succeeds, the version line is `2.2.6 4.5.0`, exact npm selectors are present, no root Git branch selectors remain, and `git diff --check` is silent.

- [ ] **Step 7: Commit the green regression fix**

Run:

```powershell
git add -- package.json yarn.lock src/core/engines/wpp/dependencies.test.ts
git commit -m "[core] fix: restore WPP WhatsApp Web compatibility"
```

Expected: one commit containing only the two dependency pins, lockfile update, and focused regression test.

### Task 2: Validate the application and EasyPanel Docker artifact

**Files:**

- Verify unchanged: `Dockerfile`
- Verify unchanged: WAHA API, WPP adapter, event, and DTO source files under `src/`

**Interfaces:**

- Consumes: the exact dependency set and passing focused test from Task 1.
- Produces: local evidence for immutable installation, all unit tests, lint, NestJS build, Linux/AMD64 Docker packaging, installed image versions, and WPP default-engine configuration.

- [ ] **Step 1: Run the complete source validation set**

Run each command separately:

```powershell
corepack yarn install --immutable
corepack yarn test:unit --runInBand
corepack yarn lint
corepack yarn build
```

Expected: every command exits with code 0 and produces no test failures, lint warnings, or TypeScript build errors.

- [ ] **Step 2: Confirm the diff remains dependency-only plus its regression documentation**

Run:

```powershell
git status --short
git diff core...HEAD --stat
git diff core...HEAD --name-only
git diff --check
```

Expected: tracked changes are limited to the approved design/plan documents, `package.json`, `yarn.lock`, and `src/core/engines/wpp/dependencies.test.ts`; the worktree is clean and no API, DTO, event, webhook, n8n, or production file changed.

- [ ] **Step 3: Build the same Linux/AMD64 WPP image path EasyPanel will use**

Run:

```powershell
docker build --platform linux/amd64 --build-arg USE_BROWSER=chromium --build-arg WHATSAPP_DEFAULT_ENGINE=WPP --tag waha-wpp-hotfix:local .
```

Expected: Docker completes the repository `Dockerfile` and creates `waha-wpp-hotfix:local` with exit code 0.

- [ ] **Step 4: Inspect the built artifact, not the host installation**

Run:

```powershell
docker run --rm --entrypoint node waha-wpp-hotfix:local -e "console.log(require('/app/node_modules/@wppconnect-team/wppconnect/package.json').version, require('/app/node_modules/@wppconnect/wa-js/package.json').version)"
docker inspect waha-wpp-hotfix:local --format '{{range .Config.Env}}{{println .}}{{end}}' | Select-String '^WHATSAPP_DEFAULT_ENGINE=WPP$'
docker image inspect waha-wpp-hotfix:local --format '{{.Architecture}}/{{.Os}}'
```

Expected: image output reports `2.2.6 4.5.0`, `WHATSAPP_DEFAULT_ENGINE=WPP`, and `amd64/linux`.

- [ ] **Step 5: Record final verification state without claiming live WhatsApp acceptance**

Run:

```powershell
git status --short
git log --oneline --decorate -3
```

Expected: the worktree is clean. Report local tests/build/image as verified, while leaving live `sendText`, message ACK, and webhook delivery for post-deployment EasyPanel acceptance with a paired WhatsApp account.

### Task 3: Publish the branch and open the Core pull request

**Files:**

- No repository files changed in this task.

**Interfaces:**

- Consumes: clean branch `fix/wpp-wa-web-104430` and all Task 2 evidence.
- Produces: a pushed fork branch and an open GitHub pull request targeting `core`, without merge or production deployment.

- [ ] **Step 1: Push the verified branch to the user's fork**

Run:

```powershell
git push --set-upstream origin fix/wpp-wa-web-104430
```

Expected: GitHub accepts the branch and local tracking is set to `origin/fix/wpp-wa-web-104430`.

- [ ] **Step 2: Open the pull request with diagnosis and validation evidence**

Run:

```powershell
$prBody = @'
## Summary
- pin WPPConnect 2.2.6 and WA-JS 4.5.0 for current WhatsApp Web compatibility
- add a regression test for the minimum MsgStore-safe dependency versions
- preserve the WPP API and webhook payload contracts used by n8n

## Root cause
WAHA 2026.7.2 resolved WPPConnect 2.2.3 and WA-JS 4.4.1. WhatsApp Web 2.3000.1044306241 is above the MsgStore module-change threshold, so the old WA-JS loader leaves MsgStore undefined. This breaks sendText/getMessageById and prevents message.any event registration.

## Validation
- focused regression test observed red on 2.2.3/4.4.1 and green on 2.2.6/4.5.0
- immutable install
- complete unit suite
- lint
- NestJS build
- Linux/AMD64 Chromium Docker build with WPP default engine
- image inspection confirmed WPPConnect 2.2.6 and WA-JS 4.5.0

## Deployment boundary
No production service was changed. Live send, ACK, and webhook delivery remain post-deployment acceptance checks in EasyPanel.
'@
gh pr create --repo henocdejesusferreirafarias/waha --base core --head fix/wpp-wa-web-104430 --title "[core] Fix WPP compatibility with current WhatsApp Web" --body $prBody
```

Expected: GitHub returns the new pull request URL.

- [ ] **Step 3: Verify remote delivery and stop before merge**

Run:

```powershell
git status --short --branch
gh pr view --repo henocdejesusferreirafarias/waha --json number,url,state,isDraft,baseRefName,headRefName,statusCheckRollup
```

Expected: the local branch tracks the remote, the PR is open against `core`, and checks are visible. Do not squash-merge until the user gives separate explicit approval.
