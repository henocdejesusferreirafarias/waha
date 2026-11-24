const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

// Execute the installed dependency's real Client.inject against the two browser
// module layouts. No WhatsApp account, network, QR credentials or browser needed.
const sourcePath = process.env.WEBJS_CLIENT_SOURCE ||
  require.resolve('whatsapp-web.js/src/Client.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function fixture(login) {
  const bus = new EventEmitter();
  bus.socketState = 'UNPAIRED';
  bus.isMainStreamReadyMd = false;
  const socket = new EventEmitter();
  socket.state = 'UNPAIRED';
  socket.hasSynced = false;
  const conn = new EventEmitter();
  conn.ref = 'test-ref';
  const cmd = new EventEmitter();
  const modules = {
    WAWebBackendEventBus: { BackendEventBus: bus },
    WAWebSocketModel: login ? null : { Socket: socket },
    WAWebConnModel: { Conn: conn },
    WAWebCmd: { Cmd: cmd },
    WAWebSignalStoreApi: {
      waSignalStore: { getRegistrationInfo: async () => ({ identityKeyPair: { pubKey: 'identity' } }) },
    },
    WAWebUserPrefsInfoStore: {
      waNoiseInfo: { get: async () => ({ staticKeyPair: { pubKey: 'static' } }) },
    },
    WABase64: { encodeB64: (value) => value },
    WAWebUserPrefsMultiDevice: { getADVSecretKey: async () => 'test-secret' },
    WAWebCompanionRegClientUtils: { DEVICE_PLATFORM: 'test' },
  };
  const window = {
    Debug: { VERSION: 'test' },
    location: { pathname: login ? '/login/' : '/' },
    require: (name) => modules[name],
  };
  const pageContext = vm.createContext({ window: window });
  const page = {
    evaluate: async (fn) => vm.runInContext(`(${fn.toString()})()`, pageContext),
    waitForFunction: async (fn) => {
      const value = vm.runInContext(
        typeof fn === 'string' ? fn : `(${fn.toString()})()`, pageContext,
      );
      if (!value) throw new Error('Timed out waiting for WhatsApp socket state');
      return { jsonValue: async () => value };
    },
  };
  const sandbox = {
    module: { exports: {} }, AbortController: AbortController,
    require: (name) => {
      if (name === 'events') return EventEmitter;
      if (name === './util/Constants') return { Events: {
        QR_RECEIVED: 'qr', LOADING_SCREEN: 'loading_screen',
        AUTHENTICATED: 'authenticated', READY: 'ready',
      } };
      if (name === './util/Puppeteer') return {
        exposeFunctionIfAbsent: async (unusedPage, key, fn) => { window[key] = fn; },
      };
      return {};
    },
  };
  vm.runInNewContext(source, sandbox, { filename: sourcePath });
  const client = new EventEmitter();
  Object.setPrototypeOf(client, sandbox.module.exports.prototype);
  client.options = { pairWithPhoneNumber: {}, authTimeoutMs: 100 };
  client.authStrategy = { onAuthenticationNeeded: async () => ({ failed: false }) };
  client.setDeviceName = async () => {};
  client.getWWebVersion = async () => 'test';
  client.pupPage = page;
  return { client: client, bus: bus, socket: socket, conn: conn, window: window };
}

for (const login of [true, false]) {
  test(`emits QR and registers authentication listeners on ${login ? '/login/' : '/'}`, async () => {
    const f = fixture(login);
    const qr = [];
    f.client.on('qr', (value) => qr.push(value));
    await f.client.inject();
    assert.deepEqual(qr, ['test-ref,static,identity,test-secret,test']);
    const emitter = login ? f.bus : f.socket;
    assert.equal(emitter.listenerCount(login ? 'set_socket_state' : 'change:state'), 1);
    assert.ok(emitter.listenerCount(login ? 'open_socket_stream' : 'change:hasSynced') > 0);
    await f.client.inject();
    assert.equal(emitter.listenerCount(login ? 'set_socket_state' : 'change:state'), 1);
  });
}

test('legacy logout teardown does not trigger authenticated handling', async () => {
  const f = fixture(false);
  await f.client.inject();
  let syncs = 0;
  f.window.onAppStateHasSyncedEvent = () => { syncs++; };
  f.socket.emit('change:hasSynced', f.socket, undefined);
  assert.equal(syncs, 0);
  f.socket.emit('change:hasSynced', f.socket, true);
  assert.equal(syncs, 1);
});

test('new login socket stream notifies authentication and removes QR listener', async () => {
  const f = fixture(true);
  await f.client.inject();
  let syncs = 0;
  f.window.onAppStateHasSyncedEvent = () => { syncs++; };
  f.bus.emit('open_socket_stream');
  assert.equal(syncs, 1);
  assert.equal(f.conn.listenerCount('change:ref'), 0);
});

test('session state is available on the login page', async () => {
  const f = fixture(true);
  assert.equal(await f.client.getState(), 'UNPAIRED');
});

test('reconnect uses the backend event bus on the login page', async () => {
  const f = fixture(true);
  let reconnects = 0;
  f.bus.triggerReconnectSocket = () => { reconnects++; };
  await f.client.resetState();
  assert.equal(reconnects, 1);
});

test('logout uses the backend event bus and clears the auth strategy', async () => {
  const f = fixture(true);
  const actions = [];
  f.bus.triggerLogout = () => { actions.push('logout'); };
  f.client.pupBrowser = {
    close: async () => { actions.push('close'); },
    isConnected: () => false,
  };
  f.client.authStrategy.logout = async () => { actions.push('clear-auth'); };
  await f.client.logout();
  assert.deepEqual(actions, ['logout', 'close', 'clear-auth']);
});
