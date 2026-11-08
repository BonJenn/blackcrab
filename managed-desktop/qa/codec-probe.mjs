import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';import {parseArgs} from 'node:util';
import {assertCanonicalEffect} from '../runtime-integrity.mjs';
const {values}=parseArgs({options:{source:{type:'string'}}});if(!values.source||!path.isAbsolute(values.source))throw Error('Pass --source /absolute/owned-build-source');
const source=values.source,identity=await assertCanonicalEffect(source),load=file=>import(pathToFileURL(path.join(source,file)).href);
const [Schema,settings,keybindings]=await Promise.all([load('apps/desktop/node_modules/effect/dist/Schema.js'),load('packages/contracts/src/settings.ts'),load('packages/contracts/src/keybindings.ts')]);
const shortcut=Schema.decodeUnknownSync(keybindings.PreviewForwardedShortcut)({command:'sidebar.toggle',shortcut:{key:'b',metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,modKey:true}});assert.equal(shortcut.shortcut.key,'b');
const decoded=Schema.decodeUnknownSync(settings.ClientSettingsSchema)({}),encoded=Schema.encodeSync(settings.ClientSettingsSchema)(settings.DEFAULT_CLIENT_SETTINGS);assert.equal(decoded.inAppNotificationsEnabled,false);assert.equal(encoded.inAppNotificationsEnabled,false);assert.equal(Object.keys(decoded).length,Object.keys(settings.DEFAULT_CLIENT_SETTINGS).length);
assert.throws(()=>Schema.decodeUnknownSync(keybindings.PreviewForwardedShortcut)({command:'sidebar.toggle',shortcut:{key:{invalid:true},metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,modKey:true}}));
console.log(JSON.stringify({passed:true,effectVersion:identity.version,physicalEffectCopies:1,settingsKeys:Object.keys(decoded).length,shortcutCodec:true,settingsDefaults:true,settingsEncode:true,invalidShortcutRejected:true}));
