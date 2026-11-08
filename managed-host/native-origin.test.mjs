import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http';

const registry = JSON.parse(await fs.readFile(new URL('./patches/registry.json', import.meta.url), 'utf8'));
const replacement = registry.find(patch => patch.id === 'blackcrab-packaged-cors').replacements[0];
// Execute the shipped source replacement with the real pinned HTTP middleware.
function corsLayer(devUrl) {
  const exports = {};
  const code = ts.transpileModule(replacement.after, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Effect, Layer, HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse,
    ServerConfig: { ServerConfig: Effect.succeed({ devUrl, devAllowedOrigins: [] }) },
    DESKTOP_RENDERER_ORIGINS: ['t3code://app', 't3code-dev://app', 'blackcrab://app', 'blackcrab-dev://app'],
    browserApiCorsAllowedMethods: ['GET', 'POST', 'OPTIONS'],
    browserApiCorsAllowedHeaders: ['authorization', 'content-type'],
  }, { timeout: 1000 });
  return exports.layerBrowserApiCors;
}
async function withApp(t, devUrl) {
  const routes = HttpRouter.add('GET', '/probe', Effect.succeed(HttpServerResponse.text('ready', {
    headers: { Vary: 'Accept-Encoding' },
  })));
  const app = HttpRouter.toWebHandler(Layer.mergeAll(routes, corsLayer(devUrl)).pipe(
    Layer.provide(HttpServer.layerServices),
  ), { disableLogger: true });
  t.after(() => app.dispose());
  return (origin, preflight = false) => app.handler(new Request('http://127.0.0.1:3773/probe', {
    method: preflight ? 'OPTIONS' : 'GET',
    headers: {
      Origin: origin,
      ...(preflight ? { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } : {}),
    },
  }));
}
test('packaged native requests receive an exact origin while browser CORS remains compatible', async t => {
  const request = await withApp(t);
  for (const preflight of [false, true]) {
    const native = await request('blackcrab://app', preflight);
    assert.ok(native.ok);
    assert.equal(native.headers.get('access-control-allow-origin'), 'blackcrab://app', `preflight=${preflight}`);
    assert.match(native.headers.get('vary'), /(?:^|,\s*)Origin(?:,|$)/i);
    if (!preflight) assert.match(native.headers.get('vary'), /Accept-Encoding/i);
    const browser = await request('https://example.com', preflight);
    assert.ok(browser.ok);
    assert.equal(browser.headers.get('access-control-allow-origin'), '*');
    const lookalike = await request('blackcrab://other', preflight);
    assert.equal(lookalike.headers.get('access-control-allow-origin'), '*');
  }
});
test('development keeps its explicit origin policy', async t => {
  const request = await withApp(t, new URL('http://localhost:5733'));
  assert.equal((await request('blackcrab://app')).headers.get('access-control-allow-origin'), 'blackcrab://app');
  assert.equal((await request('http://localhost:5733')).headers.get('access-control-allow-origin'), 'http://localhost:5733');
  assert.equal((await request('https://example.com')).headers.get('access-control-allow-origin'), null);
});
