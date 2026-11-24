# WEBJS login page compatibility

WhatsApp Web now sends logged-out browsers to `/login/`. This page renders a QR
code but does not expose `WAWebSocketModel`. The old WEBJS authentication wait
therefore times out before WAHA can publish its QR event.

The Yarn patch in `.yarn/patches/` backports the upstream fix from
[whatsapp-web.js PR #201990](https://github.com/wwebjs/whatsapp-web.js/pull/201990),
merge commit `38eb45b2759450cc6fccb6a7a3f2cbc3bdb87db2`. It is applied to the
existing devlikeapro dependency, pinned to source commit
`030a4b800a471dfdee4a82822f87b82a176c5ed8`. This retains the dependency fork's
other changes and WAHA's native PIX implementation. The legacy `hasSynced`
guard is retained so logout teardown cannot trigger authentication.

Docker includes the patch before its first dependency install. Every image build
runs `node --test scripts/tests/webjs-login.test.cjs` against the installed
dependency. These tests cover QR emission, both page layouts, listener replacement,
authentication notification, logout teardown, state, reconnect and logout.

Before production promotion, start an isolated candidate session without the
production sessions volume or webhook configuration. Verify that it reaches
`SCAN_QR_CODE` and returns an image through the authenticated QR endpoint. Do not
print QR contents or pair a real account in that disposable session.

Deploy the image by its GHCR digest. Preserve all volumes and the `barbershop`
session. If the account needs linking, use the application's authenticated QR
screen; then verify `WORKING`, one real incoming and outgoing message, and native
PIX. QR validation alone does not validate authenticated messaging.

The observed production image before this change was
`ghcr.io/henocdejesusferreirafarias/waha@sha256:fdda3547528eb726e70a9e058d5703934994583beae98293cf4fd0707d8a78b1`.
Record the current image again immediately before deploying so rollback uses the
actual previous digest. Never remove the production sessions volume.
