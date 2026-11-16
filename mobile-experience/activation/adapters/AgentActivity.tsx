// Blackcrab-owned Live Activity layout. It replaces the pinned upstream widget so the lock
// screen and Dynamic Island show what the agents are doing: the current step, time in the
// current state, how many agents have finished, and what needs the user.
import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import type { ComponentProps } from "react";
import {
  accessibilityElement,
  accessibilityLabel,
  activityBackgroundTint,
  font,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  resizable,
  tint,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import {
  createLiveActivity,
  type LiveActivityComponent,
  type LiveActivityLayout,
} from "expo-widgets";

type LiveActivityEnvironment = Parameters<LiveActivityComponent<AgentActivityProps>>[1];

export type AgentActivityPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "stale";

export interface AgentActivityRowProps {
  readonly environmentId: string;
  readonly threadId: string;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly modelTitle: string;
  readonly phase: AgentActivityPhase;
  readonly status: string;
  readonly updatedAt: string;
  readonly deepLink: string;
  // The fields below come from the app's own connection while it is running. Updates pushed
  // by the relay do not carry them, so every reader must cope with their absence.
  /** What the agent is doing or last said, in one or two lines. */
  readonly detail?: string;
  /** When `detail` was observed. */
  readonly detailAt?: string;
  /** When the current run started. */
  readonly startedAt?: string;
  /** Steps (messages, tool calls, edits) recorded in the thread so far. */
  readonly steps?: number;
}

export interface AgentActivityProps {
  readonly title: string;
  readonly subtitle: string;
  readonly activeCount: number;
  readonly updatedAt: string;
  readonly activities: ReadonlyArray<AgentActivityRowProps>;
}

// Widget serialization excludes module helpers; use only imported view/modifier factories.
function AgentActivity(
  props: AgentActivityProps,
  environment: LiveActivityEnvironment,
): LiveActivityLayout {
  "widget";

  // Hierarchical foregrounds inherit system tint and vibrancy.
  type Foreground = Parameters<typeof foregroundStyle>[0];
  const primaryForeground = { type: "hierarchical", style: "primary" } as const;
  const secondaryForeground = { type: "hierarchical", style: "secondary" } as const;
  const monochrome =
    environment.widgetRenderingMode === "accented" || environment.widgetRenderingMode === "vibrant";

  // iPhone uses dark Live Activity material, macOS light; choose the palette variant by color scheme.
  const isLightScheme = environment.colorScheme === "light";
  const phaseTint = (phase: AgentActivityPhase | undefined): Foreground => {
    if (environment.isLuminanceReduced) {
      return secondaryForeground;
    }
    if (monochrome) {
      return primaryForeground;
    }
    switch (phase) {
      case "waiting_for_approval":
        return isLightScheme ? "#d97706" : "#fcd34d";
      case "waiting_for_input":
        return isLightScheme ? "#4f46e5" : "#a5b4fc";
      case "failed":
        return isLightScheme ? "#dc2626" : "#fca5a5";
      case "completed":
        return isLightScheme ? "#059669" : "#6ee7b7";
      case "stale":
        return secondaryForeground;
      case "starting":
      case "running":
      default:
        return isLightScheme ? "#0284c7" : "#7dd3fc";
    }
  };

  const phasePriority = (phase: AgentActivityPhase): number => {
    if (phase === "waiting_for_approval" || phase === "waiting_for_input") return 0;
    if (phase === "failed") return 1;
    if (phase === "running" || phase === "starting") return 2;
    return 3;
  };
  const isTerminal = (phase: AgentActivityPhase) => phase === "completed" || phase === "failed";
  const needsUser = (phase: AgentActivityPhase) =>
    phase === "waiting_for_approval" || phase === "waiting_for_input";

  // Mark in-flight rows stale after expiry so they cannot claim agents still work.
  const activities: ReadonlyArray<AgentActivityRowProps> = environment.isStale
    ? props.activities.map((row) =>
        isTerminal(row.phase) ? row : { ...row, phase: "stale", status: "Out of date" },
      )
    : props.activities;
  const ordered = [...activities].sort((a, b) => phasePriority(a.phase) - phasePriority(b.phase));
  const hero = ordered[0];
  const others = ordered.slice(1);

  const attentionRows = activities.filter((row) => needsUser(row.phase));
  const attentionRow = attentionRows[0];
  const failedRow = activities.find((row) => row.phase === "failed");
  const finishedCount = activities.filter((row) => isTerminal(row.phase)).length;
  const workingCount = activities.filter(
    (row) => row.phase === "running" || row.phase === "starting",
  ).length;
  const heroTint = phaseTint(hero?.phase);
  const headerTint = attentionRow
    ? phaseTint(attentionRow.phase)
    : failedRow
      ? phaseTint(failedRow.phase)
      : heroTint;

  const allDone = props.activeCount === 0;
  const doneLabel = failedRow ? "Failed" : "Done";

  // "2 working · 1 needs you · 1 done": every number comes from the rows on screen, except
  // the working count, which uses the account-wide total when it is larger than the rows shown.
  const hiddenActive = Math.max(0, props.activeCount - (workingCount + attentionRows.length));
  const summaryParts: string[] = [];
  if (environment.isStale && !allDone) {
    summaryParts.push("Out of date");
  } else {
    if (workingCount + hiddenActive > 0) summaryParts.push(`${workingCount + hiddenActive} working`);
    if (attentionRows.length > 0) {
      summaryParts.push(`${attentionRows.length} need${attentionRows.length === 1 ? "s" : ""} you`);
    }
    if (finishedCount > 0) {
      summaryParts.push(failedRow && finishedCount === 1 ? "1 failed" : `${finishedCount} done`);
    }
  }
  const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : doneLabel;
  const spokenSummary = allDone
    ? failedRow
      ? "Agent work failed"
      : "Agent work completed"
    : environment.isStale
      ? "Agent status out of date"
      : `Blackcrab agents: ${summary}`;

  // Widget taps target the containing app, so its production scheme is safe in every build.
  const deepLinkRow = attentionRow ?? hero;
  const deepLink =
    deepLinkRow && deepLinkRow.deepLink.startsWith("/") && !deepLinkRow.deepLink.startsWith("//")
      ? `blackcrab-remote://${deepLinkRow.deepLink.slice(1)}`
      : null;
  const linkModifiers = deepLink ? [widgetURL(deepLink)] : [];

  type SFName = NonNullable<ComponentProps<typeof Image>["systemName"]>;
  const phaseSymbol = (phase: AgentActivityPhase): SFName => {
    switch (phase) {
      case "waiting_for_approval":
        return "exclamationmark.circle.fill";
      case "waiting_for_input":
        return "questionmark.circle.fill";
      case "failed":
        return "xmark.octagon.fill";
      case "completed":
        return "checkmark.circle.fill";
      case "starting":
        return "circle.dotted";
      case "stale":
        return "clock.arrow.circlepath";
      case "running":
      default:
        // Matches the thread list's Working indicator.
        return "circle.dashed";
    }
  };

  const timeOf = (value: string | undefined): number | null => {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  };
  // Running rows count from the start of the run when the app supplied it; otherwise from the
  // moment the row entered its current state. Rows that need the user count the wait.
  const clockStart = (row: AgentActivityRowProps): number | null => {
    if (isTerminal(row.phase) || row.phase === "stale") return null;
    const start = needsUser(row.phase) ? null : timeOf(row.startedAt);
    return start ?? timeOf(row.updatedAt);
  };
  // What to say under a row's title when the app supplied no step detail.
  const fallbackDetail = (row: AgentActivityRowProps): string => {
    switch (row.phase) {
      case "waiting_for_approval":
        return "Waiting for your approval. Tap to review.";
      case "waiting_for_input":
        return "Waiting for your answer. Tap to reply.";
      case "completed":
        return "Finished. Tap to review the result.";
      case "failed":
        return "The run failed. Tap to see what happened.";
      case "stale":
        return "No recent update from this computer.";
      case "starting":
        return "Starting the agent…";
      case "running":
      default:
        return "Working…";
    }
  };
  const contextLine = (row: AgentActivityRowProps): string => {
    const parts = [row.projectTitle];
    if (row.modelTitle) parts.push(row.modelTitle);
    if (typeof row.steps === "number" && row.steps > 0) {
      parts.push(`${row.steps} step${row.steps === 1 ? "" : "s"}`);
    }
    return parts.join(" · ");
  };

  // SF Symbols, like the logo, ignore frame/foregroundStyle applied directly to
  // the image; size + tint them through a container the resizable symbol fills.
  const renderGlyph = (
    systemName: SFName,
    size: number,
    color: Foreground,
    modifiers: typeof linkModifiers = [],
  ) => (
    <HStack
      modifiers={[frame({ width: size, height: size }), foregroundStyle(color), ...modifiers]}
    >
      <Image systemName={systemName} modifiers={[resizable()]} />
    </HStack>
  );

  // The crab mark is a template image in the widget's own asset catalog; it takes the
  // container's foreground style. Its artwork is 1.16 times as wide as it is tall.
  const renderLogo = (height: number, color: Foreground, modifiers: typeof linkModifiers = []) => (
    <HStack
      modifiers={[
        frame({ width: Math.round(height * 1.16), height }),
        foregroundStyle(color),
        ...modifiers,
      ]}
    >
      <Image assetName="BlackcrabMark" modifiers={[resizable()]} />
    </HStack>
  );

  // A live clock that the system advances without the app running.
  const renderClock = (
    startMs: number,
    size: number,
    color: Foreground,
    width: number,
    modifiers: typeof linkModifiers = [],
  ) => (
    <Text
      date={new Date(startMs)}
      dateStyle="timer"
      modifiers={[
        font({ weight: "semibold", size }),
        monospacedDigit(),
        foregroundStyle(color),
        multilineTextAlignment("trailing"),
        frame({ width, alignment: "trailing" }),
        lineLimit(1),
        minimumScaleFactor(0.7),
        ...modifiers,
      ]}
    />
  );

  const renderStatus = (row: AgentActivityRowProps, size: number) => {
    const start = clockStart(row);
    return (
      <HStack spacing={4} alignment="center" modifiers={[layoutPriority(1)]}>
        <Text
          modifiers={[
            font({ weight: "semibold", size }),
            foregroundStyle(phaseTint(row.phase)),
            lineLimit(1),
          ]}
        >
          {row.status}
        </Text>
        {start !== null ? renderClock(start, size, secondaryForeground, size * 3.4) : null}
      </HStack>
    );
  };

  const renderHero = (row: AgentActivityRowProps, detailLines: number) => (
    <VStack alignment="leading" spacing={2}>
      <HStack spacing={6} alignment="center">
        {renderGlyph(phaseSymbol(row.phase), 15, phaseTint(row.phase))}
        <Text
          modifiers={[
            font({ weight: "semibold", size: 15 }),
            foregroundStyle(primaryForeground),
            lineLimit(1),
          ]}
        >
          {row.threadTitle}
        </Text>
        <Spacer minLength={6} />
        {renderStatus(row, 12)}
      </HStack>
      <Text
        modifiers={[
          font({ size: 13 }),
          foregroundStyle(needsUser(row.phase) ? phaseTint(row.phase) : primaryForeground),
          lineLimit(detailLines),
        ]}
      >
        {row.detail && !isTerminal(row.phase) && row.phase !== "stale"
          ? row.detail
          : fallbackDetail(row)}
      </Text>
      <Text modifiers={[font({ size: 11 }), foregroundStyle(secondaryForeground), lineLimit(1)]}>
        {contextLine(row)}
      </Text>
    </VStack>
  );

  const renderCompactRow = (row: AgentActivityRowProps) => (
    <HStack spacing={6} alignment="center">
      {renderGlyph(phaseSymbol(row.phase), 12, phaseTint(row.phase))}
      <Text
        modifiers={[
          font({ weight: "medium", size: 12 }),
          foregroundStyle(primaryForeground),
          lineLimit(1),
        ]}
      >
        {row.threadTitle}
      </Text>
      {/* Bare texts share shrinkage proportionally; project frames or layoutPriority would prevent balanced truncation. */}
      <Text modifiers={[font({ size: 11 }), foregroundStyle(secondaryForeground), lineLimit(1)]}>
        {row.projectTitle}
      </Text>
      <Spacer minLength={6} />
      {renderStatus(row, 11)}
    </HStack>
  );

  // Progress across the agents on screen: finished out of all shown. A single agent has no
  // honest fraction to show, so the bar appears only when several agents are listed.
  const totalRows = activities.length;
  const showProgress = totalRows > 1;
  const progressBar = showProgress ? (
    <ProgressView
      value={finishedCount / totalRows}
      modifiers={[
        tint(allDone ? headerTint : phaseTint("completed")),
        accessibilityLabel(`${finishedCount} of ${totalRows} agents finished`),
      ]}
    />
  ) : null;

  const moreCount = (shown: number) => Math.max(0, others.length - shown) + hiddenActive;
  const renderMore = (count: number) =>
    count > 0 ? (
      <Text modifiers={[font({ size: 11 }), foregroundStyle(secondaryForeground), lineLimit(1)]}>
        {`+${count} more`}
      </Text>
    ) : null;

  const heroStart = hero ? clockStart(hero) : null;
  const compactLabel = attentionRow
    ? attentionRow.phase === "waiting_for_approval"
      ? "Approval"
      : "Input"
    : failedRow
      ? "Failed"
      : allDone
        ? "Done"
        : environment.isStale
          ? "Out of date"
          : null;

  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={5}
        modifiers={[
          padding({ horizontal: 14, vertical: 12 }),
          // A clear tint reveals iOS 26's glass material; older hosts keep the standard surface.
          activityBackgroundTint(environment.isLiquidGlassAvailable ? "clear" : null),
          accessibilityLabel(spokenSummary),
          ...(deepLink ? [widgetURL(deepLink)] : []),
        ]}
      >
        <HStack spacing={6} alignment="center">
          {renderLogo(14, primaryForeground)}
          <Text
            modifiers={[
              font({ weight: "semibold", size: 12 }),
              foregroundStyle(secondaryForeground),
              lineLimit(1),
            ]}
          >
            Blackcrab
          </Text>
          <Spacer minLength={8} />
          <Text
            modifiers={[
              font({ weight: "semibold", size: 12 }),
              foregroundStyle(attentionRow || failedRow || allDone ? headerTint : primaryForeground),
              lineLimit(1),
            ]}
          >
            {summary}
          </Text>
        </HStack>
        {hero ? renderHero(hero, others.length > 0 ? 1 : 2) : null}
        {progressBar}
        {others[0] ? renderCompactRow(others[0]) : null}
        {others[1] ? renderCompactRow(others[1]) : null}
        {renderMore(moreCount(2))}
      </VStack>
    ),
    bannerSmall: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 10 })]}>
        <HStack spacing={6} alignment="center">
          {renderLogo(13, primaryForeground)}
          <Text
            modifiers={[
              font({ weight: "bold", size: 12 }),
              foregroundStyle(headerTint),
              lineLimit(1),
            ]}
          >
            {summary}
          </Text>
          <Spacer minLength={6} />
        </HStack>
        {hero ? (
          <HStack spacing={6} alignment="center">
            <Text
              modifiers={[
                font({ weight: "semibold", size: 12 }),
                foregroundStyle(primaryForeground),
                lineLimit(1),
              ]}
            >
              {hero.threadTitle}
            </Text>
            <Spacer minLength={6} />
            {renderStatus(hero, 11)}
          </HStack>
        ) : null}
        {hero ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(secondaryForeground), lineLimit(1)]}>
            {hero.detail && !isTerminal(hero.phase) && hero.phase !== "stale"
              ? hero.detail
              : fallbackDetail(hero)}
          </Text>
        ) : null}
      </VStack>
    ),
    compactLeading: renderLogo(14, heroTint, linkModifiers),
    // While agents are only working, show how long the foremost one has been at it. Words
    // appear only when something needs the user or has ended.
    compactTrailing:
      compactLabel === null && heroStart !== null ? (
        <HStack
          modifiers={[
            padding({ trailing: 2 }),
            accessibilityElement("ignore"),
            accessibilityLabel(spokenSummary),
            ...linkModifiers,
          ]}
        >
          {renderClock(heroStart, 12, heroTint, 44)}
        </HStack>
      ) : (
        <Text
          modifiers={[
            font({ weight: "semibold", size: 11 }),
            foregroundStyle(heroTint),
            lineLimit(1),
            minimumScaleFactor(0.5),
            ...linkModifiers,
          ]}
        >
          {compactLabel ?? summary}
        </Text>
      ),
    minimal: hero
      ? renderGlyph(phaseSymbol(hero.phase), 13, phaseTint(hero.phase), linkModifiers)
      : renderLogo(11, heroTint, linkModifiers),
    expandedLeading: (
      <HStack spacing={5} alignment="center" modifiers={[padding({ leading: 4, vertical: 4 })]}>
        {renderLogo(15, heroTint)}
        <Text
          modifiers={[font({ weight: "bold", size: 13 }), foregroundStyle(heroTint), lineLimit(1)]}
        >
          {allDone ? doneLabel : `${props.activeCount} active`}
        </Text>
      </HStack>
    ),
    expandedCenter: null,
    expandedTrailing:
      hero && heroStart !== null ? (
        <HStack modifiers={[padding({ trailing: 4, vertical: 4 })]}>
          {renderClock(heroStart, 13, heroTint, 52)}
        </HStack>
      ) : null,
    expandedBottom: (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={
          deepLink
            ? [padding({ vertical: 2, horizontal: 8 }), widgetURL(deepLink)]
            : [padding({ vertical: 2, horizontal: 8 })]
        }
      >
        {hero ? renderHero(hero, 1) : null}
        {progressBar}
        {others[0] ? renderCompactRow(others[0]) : null}
        {renderMore(moreCount(1))}
      </VStack>
    ),
  };
}

export default createLiveActivity<AgentActivityProps>("AgentActivity", AgentActivity);
