import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  buildViteMiddlewareOptions,
  createDisableHmrClientPlugin,
  isViteClientModuleId,
  stripViteClientAutoConnect,
} from './vite-dev-config.ts';

test('isViteClientModuleId identifies Vite browser client entrypoint across platforms', () => {
  assert.equal(
    isViteClientModuleId('/app/node_modules/vite/dist/client/client.mjs'),
    true
  );
  assert.equal(
    isViteClientModuleId('C:\\repo\\node_modules\\vite\\dist\\client\\client.mjs?v=123'),
    true
  );
  assert.equal(isViteClientModuleId('/@vite/client'), true);
  assert.equal(isViteClientModuleId('/app/src/App.tsx'), false);
});

test('stripViteClientAutoConnect removes top-level WebSocket auto-connect while preserving internal methods and exports', () => {
  const sampleClient = [
    'return transport.connect({ onMessage() {} });',
    'await wsTransport.connect(handlers);',
    'const hmrClient = new HMRClient({}, transport, importer);',
    'transport.connect(createHMRHandler(handleMessage));',
    'export { ErrorOverlay, createHotContext, injectQuery, removeStyle, updateStyle };',
  ].join('\n');

  const transformed = stripViteClientAutoConnect(sampleClient);
  assert.equal(transformed.includes('return transport.connect({'), true);
  assert.equal(transformed.includes('await wsTransport.connect(handlers);'), true);
  assert.equal(
    transformed.includes('transport.connect(createHMRHandler(handleMessage))'),
    false
  );
  assert.equal(
    transformed.includes(
      'export { ErrorOverlay, createHotContext, injectQuery, removeStyle, updateStyle };'
    ),
    true
  );
});

test('buildViteMiddlewareOptions disables ws, hmr, and watch when DISABLE_HMR=true', () => {
  const config = buildViteMiddlewareOptions({ disableHmr: true });
  assert.equal(config.appType, 'spa');
  assert.equal(config.server?.middlewareMode, true);
  assert.equal(config.server?.hmr, false);
  assert.equal(config.server?.ws, false);
  assert.equal(config.server?.watch, null);
  assert.equal(config.plugins?.length, 1);

  const plugin = createDisableHmrClientPlugin();
  const transform = plugin.transform as (code: string, id: string) => unknown;
  assert.equal(transform('console.log(1)', '/app/src/main.tsx'), null);
});

test('buildViteMiddlewareOptions shares the Express HTTP server when HMR is enabled', () => {
  const fakeServer = http.createServer();
  const config = buildViteMiddlewareOptions({
    disableHmr: false,
    httpServer: fakeServer,
  });
  assert.equal(config.appType, 'spa');
  assert.equal(config.server?.middlewareMode, true);
  assert.deepEqual(config.server?.ws, { server: fakeServer });
  fakeServer.close();
});
