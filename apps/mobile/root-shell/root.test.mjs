import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createManagedOwnershipGuard } from './ownership.mjs';
import { createRootLifecycle } from '../../../mobile-experience/activation/adapters/owned-root-lifecycle.mjs';
test('fresh process claims full owner; neither prior nor later old reader may coexist', () => {
 const old = createManagedOwnershipGuard(); old.legacyReaderConstructed(); assert.throws(() => old.claimFullRoot(), /Restart/);
 const fresh = createManagedOwnershipGuard(); fresh.claimFullRoot(); fresh.claimFullRoot(); assert.throws(() => fresh.legacyReaderConstructed(), /already owns/);
});
test('managed route reveals existing root and visibility follows suppression without duplicate transitions', () => {
 const root = createRootLifecycle(), events = [];
 const stop = root.subscribeVisibility(v => events.push(v));
 const unsub = root.subscribeManagedNavigation(() => root.setManagedVisible(true));
 root.setManagedVisible(false); root.setManagedVisible(false); root.managedNavigation();
 assert.deepEqual(events,[true,false,true]); assert.equal(root.isManagedVisible(),true);
 stop(); unsub(); root.setManagedVisible(false); root.managedNavigation(); assert.equal(root.isManagedVisible(),false);
});
test('active root uses one sticky activation and retains full App while native legacy modal is visible', async () => {
 const app = await fs.readFile(new URL('../App.tsx',import.meta.url),'utf8');
 const legacy = await fs.readFile(new URL('../LegacyApp.tsx',import.meta.url),'utf8');
 assert.match(app,/activateFullNativeUI\(\(\) => managedOwnership.claimFullRoot\(\)\)/);
 assert.match(app,/startup\.catch/);
 assert.match(app,/FullApp \? <FullApp \/>/);
 assert.match(app,/<Modal visible=\{!managedVisible\} presentationStyle="fullScreen"/);
 assert.match(app,/!managedVisible && <LegacyApp \/>/);
 for(const token of ['createNativeManagedEnvironmentsClient','ManagedEnvironmentsScreen','managedClient','key: "managed"']) assert(!legacy.includes(token),token);
 assert(legacy.includes('MobileQueueClient')); assert(legacy.includes('loadStoredHosts')); assert(!app.includes('src/managed/native'));
});
test('own configuration keeps self-hosted native capabilities and own extension identity without upstream account activation', async () => {
 const {expo:c}=JSON.parse(await fs.readFile(new URL('../app.json',import.meta.url)));
 assert.deepEqual(c.scheme,['blackcrab-remote','blackcrab']); assert.equal(c.ios.bundleIdentifier,'dev.blackcrab.remote');
 assert.equal(c.orientation,'default'); assert.equal(c.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads,true);
 assert(c.ios.infoPlist.UIBackgroundModes.includes('audio')); assert(c.ios.infoPlist.NSPhotoLibraryAddUsageDescription);
 assert(c.ios.infoPlist['UISupportedInterfaceOrientations~ipad'].includes('UIInterfaceOrientationLandscapeLeft'));
 assert(!c.ios.appleTeamId); assert(!c.ios.associatedDomains); assert(!c.owner); assert(!c.extra.eas); assert.equal(c.updates.enabled,false); assert(!c.updates.url);
 const plugins=new Map(c.plugins.map(p=>Array.isArray(p)?p:[p,{}]));
 assert.equal(plugins.get('expo-sharing').ios.appGroupId,'group.dev.blackcrab.remote');
 assert.equal(plugins.get('expo-widgets').bundleIdentifier,'dev.blackcrab.remote.widgets');
 assert.equal(plugins.get('expo-widgets').enablePushNotifications,false);
 assert(plugins.get('expo-widgets').widgets[0].android.initialLayout.startsWith('./.generated/native-ui/'));
 assert(!plugins.has('@clerk/expo'));
});
test('active dictation prevents legacy hiding; a raced recording start reveals managed root', () => {
 const root=createRootLifecycle(); root.subscribeManagedNavigation(()=>root.setManagedVisible(true));
 root.setVoicePhase('recording'); assert.equal(root.requestLegacy(),false); assert.equal(root.isManagedVisible(),true);
 root.setVoicePhase('idle'); assert.equal(root.requestLegacy(),true); assert.equal(root.isManagedVisible(),false);
 root.setVoicePhase('preparing'); assert.equal(root.isManagedVisible(),true);
 root.setVoicePhase('error'); assert.equal(root.requestLegacy(),true);
});
test('host shell, legacy root, and every generated integration adapter have valid TSX syntax', async () => {
 const {createRequire}=await import('node:module');const ts=createRequire(import.meta.url)('typescript');
 for(const name of ['App.tsx','LegacyApp.tsx','index.ts']) {
  const text=await fs.readFile(new URL('../'+name,import.meta.url),'utf8');const source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.deepEqual(source.parseDiagnostics.map(d=>d.messageText),[],name);
 }
});
