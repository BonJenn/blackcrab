from pathlib import Path
import json,hashlib,argparse
root=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--source-mobile',type=Path,default=root.parents[1]/'vendor/t3-mobile/apps/mobile')
src=parser.parse_args().source_mobile.resolve();records=[]
def sha(b):return hashlib.sha256(b).hexdigest()
def add(p,replacements=None,template=None):
 before=(src/p).read_bytes();s=before.decode();r={'path':p,'beforeSha256':sha(before),'kind':'template' if template else 'replace'}
 if template:
  b=(root/template).read_bytes();r.update(template=template,templateSha256=sha(b));s=b.decode()
 else:
  r['replacements']=[]
  for a,b,count in replacements:
   assert s.count(a)==count,(p,a,s.count(a),count);s=s.replace(a,b);r['replacements'].append({'before':a,'after':b,'count':count})
 r['afterSha256']=sha(s.encode());records.append(r)
add('app.config.ts',template='adapters/inert-config-guard.ts')
add('src/connection/catalog-store.ts',template='adapters/catalog-store.ts')
add('src/connection/storage.test.ts',template='adapters/storage.test.ts')
add('src/features/cloud/CloudAuthProvider.tsx',template='adapters/CloudAuthProvider.tsx')
add('src/components/T3Wordmark.tsx',template='adapters/T3Wordmark.tsx')
add('src/components/BrandMark.tsx',template='adapters/BrandMark.tsx')
add('src/features/layout/workspace/WorkspaceNativeTabs.ios.tsx',[
 ('import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";', 'import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";\nimport { navigationSelectionFeedback } from "./navigationHaptics";',1),
 ('          if (tab) selectTab(tab);', '          if (tab) { navigationSelectionFeedback(); selectTab(tab); }',1),
])
add('src/features/layout/workspace/WorkspaceSidebarTabs.ios.tsx',[
 ('import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";', 'import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";\nimport { navigationSelectionFeedback, navigationComposeFeedback } from "./navigationHaptics";',1),
 ('      onCompose={() => props.onNewTask?.()}', '      onCompose={() => { if (props.onNewTask) { navigationComposeFeedback(); props.onNewTask(); } }}',1),
 ('        if (tab === "settings") selectTab("settings");\n        else if (tab) selectTab(tab);', '        if (tab) { navigationSelectionFeedback(); selectTab(tab); }',1),
])
add('src/features/layout/workspace/AndroidWorkspaceNavigation.android.tsx',[
 ('import { selectedNavigationTab, visibleNavigationTabs } from "./navigation-tab-order";', 'import { selectedNavigationTab, visibleNavigationTabs } from "./navigation-tab-order";\nimport { navigationSelectionFeedback, navigationComposeFeedback } from "./navigationHaptics";',1),
 ('        onTabSelected={(event) => {\n          Keyboard.dismiss();', '        onTabSelected={(event) => {\n          navigationSelectionFeedback();\n          Keyboard.dismiss();',1),
 ('        onNewThread={() => {\n          Keyboard.dismiss();', '        onNewThread={() => {\n          navigationComposeFeedback();\n          Keyboard.dismiss();',1),
])
s=(src/'src/features/cloud/publicConfig.ts').read_text();a=s.index('type UntrustedSection<T>');b=s.index('\nexport function hasCloudPublicConfig',a)
cloud='export function resolveCloudPublicConfig(extra: unknown = Constants.expoConfig?.extra) {\n  const cloud = resolveOwnedCloudConfig(extra);\n  return {\n    clerk: { publishableKey: cloud?.publishableKey ?? null, jwtTemplate: cloud?.jwtTemplate ?? null },\n    relay: { url: cloud?.relayUrl ?? null },\n    observability: { tracesUrl: null, tracesDataset: null, tracesToken: null },\n  } satisfies CloudPublicConfig;\n}\n'
add('src/features/cloud/publicConfig.ts',[
 ('import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";', 'import { resolveOwnedCloudConfig } from "../../../../../owned-cloud-config.cjs";', 1),
 (s[a:b],cloud,1),
 ('T3CODE_CLERK_JWT_TEMPLATE','BLACKCRAB_CLERK_JWT_TEMPLATE',2),
])
add('src/App.tsx',[
 ('import { installPermissionUpdateNotice } from "./features/connection/permissionUpdateNotice";', 'import { managedRootLifecycle } from "../../../owned-root-lifecycle.mjs";\nimport { installPermissionUpdateNotice } from "./features/connection/permissionUpdateNotice";',1),
 ('function getAppStateFromPath(path: string, options: Parameters<typeof getStateFromPath>[1]) {', 'function getAppStateFromPath(path: string, options: Parameters<typeof getStateFromPath>[1]) {\n  managedRootLifecycle.managedNavigation();',1),
 ('function linkToAppPath(href: string): void {', 'function linkToAppPath(href: string): void {\n  managedRootLifecycle.managedNavigation();',1),
 ('function handleNavigationStateChange(state: NavigationState | undefined): void {', 'function handleNavigationStateChange(state: NavigationState | undefined): void {\n  managedRootLifecycle.managedNavigation();',1),
 ('setAgentNotificationPathname(workspaceLocationFromState(state).pathname);', 'setAgentNotificationPathname(managedRootLifecycle.isManagedVisible() ? workspaceLocationFromState(state).pathname : "");',1),
 ('const appServiceDisposers = [', 'const appServiceDisposers = [\n  managedRootLifecycle.subscribeVisibility((visible) => {\n    const state = visible && rootNavigationRef.isReady() ? rootNavigationRef.getRootState() : undefined;\n    setAgentNotificationPathname(state ? workspaceLocationFromState(state).pathname : "");\n  }),',1),
 ('import "../global.css";\n','',1),
 ('const appLinking = {', 'const ownedAppLinkPrefixes = [Linking.createURL("/"), "blackcrab-remote://", "blackcrab://", ...(DEFAULT_HOSTED_APP_URL ? [DEFAULT_HOSTED_APP_URL] : [])];\n\nconst appLinking = {',1),
 ('  prefixes: [\n    Linking.createURL("/"),\n    "t3code://",\n    "t3code-dev://",\n    "t3code-preview://",\n    DEFAULT_HOSTED_APP_URL,\n  ],','  prefixes: ownedAppLinkPrefixes,',1),
 ('filter: (url: string) => shouldHandleAppLink(url, hasCloudPublicConfig()),', 'filter: (url: string) => shouldHandleAppLink(url, hasCloudPublicConfig(), ownedAppLinkPrefixes),',1),
 ('import { installShowcaseCapture } from "./features/showcase/ShowcaseCaptureCoordinator";\n','',1),
 ('  installShowcaseCapture(rootPathnameFromState),','  () => undefined, // Upstream showcase capture is not activated.',1),
 ('if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {','if (false) { // Never activate upstream showcase from inherited build flags.',1),
 # Keep the Live Activity current from the app's own connection while it runs.
 ('import { installAppUpdateChecks } from "./features/updates/app-updates";','import { installLiveActivityProgress } from "./features/agent-awareness/liveActivityProgress";\nimport { installAppUpdateChecks } from "./features/updates/app-updates";',1),
 ('  installAppUpdateChecks(),\n','  installAppUpdateChecks(),\n  installLiveActivityProgress(),\n',1),
])
add('src/features/voice-input/GlobalVoiceInputControl.tsx',[
 ('import { useState, type ReactNode } from "react";', 'import { useState, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";\nimport { managedRootLifecycle } from "../../../../../owned-root-lifecycle.mjs";',1),
 ('export function GlobalVoiceInputControl(props: { readonly children: ReactNode }) {', 'export function GlobalVoiceInputControl(props: { readonly children: ReactNode }) {\n  const managedVisible = useSyncExternalStore(managedRootLifecycle.subscribeVisibility, managedRootLifecycle.isManagedVisible);',1),
 ('  const [expanded, setExpanded] = useState(false);', '  useLayoutEffect(() => {\n    managedRootLifecycle.setVoicePhase(voice.state.phase);\n    return () => managedRootLifecycle.setVoicePhase("idle");\n  }, [voice.state.phase]);\n  const [expanded, setExpanded] = useState(false);',1),
 ('    presentation.statusLabel !== null &&', '    managedVisible && presentation.statusLabel !== null &&',1),
])
add('src/features/sharing/IncomingShareProvider.tsx',[
 ('import * as Dialog from "../../components/ui/Dialog";', 'import { managedRootLifecycle } from "../../../../../owned-root-lifecycle.mjs";\nimport * as Dialog from "../../components/ui/Dialog";',1),
 ('  if (!transition.shareIdToPresent) return;', '  if (!transition.shareIdToPresent) return;\n  managedRootLifecycle.managedNavigation();',1),
])
add('src/lib/appLinking.ts',[
 (r'^t3code(-dev|-preview)?:',r'^blackcrab(?:-remote)?:',1),
 ('export function shouldHandleAppLink(url: string, cloudConfigured: boolean): boolean {', '''function hasOwnedAppPrefix(value: string, prefixes: readonly string[]): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password) return false;
  return prefixes.some((prefix) => {
    let base: URL;
    try { base = new URL(prefix); } catch { return false; }
    if (base.username || base.password || base.search || base.hash || base.protocol !== url.protocol) return false;
    if (["blackcrab-remote:", "blackcrab:"].includes(url.protocol) && prefix === url.protocol + "//") return value.startsWith(prefix);
    if (!["exp:", "exps:", "http:", "https:"].includes(url.protocol) || url.host !== base.host) return false;
    const path = base.pathname.replace(/\\/+$/, "");
    return url.pathname === path || url.pathname.startsWith(path + "/");
  });
}

export function shouldHandleAppLink(url: string, cloudConfigured: boolean, ownedPrefixes: readonly string[] = ["blackcrab-remote://", "blackcrab://"]): boolean {''',1),
 ('  return (\n    !route.includes("expo-development-client")', '  return (\n    hasOwnedAppPrefix(url, ownedPrefixes) &&\n    !route.includes("expo-development-client")',1),
])
# Preserve the action label while exposing the visible connection status to VoiceOver.
add('src/features/connection/ConnectionEnvironmentRow.tsx',[
 ('          className="min-w-0 flex-1 gap-0.5 active:opacity-70"', '          className="min-w-0 flex-1 gap-0.5 active:opacity-70"\n          accessibilityValue={{ text: diagnosis?.headline ?? statusLabel ?? "" }}',1),
 ('Managed by T3 Connect.', 'Managed by Blackcrab Connect.', 1),
])
add('src/features/connection/pairing.ts',[( 'url.protocol === "t3code:"', '(url.protocol === "blackcrab-remote:" || url.protocol === "blackcrab:")',1)])
add('src/features/prompt-links/prompt-link-actions.ts',[
 ('import { buildNewThreadLink, type LinkedPrompt } from "@t3tools/shared/promptLinks";', 'import { buildNewThreadLink, promptLinkDeepLink, type LinkedPrompt } from "@t3tools/shared/promptLinks";\nimport { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";',1),
 ('buildNewThreadLink({ prompt }), { target: "prompt link" }', '(DEFAULT_HOSTED_APP_URL ? buildNewThreadLink({ prompt }) : promptLinkDeepLink("/new?" + new URLSearchParams({ prompt }).toString())), { target: "prompt link" }',1),
])
add('src/lib/authClientMetadata.ts',[( 'label: "T3 Code Mobile"','label: "Blackcrab Mobile"',1)])
# The list title is the product name alone: no upstream "Code" suffix and no stage badge.
# App Review rejects apps that present themselves as beta software.
add('src/components/CompactBrandTitle.tsx',[
 ('"T3 Code, Threads"','"Blackcrab, Threads"',1),
 ('      <T3Wordmark colorClassName="accent-icon" height={Math.round(15 * scale)} />\n','',1),
 ('        className="font-t3-medium text-foreground-muted"\n        style={{ fontSize: 21 * scale, letterSpacing: -0.5 * scale }}\n      >\n        Code\n','        className="font-t3-medium text-foreground"\n        style={{ fontSize: 21 * scale, letterSpacing: -0.5 * scale }}\n      >\n        Blackcrab\n',1),
 ('  const showStage =\n    !props.fit || availableWidth === null || fullWidth === null || fullWidth <= availableWidth;','  const showStage = false as boolean; // No stage badge in a store build.\n  void fullWidth;',1),
])
# The Live Activity layout is Blackcrab's own; see adapters/AgentActivity.tsx.
add('src/widgets/AgentActivity.tsx',template='adapters/AgentActivity.tsx')
for widget in ['src/widgets/SubscriptionUsage.android.tsx']:
 text=(src/widget).read_text(); replacements=[]
 for a,b in [('Open T3','Open Blackcrab'),('in T3','in Blackcrab')]:
  if a in text: replacements.append((a,b,text.count(a)))
 if replacements: add(widget,replacements)
add('src/features/agent-awareness/androidNotifications.ts',[( '?? "t3code"','?? "blackcrab-remote"',1)])
add('src/persistence/mobile-secure-storage.ts',[( 'const make = MobileSecureStorage.of({','const ownedKey=(key:string)=>key === "blackcrab.mobile.managedCatalog.v1" ? key : "blackcrab.mobile.native.v1." + key;\n\nconst make = MobileSecureStorage.of({',1),('SecureStore.getItemAsync(key)','SecureStore.getItemAsync(ownedKey(key))',1),('SecureStore.setItemAsync(key, value)','SecureStore.setItemAsync(ownedKey(key), value, {keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY})',1),('SecureStore.deleteItemAsync(key)','SecureStore.deleteItemAsync(ownedKey(key))',1)])
add('src/persistence/mobile-database.ts',[( '"t3code-client.db"','"blackcrab-native-client.db"',1)])
# Product copy only: retain protocol identifiers, native module names and original
# source/license provenance. These explicit files contain visible or spoken labels.
brand_files = [
 'src/Stack.tsx',
 'src/connection/platform.ts',
 'src/lib/mobileTheme.ts',
 'src/state/use-thread-composer-state.ts',
 'src/state/use-remote-environment-registry.ts',
 'src/features/voice-input/voiceDestination.ts',
 'src/features/connection/PullRequestRoutingSettings.tsx',
 'src/features/connection/ConnectionsNewRouteScreen.tsx',
 'src/features/connection/CloudEnvironmentRows.tsx',
 'src/features/cloud/T3ConnectProfilePage.tsx',
 'src/features/cloud/ConnectOnboardingRouteScreen.tsx',
 'src/features/settings/SettingsRouteScreen.tsx',
 'src/features/settings/SettingsAuthRouteScreen.tsx',
 'src/features/settings/VoiceModelSection.tsx',
 'src/features/settings/SettingsVoiceRouteScreen.tsx',
 'src/features/settings/SettingsNotificationsRouteScreen.tsx',
 'src/features/settings/SettingsScheduledTasksRouteScreen.tsx',
 'src/features/settings/OutdatedServerUpdateSection.tsx',
 'src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx',
 'src/features/diagnostics/SettingsDiagnosticsRouteScreen.tsx',
 'src/features/diagnostics/crash-log-model.ts',
 'src/features/layout/workspace/PullRequestToolbar.android.tsx',
 'src/features/layout/workspace/WorkspaceRootScreen.tsx',
 'src/features/layout/workspace/WorkspaceListHeader.android.tsx',
 'src/features/home/HomeRouteScreen.tsx',
 'src/features/agent-awareness/remoteRegistration.ts',
 'src/features/showcase/showcaseAgentActivity.ts',
 'src/features/threads/ThreadQueueControl.tsx',
 'src/features/threads/ThreadFeed.tsx',
 'src/features/threads/ThreadComposer.tsx',
 'src/features/threads/ThreadNavigationSidebar.tsx',
 'src/features/threads/LinkRequestCard.tsx',
 'src/features/pull-requests/pullRequestAgentTasks.ts',
 'src/widgets/subscriptionUsageSnapshot.ts',
]
account_recovery = {
 'src/features/connection/ConnectionsNewRouteScreen.tsx': [
  ('Scan the code from t3 pair or desktop Connections settings', "Scan the code in the desktop app's Connections settings", 1),
  ('          disabled={!isLoaded}\n', '', 1),
  ('const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });', 'const { isSignedIn } = useAuth({ treatPendingAsSignedOut: false });', 1),
 ],
 # In-app account deletion: on the Blackcrab Connect page of the account screen.
 # Pane mode: a screen that shows several threads side by side.
 'src/Stack.tsx': [
  ('import { ThreadTerminalRouteScreen } from "./features/terminal/ThreadTerminalRouteScreen";','import { ThreadTerminalRouteScreen } from "./features/terminal/ThreadTerminalRouteScreen";\nimport { ThreadPanesScreen } from "./features/panes/ThreadPanesScreen";',1),
  ('    ThreadInspectorFullscreen: createNativeStackScreen({','    ThreadPanes: createNativeStackScreen({\n      screen: ThreadPanesScreen,\n      options: pageRoute({ title: "Panes", header: "solid" }),\n    }),\n    ThreadInspectorFullscreen: createNativeStackScreen({',1),
 ],
 'src/features/cloud/T3ConnectProfilePage.tsx': [
  ('import {\n  deregisterManagedRelayEnvironmentCommand,', 'import { DeleteAccountSection } from "./AccountDeletion";\nimport {\n  deregisterManagedRelayEnvironmentCommand,', 1),
  ('        Connections on this device are managed in Settings.\n      </Text>\n', '        Connections on this device are managed in Settings.\n      </Text>\n      <DeleteAccountSection />\n', 1),
 ],
 # A sample card, so the Live Activity can be seen without running an agent.
 'src/features/settings/SettingsNotificationsRouteScreen.tsx': [
  ('import { setLiveActivityUpdatesEnabled } from "../agent-awareness/liveActivityPreferences";', 'import { setLiveActivityUpdatesEnabled } from "../agent-awareness/liveActivityPreferences";\nimport { showSampleLiveActivity } from "../agent-awareness/liveActivityProgress";', 1),
  ('          {liveActivityStatus === "signed-out" && canClearLiveActivitiesPreference ? (', '''          {Platform.OS === "ios" ? (
            <SettingsRow
              icon="bolt.circle"
              label="Show a sample Live Activity"
              onPress={() => {
                if (showSampleLiveActivity()) {
                  Dialog.alert(
                    "Sample started",
                    "Lock your phone or go to the Home Screen to see it. It ends by itself after about a minute.",
                  );
                } else {
                  Dialog.alert(
                    "Live Activities are off",
                    "Turn on Live Activities for Blackcrab in the iOS Settings app, then try again.",
                  );
                }
              }}
            />
          ) : null}
          {liveActivityStatus === "signed-out" && canClearLiveActivitiesPreference ? (''', 1),
 ],
 'src/features/settings/SettingsRouteScreen.tsx': [
  ('import { Platform, View } from "react-native";', 'import { Alert, Keyboard, Platform, View } from "react-native";\nimport { managedRootLifecycle } from "../../../../../owned-root-lifecycle.mjs";', 1),
  ('{ title: "Connections", rows: props.connections }', '{ title: "Connections", rows: [...props.connections, { id: "previousHosts", icon: "server.rack" as const, label: "Previously paired hosts", onPress: () => {\n      if (managedRootLifecycle.requestLegacy()) Keyboard.dismiss();\n      else Alert.alert("Voice input is active", "Finish or cancel voice input before opening previously paired hosts.");\n    } }] }', 1),
  ('import { useAuth, useUser } from "@clerk/expo";', 'import { useAuth, useUser } from "@clerk/expo";\nimport { useAccountConnectionStatus } from "../cloud/AccountConnectionStatus";\nimport { useAccountDeletion } from "../cloud/AccountDeletion";', 1),
  # In-app account deletion: directly in Settings, shown while signed in.
  ('  const { savedConnectionsById } = useSavedRemoteConnections();\n  const accountLabel', '  const { savedConnectionsById } = useSavedRemoteConnections();\n  const accountDeletion = useAccountDeletion();\n  const accountLabel', 1),
  ('          label: "Notifications",\n          target: "SettingsNotifications",\n        },\n', '          label: "Notifications",\n          target: "SettingsNotifications",\n        },\n        ...(accountDeletion.available\n          ? [{ id: "deleteAccount", icon: "trash" as const, label: "Delete account", disabled: accountDeletion.deleting, onPress: accountDeletion.requestDeletion }]\n          : []),\n', 1),
  ('  const accountLabel = !isLoaded\n    ? "Checking"', '  const accountConnectionStatus = useAccountConnectionStatus(isLoaded);\n  const accountLabel = !isLoaded\n    ? (accountConnectionStatus === "unavailable" ? "Unavailable" : "Connecting…")', 1),
  ('          disabled: !isLoaded,\n', '', 1),
 ],
 'src/features/settings/SettingsAuthRouteScreen.tsx': [
  ('import { hasCloudPublicConfig } from "../cloud/publicConfig";', 'import { hasCloudPublicConfig } from "../cloud/publicConfig";\nimport { AccountConnectionPending, useAccountConnectionStatus } from "../cloud/AccountConnectionStatus";', 1),
  ('  const navigation = useNavigation();', '  const accountConnectionStatus = useAccountConnectionStatus(isLoaded);\n  const navigation = useNavigation();', 1),
  ('      ) : null}', '      ) : <AccountConnectionPending status={accountConnectionStatus === "unavailable" ? "unavailable" : "loading"} onBack={handleHostBack} />}', 1),
 ],
}
for p in brand_files:
 text=(src/p).read_text(); replacements=account_recovery.get(p, []).copy()
 for before,after,count in replacements:
  assert text.count(before)==count,(p,before,text.count(before),count)
  text=text.replace(before,after)
 for before,after in [
  ('T3 Connect','Blackcrab Connect'),
  ('T3 Account','Blackcrab Account'),
  ('T3 account','Blackcrab account'),
  ('T3 Code','Blackcrab'),
  ('Open T3','Open Blackcrab'),
  ("T3's", "Blackcrab's"),
 ]:
  if before in text:
   replacements.append((before,after,text.count(before)))
   text=text.replace(before,after)
 assert replacements, ('Expected product copy',p)
 add(p,replacements)
# The site answers on www; the apex redirects there, and the legal screen opens a redirect
# target outside its allowed pages in the browser instead of in the app.
# React Native's own list calls renderScrollComponent as a plain function from a class render.
# The compiled NativeScrollView uses a hook, so passing the component itself fails with
# "Invalid hook call" and the pane shows an error. Rendering it as an element fixes that.
# Lists from @legendapp/list render the component themselves and are unaffected.
for native_list_file in ['src/features/review/ReviewSheet.tsx','src/features/pull-requests/PullRequestReviewersScreen.tsx']:
 add(native_list_file,[('renderScrollComponent={NativeScrollView}','renderScrollComponent={(scrollProps) => <NativeScrollView {...scrollProps} />}',1)])
add('src/features/settings/lib/legal-document-url.ts',[
 ('https://t3.codes','https://www.blackcrab.app',1),
])
# IDE mode: a code-first inspector pane that follows the files the agent changes. New files only
# add the pane; the three adapters below add its mode, its entry button and its route wiring.
add('src/features/threads/thread-inspector-navigation.ts',[
 ('export type ThreadInspectorMode = "route" | "git" | "files" | "preview";','export type ThreadInspectorMode = "route" | "git" | "files" | "ide" | "preview";',1),
])
add('src/features/threads/ThreadHeader.tsx',[
 ('  readonly onOpenFilesInspector: () => void;\n','  readonly onOpenFilesInspector: () => void;\n  readonly onOpenIdeInspector?: () => void;\n  readonly onOpenPanes?: () => void;\n',1),
 ('  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;\n','  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;\n  const ideVisible = props.inspectorMode === "ide" && panes.auxiliaryPaneVisible;\n',1),
 ('          onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,\n        },\n      ]\n    : [];','          onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,\n        },\n        ...(props.fileInspectorSupported && props.onOpenIdeInspector\n          ? [\n              {\n                accessibilityLabel: ideVisible ? "Close IDE mode" : "Open IDE mode",\n                icon: "chevron.left.forwardslash.chevron.right" as const,\n                selected: ideVisible,\n                disabled: !props.gitControls.canOpenFiles,\n                separateBackground: false,\n                onPress: ideVisible ? toggleAuxiliaryPane : props.onOpenIdeInspector,\n              },\n            ]\n          : []),\n      ]\n    : [];',1),
 ('          : []),\n      ]\n    : [];','          : []),\n        ...(props.fileInspectorSupported && props.onOpenPanes\n          ? [\n              {\n                accessibilityLabel: "Open pane mode",\n                icon: { ios: "rectangle.split.2x1", android: "desktop_windows" } as const,\n                separateBackground: false,\n                onPress: props.onOpenPanes,\n              },\n            ]\n          : []),\n      ]\n    : [];',1),
])
add('src/features/threads/ThreadRouteScreen.tsx',[
 ('import { ThreadFileNavigatorPane } from "../files/thread-file-navigator-pane";','import { ThreadFileNavigatorPane } from "../files/thread-file-navigator-pane";\nimport { ThreadIdePane } from "../ide/ThreadIdePane";',1),
 ('    return mode === "files" && selectedThreadCwd === null ? null : mode;','    return (mode === "files" || mode === "ide") && selectedThreadCwd === null ? null : mode;',1),
 ('  const handleToggleInspector = () => {','  const handleOpenIdeInspector = () => {\n    if (selectedThread === null || selectedThreadCwd === null) {\n      return;\n    }\n    navigation.setParams({ inspector: undefined });\n    setChosenInspectorMode("ide");\n    showInspector();\n  };\n  const handleToggleInspector = () => {',1),
 ('  const renderPreviewInspector = () =>','  const renderIdeInspector = () =>\n    selectedThread !== null && selectedThreadCwd !== null ? (\n      <ThreadIdePane\n        cwd={selectedThreadCwd}\n        environmentId={selectedThread.environmentId}\n        projectName={selectedThreadProject?.title ?? "Code"}\n        onOpenFiles={handleOpenFilesInspector}\n      />\n    ) : null;\n  const renderPreviewInspector = () =>',1),
 ('            { key: "files", render: renderFilesInspector, prewarm: true },','            { key: "files", render: renderFilesInspector, prewarm: true },\n            { key: "ide", render: renderIdeInspector },',1),
 ('                onOpenFilesInspector={handleOpenFilesInspector}','                onOpenFilesInspector={handleOpenFilesInspector}\n                onOpenIdeInspector={handleOpenIdeInspector}',1),
 ('import { ThreadIdePane } from "../ide/ThreadIdePane";','import { ThreadIdePane } from "../ide/ThreadIdePane";\nimport { paneStore } from "../panes/paneStore";',1),
 ('  const handleToggleInspector = () => {','  const handleOpenPanes = () => {\n    if (selectedThread === null) {\n      return;\n    }\n    paneStore.open({\n      environmentId: String(selectedThread.environmentId),\n      threadId: String(selectedThread.id),\n    });\n    navigation.navigate("ThreadPanes");\n  };\n  const handleToggleInspector = () => {',1),
 ('                onOpenIdeInspector={handleOpenIdeInspector}','                onOpenIdeInspector={handleOpenIdeInspector}\n                onOpenPanes={handleOpenPanes}',1),
])
add('src/features/threads/thread-inspector-preview.tsx',[
 ('import { ThreadPreviewRoute } from "./thread-preview-route";','import { ThreadPreviewRoute } from "./thread-preview-route";\nimport { PaneCellHeader } from "../panes/PaneCellHeader";',1),
 ('export type ThreadInspectorPresentation =\n  | { readonly onMaximize: () => void }','export type ThreadInspectorPresentation =\n  | {\n      readonly pane: { readonly subtitle: string | null };\n      readonly onMaximize: () => void;\n      readonly onClose: () => void;\n    }\n  | { readonly onMaximize: () => void }',1),
 ('  if ("onMaximize" in props) {\n    return (\n      <AppBar','  if ("pane" in props) {\n    return (\n      <PaneCellHeader\n        title={props.title}\n        subtitle={props.pane.subtitle}\n        onMaximize={props.onMaximize}\n        onClose={props.onClose}\n      />\n    );\n  }\n  if ("onMaximize" in props) {\n    return (\n      <AppBar',1),
])
# The home screen widget shows agent jobs next to provider limits. The layout and the
# coordinator are Blackcrab's own; the iOS publisher adds the moment the jobs picture goes stale.
add('src/widgets/SubscriptionUsage.tsx',template='adapters/SubscriptionUsage.tsx')
add('src/widgets/SubscriptionUsageCoordinator.tsx',template='adapters/SubscriptionUsageCoordinator.tsx')
add('src/widgets/publishSubscriptionUsage.ios.ts',[
 ('import {\n  subscriptionUsageTimeline,\n  type SubscriptionUsageSnapshot,\n} from "./subscriptionUsageSnapshot";','import {\n  subscriptionUsageTimeline,\n  type SubscriptionUsageSnapshot,\n} from "./subscriptionUsageSnapshot";\nimport { withJobsDeadline, type WidgetJobs } from "./widgetJobs";',1),
 ('export async function publishSubscriptionUsage(snapshot: SubscriptionUsageSnapshot) {','export async function publishSubscriptionUsage(snapshot: SubscriptionUsageSnapshot & { jobs?: WidgetJobs }) {',1),
 ('  widget.updateTimeline(subscriptionUsageTimeline(snapshot, Date.now()));','  const now = Date.now();\n  widget.updateTimeline(withJobsDeadline(subscriptionUsageTimeline(snapshot, now), snapshot.jobs, now));',1),
])
entry='''/** Root must invoke once at process boot with proof that no old managed reader was ever started. */
import type {ComponentType} from "react";
import {makeActivationOwner} from "./owned-activation-owner.mjs";
const slot=Symbol.for("blackcrab.mobile.full-ui.activation.v1");
export function activateFullNativeUI(verifyExclusiveOwnership:()=>void|Promise<void>){
 const global=globalThis as typeof globalThis & {[key:symbol]:{start():Promise<ComponentType>}|undefined};
 global[slot]??=makeActivationOwner({verifyExclusiveOwnership,loadFullApp:()=>require("./apps/mobile/src/App").default as ComponentType});
 return global[slot]!.start();
}
'''
(root/'adapters/OwnedActivation.ts').write_text(entry)
additions=[{'path':'src/connection/owned-catalog-state.ts','template':'catalog-state.ts','sha256':sha((root/'catalog-state.ts').read_bytes())}]
additions.append({'path':'src/features/cloud/AccountConnectionStatus.tsx','template':'adapters/AccountConnectionStatus.tsx','sha256':sha((root/'adapters/AccountConnectionStatus.tsx').read_bytes())})
additions.append({'path':'src/features/layout/workspace/navigationHaptics.ts','template':'adapters/navigationHaptics.ts','sha256':sha((root/'adapters/navigationHaptics.ts').read_bytes())})
additions.append({'path':'src/features/agent-awareness/liveActivityProgress.ts','template':'adapters/liveActivityProgress.ts','sha256':sha((root/'adapters/liveActivityProgress.ts').read_bytes())})
additions.append({'path':'src/features/cloud/AccountDeletion.tsx','template':'adapters/AccountDeletion.tsx','sha256':sha((root/'adapters/AccountDeletion.tsx').read_bytes())})
additions.append({'path':'src/features/ide/ideFollow.ts','template':'adapters/ideFollow.ts','sha256':sha((root/'adapters/ideFollow.ts').read_bytes())})
additions.append({'path':'src/features/ide/ThreadIdePane.tsx','template':'adapters/ThreadIdePane.tsx','sha256':sha((root/'adapters/ThreadIdePane.tsx').read_bytes())})
additions.append({'path':'src/widgets/widgetJobs.ts','template':'adapters/widgetJobs.ts','sha256':sha((root/'adapters/widgetJobs.ts').read_bytes())})
additions.append({'path':'src/features/panes/paneGrid.ts','template':'adapters/paneGrid.ts','sha256':sha((root/'adapters/paneGrid.ts').read_bytes())})
additions.append({'path':'src/features/panes/paneStore.ts','template':'adapters/paneStore.ts','sha256':sha((root/'adapters/paneStore.ts').read_bytes())})
additions.append({'path':'src/features/panes/PaneCellHeader.tsx','template':'adapters/PaneCellHeader.tsx','sha256':sha((root/'adapters/PaneCellHeader.tsx').read_bytes())})
additions.append({'path':'src/features/panes/ThreadPanesScreen.tsx','template':'adapters/ThreadPanesScreen.tsx','sha256':sha((root/'adapters/ThreadPanesScreen.tsx').read_bytes())})
(root/'registry.json').write_text(json.dumps({'schema':1,'kind':'blackcrab-full-mobile-ui-owned-adapters','generatorSha256':sha((root/'generator.mjs').read_bytes()),'upstreamCommit':'7f02de2eb8e253e0ec23f005b3cfff8e2c963be8','adapters':records,'additions':additions,'rootAdditions':[{'path':'owned-cloud-config.cjs','template':'adapters/owned-cloud-config.cjs','sha256':sha((root/'adapters/owned-cloud-config.cjs').read_bytes())},{'path':'owned-cloud-config.d.cts','template':'adapters/owned-cloud-config.d.cts','sha256':sha((root/'adapters/owned-cloud-config.d.cts').read_bytes())},{'path':'owned-root-lifecycle.mjs','template':'adapters/owned-root-lifecycle.mjs','sha256':sha((root/'adapters/owned-root-lifecycle.mjs').read_bytes())},{'path':'owned-root-lifecycle.d.mts','template':'adapters/owned-root-lifecycle.d.mts','sha256':sha((root/'adapters/owned-root-lifecycle.d.mts').read_bytes())},{'path':'OwnedActivation.ts','template':'adapters/OwnedActivation.ts','sha256':sha((root/'adapters/OwnedActivation.ts').read_bytes())},{'path':'owned-activation-owner.mjs','template':'owner.mjs','sha256':sha((root/'owner.mjs').read_bytes())},{'path':'owned-activation-owner.d.mts','template':'owner.d.mts','sha256':sha((root/'owner.d.mts').read_bytes())}], 'handoff':{'readyForMount':False,'sourceIntegrated':True,'nativeValidationPending':True,'owner':'process-lifetime; one original foundation/connection registry','requiredBeforeImport':['Remove managed reader imports/state/effect/Workspaces tab from legacy root so that no old managed reader is ever created.','On fresh process boot assert old reader never started, then call activateFullNativeUI exactly once before rendering. Never dispose/restart full foundation in-process.','Integrate unchanged legacy Hosts/queues as an explicit separate navigation destination without a second managed foundation.','Use reviewed Blackcrab native config/modules from current platform handoff; never evaluate copied upstream app.config/EAS.','Restart process after foundation changes; no retry after partial module-install failure.'],'identity':{'name':'Blackcrab','scheme':'blackcrab-remote','iosBundleIdentifier':'dev.blackcrab.remote','upstreamCloudEnabled':False,'ownedCloudConfiguration':'explicit BLACKCRAB public build variables; no inherited upstream account or relay','upstreamOTAEnabled':False,'ownedOTAConfiguration':'explicit BLACKCRAB_EAS_PROJECT_ID and BLACKCRAB_UPDATE_CHANNEL; native updates disabled without owned configuration'},'serviceLifetime':{'moduleAppInitializers':['SplashScreen.preventAutoHideAsync','hydrateWorkspaceSelections','installUiRuntimeMemoryWarningGc','subscribeComposerDraftModelReconciliation','installAppearanceRuntime','installSubscriptionUsageRefresh','installPermissionUpdateNotice','installThreadOutboxDelivery','installComposerAttachmentUploads','startIncomingShareInbox','installAgentNotificationNavigation','installAppShortcuts','installAppUpdateChecks (owned native configuration)','installShowcaseCapture (owned disabled)'],'foundations':['lib/runtime.runtime','connection/runtime.connectionAtomRuntime','state/atom-registry.appAtomRegistry','derived Atom runtimes sharing Runtime.layer']}}},indent=2)+'\n')
print('Pinned adapters',len(records))
