import { useNavigation } from "@react-navigation/native";
import { isListedThreadLineage } from "@t3tools/contracts";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";

import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { PaneContext } from "../../components/ui/Pane";
import { cn } from "../../lib/cn";
import { WorkspaceSlotOptionsContext } from "../../native/v5-workspace-context";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { useInspectorBarSlot } from "../layout/inspector-bar-store";
import { ThreadRouteScreen } from "../threads/ThreadRouteScreen";
import { InspectorContentScope } from "../threads/thread-inspector-preview";
import { ThreadPreviewRoute } from "../threads/thread-preview-route";
import { MAX_PANES, layoutPanes, paneKey, type PaneRef, type PaneRect } from "./paneGrid";
import { paneStore } from "./paneStore";

interface ThreadInfo {
  readonly title: string;
  readonly detail: string;
}

/**
 * What a pane's thread owns, so each pane has its own bar options and error boundary. A pane is a
 * thread screen on a route of its own (the same preview route the inspector uses); its bar options
 * go to a slot nobody renders, because the screen's one native bar belongs to pane mode itself.
 */
function PaneScope(props: { readonly children: ReactNode }) {
  const { slot } = useInspectorBarSlot();
  return (
    <PaneContext value="inspector">
      <InspectorContentScope>
        <WorkspaceSlotOptionsContext value={slot}>
          <RenderErrorBoundary
            renderFallback={(fallback) => (
              <RenderFailureView {...fallback} title="This pane couldn't be displayed" />
            )}
          >
            {props.children}
          </RenderErrorBoundary>
        </WorkspaceSlotOptionsContext>
      </InspectorContentScope>
    </PaneContext>
  );
}

function ThreadPane(props: {
  readonly pane: PaneRef;
  readonly rect: PaneRect;
  readonly info: ThreadInfo | null;
  readonly onMaximize: () => void;
  readonly onClose: () => void;
}) {
  const { rect } = props;
  return (
    <View
      className="absolute overflow-hidden rounded-2xl border border-border bg-screen"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <PaneScope>
        <ThreadPreviewRoute
          environmentId={props.pane.environmentId}
          threadId={props.pane.threadId}
        >
          {(route) => (
            <ThreadRouteScreen
              route={route}
              inspectorPresentation={{
                pane: { subtitle: props.info?.detail ?? null },
                onMaximize: props.onMaximize,
                onClose: props.onClose,
              }}
            />
          )}
        </ThreadPreviewRoute>
      </PaneScope>
    </View>
  );
}

function ThreadChoice(props: {
  readonly title: string;
  readonly detail: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${props.title} in a pane`}
      onPress={props.onPress}
      className="min-h-14 justify-center border-b border-border px-4 py-2 active:bg-subtle"
    >
      <Text className="text-sm text-foreground" numberOfLines={1}>
        {props.title}
      </Text>
      <Text className="text-xs text-foreground-muted" numberOfLines={1}>
        {props.detail}
      </Text>
    </Pressable>
  );
}

export function ThreadPanesScreen() {
  const navigation = useNavigation();
  const panes = useSyncExternalStore(paneStore.subscribe, paneStore.getSnapshot);
  const shells = useVisibleThreadShells();
  const projects = useProjects();
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(
    null,
  );
  const [choosing, setChoosing] = useState(false);

  const projectTitles = new Map(
    projects.map((project) => [`${project.environmentId}\u0000${project.id}`, project.title]),
  );
  const infos = new Map<string, ThreadInfo>();
  const available: Array<{ readonly ref: PaneRef; readonly info: ThreadInfo; readonly at: string }> =
    [];
  for (const shell of shells) {
    if (!isListedThreadLineage(shell.lineage) || shell.archivedAt !== null || shell.deletedAt !== null) continue;
    const ref = { environmentId: String(shell.environmentId), threadId: String(shell.id) };
    const project = projectTitles.get(`${shell.environmentId}\u0000${shell.projectId}`);
    const info = {
      title: shell.title.trim() || "Untitled thread",
      detail: [project, shell.modelSelection.model].filter(Boolean).join(" · "),
    };
    infos.set(paneKey(ref), info);
    available.push({ ref, info, at: shell.updatedAt ?? "" });
  }
  const open = new Set(panes.map(paneKey));
  const choices = available
    .filter((choice) => !open.has(paneKey(choice.ref)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40);

  const layout = size === null ? null : layoutPanes(panes, size.width, size.height);
  const full = panes.length >= MAX_PANES;
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current !== null && current.width === width && current.height === height
        ? current
        : { width, height },
    );
  };
  const choose = (ref: PaneRef) => {
    paneStore.open(ref);
    setChoosing(false);
  };

  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title="Panes"
        subtitle={panes.length === 0 ? null : `${panes.length} of ${MAX_PANES} open`}
        actions={[
          {
            accessibilityLabel: choosing ? "Close thread list" : "Add pane",
            icon: choosing ? "xmark" : "plus",
            selected: choosing,
            disabled: full && !choosing,
            onPress: () => setChoosing((current) => !current),
          },
        ]}
      />
      {layout !== null && layout.hidden.length > 0 ? (
        <ScrollView
          horizontal
          className="grow-0"
          contentContainerClassName="gap-2 px-3 py-2"
          showsHorizontalScrollIndicator={false}
        >
          {layout.hidden.map((pane) => (
            <Pressable
              key={paneKey(pane)}
              accessibilityRole="button"
              accessibilityLabel="Bring pane forward"
              onPress={() => paneStore.bringForward(pane)}
              className="rounded-full border border-border bg-card px-3 py-1.5"
            >
              <Text className="text-sm text-foreground" numberOfLines={1}>
                {infos.get(paneKey(pane))?.title ?? "Thread"}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View className="flex-1 p-2" onLayout={onLayout}>
        {panes.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <EmptyState
              variant="plain"
              title="No threads open"
              detail="Open up to four threads side by side. Each one keeps its own composer and model."
              actionLabel="Choose a thread"
              onAction={() => setChoosing(true)}
            />
          </View>
        ) : null}
        {layout?.cells.map((cell) => (
          <ThreadPane
            key={paneKey(cell.ref)}
            pane={cell.ref}
            rect={cell.rect}
            info={infos.get(paneKey(cell.ref)) ?? null}
            onMaximize={() =>
              navigation.navigate("ThreadInspectorFullscreen", {
                environmentId: cell.ref.environmentId,
                threadId: cell.ref.threadId,
              })
            }
            onClose={() => paneStore.close(cell.ref)}
          />
        ))}
        {choosing ? (
          <View
            className={cn(
              "absolute right-3 top-3 w-96 max-w-full overflow-hidden rounded-2xl border border-border bg-card",
            )}
            style={{ maxHeight: size === null ? undefined : size.height - 24 }}
          >
            {full ? (
              <Text className="px-4 py-3 text-sm text-foreground-muted">
                Four panes are open. Close one to add another.
              </Text>
            ) : choices.length === 0 ? (
              <Text className="px-4 py-3 text-sm text-foreground-muted">
                No other threads to open.
              </Text>
            ) : (
              <ScrollView>
                {choices.map((choice) => (
                  <ThreadChoice
                    key={paneKey(choice.ref)}
                    title={choice.info.title}
                    detail={choice.info.detail}
                    onPress={() => choose(choice.ref)}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}
