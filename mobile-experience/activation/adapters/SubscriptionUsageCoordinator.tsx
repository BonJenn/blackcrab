// Blackcrab-owned. Publishes provider limits and agent jobs to the home screen widget.
//
// Limits change rarely. Jobs change constantly while an agent streams, but the widget may only
// be reloaded a limited number of times a day, so the jobs picture contains nothing volatile,
// is compared before it is published, and is published at most once per interval. A heartbeat
// republishes an unchanged picture while the app is open so it does not expire under the user.
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import {
  currentProjects,
  currentThreads,
  progressPhase,
} from "../features/agent-awareness/liveActivityProgress";
import { environmentCatalog } from "../connection/catalog";
import { appAtomRegistry } from "../state/atom-registry";
import { environmentProjects } from "../state/projects";
import { environmentPresentations } from "../state/presentation";
import { environmentThreadShells } from "../state/threads";
import { publishSubscriptionUsage } from "./publishSubscriptionUsage";
import { buildSubscriptionUsageSnapshot } from "./subscriptionUsageSnapshot";
import { buildWidgetJobs, stampWidgetJobs, type WidgetJobsBase } from "./widgetJobs";
import { createWidgetTheme } from "./widgetTheme";

/** At most one widget reload per interval for job changes; limits and theme share it. */
const MIN_PUBLISH_INTERVAL_MS = 30_000;
/** Republish an unchanged picture this often while the app is running. */
const HEARTBEAT_MS = 5 * 60_000;

// Isolate quota changes from the much busier thread/config presentation stream.
const snapshotAtom = Atom.make((get) =>
  buildSubscriptionUsageSnapshot(
    get(environmentPresentations.presentationsWithProvidersAtom),
    Linking.createURL("settings/usage", { queryParams: { tab: "limits" } }),
    Platform.OS === "android" ? Infinity : 6,
  ),
).pipe(Atom.withEquality((a, b) => JSON.stringify(a) === JSON.stringify(b)));

/** The jobs picture, replaced only when something a widget would show has changed. */
function useWidgetJobs(): WidgetJobsBase | null {
  const [jobs, setJobs] = useState<WidgetJobsBase | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- derives the widget's job summary from the thread registry and republishes only on a visible change
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let last = "";
    const update = () => {
      const next = buildWidgetJobs({
        threads: currentThreads(),
        projects: currentProjects(),
        nowMs: Date.now(),
        phaseOf: progressPhase,
      });
      const serialized = JSON.stringify(next);
      if (serialized === last) return;
      last = serialized;
      setJobs(next);
    };
    const unsubscribeThreads = appAtomRegistry.subscribe(
      environmentThreadShells.threadShellsAtom,
      update,
      { immediate: true },
    );
    const unsubscribeProjects = appAtomRegistry.subscribe(environmentProjects.projectsAtom, update);
    return () => {
      unsubscribeThreads();
      unsubscribeProjects();
    };
  }, []);
  return jobs;
}

export function SubscriptionUsageCoordinator() {
  const {
    themeMode,
    themeAppearance,
    themeVariablesByAppearance,
    isReady: appearanceReady,
  } = useAppearancePreferences();
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const snapshot = useAtomValue(snapshotAtom);
  const jobs = useWidgetJobs();
  const [heartbeat, setHeartbeat] = useState(0);
  const lastPublished = useRef(0);
  const androidAppearance = Platform.OS === "android" ? themeAppearance : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps an unchanged widget picture from expiring while the app runs
  useEffect(() => {
    const timer = setInterval(() => setHeartbeat((count) => count + 1), HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes subscription usage, agent jobs and theme to the native home screen widget
  useEffect(() => {
    if (!catalog.isReady || !appearanceReady) return;
    const publish = () => {
      lastPublished.current = Date.now();
      const next = {
        ...snapshot,
        theme: createWidgetTheme(themeMode, themeVariablesByAppearance),
        ...(jobs ? { jobs: stampWidgetJobs(jobs, Date.now()) } : {}),
      };
      void Promise.resolve()
        .then(() => publishSubscriptionUsage(next))
        .catch((error: unknown) => {
          console.warn("Could not update subscription usage widget", error);
        });
    };
    const wait = MIN_PUBLISH_INTERVAL_MS - (Date.now() - lastPublished.current);
    if (wait <= 0) {
      publish();
      return;
    }
    // Newer data replaces this timer through the effect cleanup, so the latest always wins.
    const timer = setTimeout(publish, wait);
    return () => clearTimeout(timer);
  }, [
    catalog.isReady,
    appearanceReady,
    snapshot,
    jobs,
    heartbeat,
    themeMode,
    themeVariablesByAppearance,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Android stores resolved colors; System appearance changes must republish them.
    androidAppearance,
  ]);
  return null;
}
