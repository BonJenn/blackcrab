const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMobileResolveRequest } = require('./metro-resolution.cjs');
test('app, hoisted and vendored importers share the mobile React/compiler instance', () => {
  const requests = [];
  const resolve = createMobileResolveRequest({ resolve: name => '/mobile/node_modules/' + name });
  for (const originModulePath of ['/mobile/App.tsx', '/root/node_modules/@effect/atom-react/index.js', '/root/vendor/t3-mobile/apps/mobile/src/App.tsx']) {
    const context = { originModulePath, resolveRequest: (received, name, platform) => { assert.equal(received, context); requests.push([name, platform]); return { type: 'sourceFile', filePath: '/native/' + name + '.' + platform + '.js' }; } };
    for (const name of ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react/compiler-runtime', 'react-dom', 'react-dom/client', 'react-dom/server', 'react-native', 'effect', 'effect/Schema', 'effect/ManagedRuntime', '@effect/atom-react']) assert.deepEqual(resolve(context, name, 'ios'), {type:'sourceFile',filePath:'/mobile/node_modules/'+name});
    assert.match(resolve(context, 'react-native/Libraries/Utilities/Platform', 'ios').filePath, /Platform.ios.js$/);
    resolve(context, 'react-native-gesture-handler', 'ios');
  }
  assert.deepEqual(requests, Array.from({length:3},()=>[['react-native/Libraries/Utilities/Platform','ios'],['react-native-gesture-handler','ios']]).flat());
});
test('generated UI and owned shell keep the same React instance and native platform resolver', () => {
 const resolve = createMobileResolveRequest({ resolve: name => '/mobile/node_modules/' + name });
 for (const originModulePath of ['/mobile/.generated/native-ui/OwnedActivation.ts', '/mobile/.generated/native-ui/apps/mobile/src/App.tsx', '/mobile/LegacyApp.tsx']) {
  const context = { originModulePath, resolveRequest: (_, name, platform) => ({type:'sourceFile',filePath:`/native/${name}.${platform}.js`}) };
  assert.equal(resolve(context,'react/compiler-runtime','ios').filePath,'/mobile/node_modules/react/compiler-runtime');
  assert.equal(resolve(context,'react-native/Libraries/Utilities/Platform','ios').filePath,'/native/react-native/Libraries/Utilities/Platform.ios.js');
 }
});
