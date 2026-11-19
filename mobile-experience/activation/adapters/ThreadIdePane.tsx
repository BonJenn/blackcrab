import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import type { EnvironmentId, ProjectReadFileResult } from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { AppBar } from "../../components/ui/AppBar";
import { EmptyState } from "../../components/ui/EmptyState";
import { cn } from "../../lib/cn";
import { MOBILE_CODE_SURFACE } from "../../lib/typography";
import { useEnvironmentPresentation } from "../../state/presentation";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSession } from "../../state/session";
import { useSelectedThreadVisibleTurnItems } from "../../state/use-thread-detail";
import { basename, isAudioPreviewFile, isVideoPreviewFile } from "../files/filePath";
import { FilePreviewLoading } from "../files/FilePreviewFeedback";
import { SourceFileSurface } from "../files/SourceFileSurface";
import { REVIEW_MONO_FONT_FAMILY, renderVisibleWhitespace } from "../review/reviewDiffRendering";
import {
  ideChanges,
  parseDiffLines,
  selectIdeChange,
  type IdeChange,
  type IdeDiffLine,
} from "./ideFollow";

type IdeViewMode = "diff" | "file";

function changeTone(kind: IdeDiffLine["kind"]): string {
  if (kind === "add") return "bg-emerald-500/10";
  if (kind === "delete") return "bg-rose-500/10";
  if (kind === "hunk") return "bg-card";
  return "";
}

function DiffRow({ row }: { readonly row: IdeDiffLine }) {
  const marker = row.kind === "add" ? "+" : row.kind === "delete" ? "-" : " ";
  const lineNumber = row.newLine ?? row.oldLine;
  const muted = row.kind === "hunk" || row.kind === "meta";
  return (
    <View
      className={cn("flex-row", changeTone(row.kind))}
      style={{ minHeight: MOBILE_CODE_SURFACE.rowHeight }}
    >
      <Text
        className="text-foreground-muted"
        style={{
          width: MOBILE_CODE_SURFACE.gutterWidth,
          paddingRight: 6,
          textAlign: "right",
          fontFamily: REVIEW_MONO_FONT_FAMILY,
          fontSize: MOBILE_CODE_SURFACE.lineNumberFontSize,
          lineHeight: MOBILE_CODE_SURFACE.rowHeight,
        }}
      >
        {lineNumber ?? ""}
      </Text>
      <Text
        className={muted ? "flex-1 text-foreground-muted" : "flex-1 text-foreground"}
        style={{
          paddingRight: MOBILE_CODE_SURFACE.codePadding,
          fontFamily: REVIEW_MONO_FONT_FAMILY,
          fontSize: MOBILE_CODE_SURFACE.fontSize,
          lineHeight: MOBILE_CODE_SURFACE.rowHeight,
        }}
        selectable
      >
        {muted ? row.text : marker + renderVisibleWhitespace(row.text)}
      </Text>
    </View>
  );
}

function DiffView({ diff }: { readonly diff: string }) {
  const rows = useMemo(() => parseDiffLines(diff), [diff]);
  return (
    <FlatList
      data={rows}
      keyExtractor={(_, index) => String(index)}
      renderItem={({ item }) => <DiffRow row={item} />}
      contentInsetAdjustmentBehavior="automatic"
      initialNumToRender={60}
    />
  );
}

function FileView(props: {
  readonly change: IdeChange;
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
}) {
  const { change, cwd, environmentId } = props;
  const session = useEnvironmentQuery(environmentSession.sessionStateAtom(environmentId));
  const environment = useEnvironmentPresentation(environmentId);
  const access = resolveFilesystemReadAccess({
    isCatalogReady: environment.isReady,
    connection: environment.presentation?.connection ?? null,
    session: session.data,
    sessionError: session.error,
  });
  const viewable =
    !isWorkspaceImagePreviewPath(change.path) &&
    !isVideoPreviewFile(change.path) &&
    !isAudioPreviewFile(change.path);
  const query = useEnvironmentQuery(
    access.canReadFiles && viewable
      ? projectEnvironment.readFile({ environmentId, input: { cwd, relativePath: change.path } })
      : null,
  );
  const { refresh } = query;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reloads the open file from the host whenever the agent reports another update to it
  useEffect(() => {
    if (access.canReadFiles && viewable) refresh();
  }, [change.token, access.canReadFiles, viewable, refresh]);
  const file = query.data as ProjectReadFileResult | null;

  if (!viewable) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <EmptyState
          title="No code preview"
          detail="Open this file from Files to view it as media."
        />
      </View>
    );
  }
  if (!access.canReadFiles) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <EmptyState
          title="File unavailable"
          detail={access.isPending ? "Connecting…" : (access.error ?? "This connection cannot read host files.")}
        />
      </View>
    );
  }
  if (query.error !== null && file === null) {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <EmptyState
          title={change.operation === "delete" ? "File deleted" : "File unavailable"}
          detail={query.error}
        />
      </View>
    );
  }
  if (file === null) return <FilePreviewLoading message="Loading file..." />;
  return (
    <SourceFileSurface
      contents={file.contents}
      path={change.path}
      embedded
      onRefresh={() => refresh()}
    />
  );
}

function ChangeChip(props: {
  readonly change: IdeChange;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const { change } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      accessibilityLabel={`${change.path}, ${change.status}`}
      onPress={props.onPress}
      className={cn(
        "mr-2 flex-row items-center rounded-full px-3 py-1.5",
        props.selected ? "bg-foreground/15" : "bg-foreground/5",
      )}
    >
      <Text className="text-sm text-foreground" numberOfLines={1}>
        {basename(change.path)}
      </Text>
      {change.additions !== null ? (
        <Text className="ml-2 text-xs text-emerald-500">+{change.additions}</Text>
      ) : null}
      {change.deletions !== null && change.deletions > 0 ? (
        <Text className="ml-1 text-xs text-rose-500">-{change.deletions}</Text>
      ) : null}
    </Pressable>
  );
}

function ModeButton(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected, disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "rounded-md px-3 py-1",
        props.selected ? "bg-foreground/15" : "",
        props.disabled ? "opacity-40" : "",
      )}
    >
      <Text className="text-sm text-foreground">{props.label}</Text>
    </Pressable>
  );
}

/**
 * Code-first inspector: follows the files the agent changes in this thread, showing the host's
 * diff as it lands and the file as it is on disk. Read-only; browsing and pinning a file pauses
 * following until the user resumes it.
 */
export function ThreadIdePane(props: {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly projectName: string;
  readonly onOpenFiles: () => void;
}) {
  const turnItems = useSelectedThreadVisibleTurnItems();
  const changes = useMemo(() => ideChanges(props.cwd, turnItems), [props.cwd, turnItems]);
  const [pinnedPath, setPinnedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<IdeViewMode>("diff");
  const selected = selectIdeChange(changes, pinnedPath);
  const following = pinnedPath === null || !changes.some((change) => change.path === pinnedPath);
  const mode: IdeViewMode = selected?.diff == null ? "file" : viewMode;

  return (
    <View className="flex-1 ios:bg-sheet android:bg-header">
      <AppBar
        title="Code"
        subtitle={`${props.projectName} · ${changes.length} changed`}
        actions={[
          {
            accessibilityLabel: following ? "Following agent changes" : "Follow agent changes",
            icon: "arrow.down.circle",
            selected: following,
            onPress: () => setPinnedPath(null),
          },
          {
            accessibilityLabel: "Browse files",
            icon: "folder",
            onPress: props.onOpenFiles,
          },
        ]}
      />
      {selected === null ? (
        <View className="flex-1 items-center justify-center px-6">
          <EmptyState
            title="No code changes yet"
            detail="Files the agent edits in this thread appear here as they change."
          />
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="grow-0"
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
          >
            {changes
              .slice()
              .reverse()
              .map((change) => (
                <ChangeChip
                  key={change.path}
                  change={change}
                  selected={change.path === selected.path}
                  onPress={() => setPinnedPath(change.path)}
                />
              ))}
          </ScrollView>
          <View className="flex-row items-center px-3 pb-2">
            <ModeButton
              label="Diff"
              selected={mode === "diff"}
              disabled={selected.diff === null}
              onPress={() => setViewMode("diff")}
            />
            <ModeButton label="File" selected={mode === "file"} onPress={() => setViewMode("file")} />
            <Text className="ml-3 flex-1 text-xs text-foreground-muted" numberOfLines={1}>
              {selected.path} · {selected.status}
            </Text>
          </View>
          <View className="flex-1">
            {mode === "diff" && selected.diff !== null ? (
              <DiffView diff={selected.diff} />
            ) : (
              <FileView change={selected} cwd={props.cwd} environmentId={props.environmentId} />
            )}
          </View>
        </>
      )}
    </View>
  );
}
