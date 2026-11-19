// Blackcrab-owned home screen widget. It replaces the pinned upstream layout, which showed only
// provider usage limits. This one shows what the agents are doing right now (needs you, failed,
// working, done) next to the limits, sized to the widget family.
import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import type { ComponentProps } from "react";
import {
  accessibilityElement,
  accessibilityLabel,
  containerBackground,
  environment,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  progressViewStyle,
  resizable,
  tint,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

import type { SubscriptionUsageSnapshot } from "./subscriptionUsageSnapshot";
import type { WidgetJobs } from "./widgetJobs";

type UsageConfiguration = {
  codexPeriod?: "auto" | "session" | "weekly";
  claudePeriod?: "auto" | "session" | "weekly";
};

type SubscriptionUsageProps = SubscriptionUsageSnapshot & { jobs?: WidgetJobs };

function SubscriptionUsage(
  props: SubscriptionUsageProps,
  widgetEnvironment: WidgetEnvironment<UsageConfiguration> & {
    showsContainerBackground?: boolean;
  },
) {
  "widget";
  // The extension evaluates this function without the app's module scope: everything it
  // uses must be imported above or defined here.
  const family = widgetEnvironment.widgetFamily;
  // Gallery snapshots can render an old timeline entry after it has expired.
  const now = Math.max(widgetEnvironment.date?.getTime() ?? 0, Date.now());
  const accessory = family === "accessoryRectangular";
  const small = family === "systemSmall";
  const medium = family === "systemMedium";
  const large = family === "systemLarge";
  const extraLarge = family === "systemExtraLarge";
  const simplified = widgetEnvironment.levelOfDetail === "simplified";
  const monochrome =
    widgetEnvironment.widgetRenderingMode !== "fullColor" || widgetEnvironment.isLuminanceReduced;
  const isLight = widgetEnvironment.colorScheme === "light";
  const mode = props.theme?.mode;
  const appearance =
    mode === "light" || mode === "dark" ? mode : widgetEnvironment.colorScheme === "dark" ? "dark" : "light";
  // StandBy can remove the card even in full color; text must then follow the host.
  const palette =
    !accessory && !monochrome && widgetEnvironment.showsContainerBackground !== false
      ? props.theme?.[appearance]
      : undefined;
  const primary = palette?.foreground ?? "primary";
  const secondary = palette?.secondary ?? "secondary";
  const danger = palette?.danger ?? (isLight ? "#dc2626" : "#fca5a5");
  const providers = props.providers ?? [
    { name: "Codex", detail: "Open Blackcrab to connect", windows: [], expiresAt: 0, totalWindows: 0 },
    { name: "Claude", detail: "Open Blackcrab to connect", windows: [], expiresAt: 0, totalWindows: 0 },
  ];

  // ---- Jobs ----
  const jobs = props.jobs;
  const jobsFresh = jobs !== undefined && now < jobs.expiresAt;
  const jobsIdle = jobsFresh && jobs.working + jobs.attention + jobs.failed + jobs.done === 0;
  const jobRowLimit = extraLarge ? 6 : large ? 4 : medium ? 3 : small ? 1 : 0;
  const shownRows = jobsFresh ? jobs.rows.slice(0, jobRowLimit) : [];
  const topRow = jobsFresh ? jobs.rows[0] : undefined;
  const needsUser = (phase: string) => phase === "waiting_for_approval" || phase === "waiting_for_input";
  const jobSummary = () => {
    if (jobs === undefined) return "Open Blackcrab to see agent jobs";
    if (!jobsFresh) return "Open Blackcrab to refresh jobs";
    const parts: string[] = [];
    if (jobs.attention > 0) parts.push(`${jobs.attention} ${jobs.attention === 1 ? "needs" : "need"} you`);
    if (jobs.failed > 0) parts.push(`${jobs.failed} failed`);
    if (jobs.working > 0) parts.push(`${jobs.working} working`);
    if (jobs.done > 0 && parts.length < 3) parts.push(`${jobs.done} done`);
    return parts.length > 0 ? parts.join(" · ") : "No agents running";
  };
  const jobTint = (phase: string) => {
    if (monochrome) return primary;
    if (phase === "waiting_for_approval") return isLight ? "#d97706" : "#fcd34d";
    if (phase === "waiting_for_input") return isLight ? "#4f46e5" : "#a5b4fc";
    if (phase === "failed") return danger;
    if (phase === "completed") return isLight ? "#059669" : "#6ee7b7";
    return isLight ? "#0284c7" : "#7dd3fc";
  };
  type SFName = NonNullable<ComponentProps<typeof Image>["systemName"]>;
  const jobSymbol = (phase: string): SFName => {
    if (phase === "waiting_for_approval") return "exclamationmark.circle.fill";
    if (phase === "waiting_for_input") return "questionmark.circle.fill";
    if (phase === "failed") return "xmark.octagon.fill";
    if (phase === "completed") return "checkmark.circle.fill";
    if (phase === "starting") return "circle.dotted";
    return "circle.dashed";
  };
  // SF Symbols ignore frame/foregroundStyle applied directly; size and tint them through a
  // container the resizable symbol fills.
  const glyph = (name: SFName, size: number, color: Parameters<typeof foregroundStyle>[0]) => (
    <HStack modifiers={[frame({ width: size, height: size }), foregroundStyle(color)]}>
      <Image systemName={name} modifiers={[resizable()]} />
    </HStack>
  );
  const jobRow = (row: NonNullable<typeof topRow>, size: number, withContext: boolean) => (
    <VStack
      key={row.deepLink}
      alignment="leading"
      spacing={1}
      modifiers={[
        accessibilityElement("ignore"),
        accessibilityLabel(`${row.title}, ${row.project}, ${row.status}`),
      ]}
    >
      <HStack spacing={4} alignment="center">
        {glyph(jobSymbol(row.phase), size + 2, jobTint(row.phase))}
        <Text
          modifiers={[
            font({ weight: "semibold", size }),
            foregroundStyle(primary),
            lineLimit(1),
          ]}
        >
          {row.title}
        </Text>
        <Spacer minLength={4} />
        {row.startedAt !== null ? (
          // A live clock the system advances without the app running.
          <Text
            date={new Date(row.startedAt)}
            dateStyle="timer"
            modifiers={[
              font({ size: size - 1, weight: "medium" }),
              monospacedDigit(),
              foregroundStyle(needsUser(row.phase) ? jobTint(row.phase) : secondary),
              multilineTextAlignment("trailing"),
              frame({ width: size * 3.6, alignment: "trailing" }),
              lineLimit(1),
              minimumScaleFactor(0.7),
            ]}
          />
        ) : (
          <Text
            modifiers={[
              font({ size: size - 1, weight: "medium" }),
              foregroundStyle(row.phase === "failed" ? jobTint(row.phase) : secondary),
              lineLimit(1),
              layoutPriority(1),
            ]}
          >
            {row.status}
          </Text>
        )}
      </HStack>
      {withContext ? (
        <Text modifiers={[font({ size: 10 }), foregroundStyle(secondary), lineLimit(1)]}>
          {`${row.project} · ${row.model}${needsUser(row.phase) ? " · " + row.status : ""}`}
        </Text>
      ) : null}
    </VStack>
  );
  const jobsHeader = (size: number) => (
    <HStack spacing={4} alignment="center">
      {glyph(
        topRow && jobsFresh && (needsUser(topRow.phase) || topRow.phase === "failed")
          ? jobSymbol(topRow.phase)
          : "square.stack.3d.up.fill",
        size + 1,
        topRow && jobsFresh && (needsUser(topRow.phase) || topRow.phase === "failed")
          ? jobTint(topRow.phase)
          : secondary,
      )}
      <Text
        modifiers={[
          font({ weight: "bold", size }),
          foregroundStyle(
            topRow && jobsFresh && (needsUser(topRow.phase) || topRow.phase === "failed")
              ? jobTint(topRow.phase)
              : primary,
          ),
          lineLimit(1),
          minimumScaleFactor(0.8),
        ]}
      >
        {jobSummary()}
      </Text>
    </HStack>
  );
  const jobsSection = (size: number, withContext: boolean) => (
    <VStack alignment="leading" spacing={small ? 3 : 5} modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}>
      {jobsHeader(size)}
      {shownRows.map((row) => jobRow(row, size, withContext))}
      {jobsFresh && !jobsIdle && jobs.rows.length > shownRows.length ? (
        <Text modifiers={[font({ size: 10 }), foregroundStyle(secondary), lineLimit(1)]}>
          {`${jobs.rows.length - shownRows.length} more in Blackcrab`}
        </Text>
      ) : null}
    </VStack>
  );

  // ---- Limits ----
  const limitWindows = extraLarge ? 4 : 2;
  const states = providers.map((provider) => {
    const stale = provider.windows.length > 0 && now >= provider.expiresAt;
    const period =
      widgetEnvironment.configuration?.[provider.name === "Claude" ? "claudePeriod" : "codexPeriod"] ?? "auto";
    const windows = stale
      ? []
      : provider.windows.filter((window) => period === "auto" || window.kind === period);
    const tightest = windows.reduce<(typeof windows)[number] | undefined>(
      (result, window) => (!result || window.remaining < result.remaining ? window : result),
      undefined,
    );
    const compactWindows = [
      windows.find((window) => window.kind === "session"),
      windows.find((window) => window.kind === "weekly"),
    ].filter((window) => window !== undefined);
    const shown =
      period === "auto" && compactWindows.length > 0
        ? [...compactWindows, ...windows.filter((window) => !compactWindows.includes(window))].slice(0, limitWindows)
        : windows.slice(0, limitWindows);
    const detail = stale
      ? "Open Blackcrab to refresh"
      : period !== "auto" && windows.length === 0 && provider.windows.length > 0
        ? `No ${period} limit reported`
        : provider.detail;
    return { provider, stale, period, windows, tightest, shown, detail };
  });
  const barModifiers = (name: string) => [
    progressViewStyle("linear"),
    frame({ height: 4 }),
    ...(monochrome ? [] : [tint(name === "Claude" ? "#d97757" : "#8e8e93")]),
  ];
  const remainingColor = (remaining: number) => (remaining <= 10 && !monochrome ? danger : primary);
  // One line and one bar per provider: the tightest window.
  const slimLimit = (state: (typeof states)[number], size: number) => (
    <VStack
      key={state.provider.name}
      alignment="leading"
      spacing={1}
      modifiers={[
        accessibilityElement("ignore"),
        accessibilityLabel(
          state.tightest
            ? `${state.provider.name}, ${state.tightest.label}, ${state.tightest.remaining} percent remaining. ${state.tightest.reset}.`
            : `${state.provider.name}. ${state.detail}.`,
        ),
      ]}
    >
      <HStack spacing={4}>
        <Text modifiers={[font({ weight: "semibold", size }), foregroundStyle(primary), lineLimit(1)]}>
          {state.provider.name}
          {state.tightest && !small ? ` · ${state.tightest.label}` : ""}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ weight: "semibold", size }),
            lineLimit(1),
            layoutPriority(1),
            foregroundStyle(state.tightest ? remainingColor(state.tightest.remaining) : secondary),
          ]}
        >
          {state.tightest
            ? `${state.tightest.remaining}% left`
            : state.period !== "auto" && !state.stale && state.provider.windows.length > 0
              ? "N/A"
              : "Open Blackcrab"}
        </Text>
      </HStack>
      {state.tightest ? (
        <ProgressView value={state.tightest.remaining / 100} modifiers={barModifiers(state.provider.name)} />
      ) : null}
    </VStack>
  );
  const fullLimit = (state: (typeof states)[number]) => (
    <VStack
      key={state.provider.name}
      alignment="leading"
      spacing={3}
      modifiers={[
        frame({ maxWidth: Infinity, alignment: "leading" }),
        fixedSize({ horizontal: false, vertical: true }),
      ]}
    >
      <Text modifiers={[font({ textStyle: "headline", weight: "bold" }), lineLimit(1), foregroundStyle(primary)]}>
        {state.provider.name}
      </Text>
      <Text modifiers={[font({ textStyle: "caption2" }), foregroundStyle(secondary), lineLimit(1)]}>
        {state.detail === "Subscription remaining" ? " " : state.detail}
      </Text>
      {state.shown.map((window) => (
        <VStack
          key={window.label}
          alignment="leading"
          spacing={2}
          modifiers={[
            accessibilityElement("ignore"),
            accessibilityLabel(
              `${state.provider.name}, ${window.label}, ${window.remaining} percent remaining. ${window.reset}. ${state.provider.detail}.`,
            ),
          ]}
        >
          <HStack spacing={4}>
            <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(secondary), lineLimit(1)]}>
              {window.label}
            </Text>
            <Spacer />
            <Text
              modifiers={[
                font({ textStyle: "caption", weight: "semibold" }),
                lineLimit(1),
                layoutPriority(1),
                foregroundStyle(remainingColor(window.remaining)),
              ]}
            >
              {window.remaining}% left
            </Text>
          </HStack>
          <ProgressView value={window.remaining / 100} modifiers={barModifiers(state.provider.name)} />
          <Text modifiers={[font({ size: 10 }), foregroundStyle(secondary), lineLimit(1)]}>{window.reset}</Text>
        </VStack>
      ))}
    </VStack>
  );

  // ---- Compose ----
  // Tapping opens the job that needs attention, or the longest-running one; otherwise the limits.
  const link = topRow && !jobsIdle ? `blackcrab-remote://${topRow.deepLink.slice(1)}` : props.url;
  const checked = props.checkedAt
    ? `As of ${new Date(props.checkedAt).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}`
    : "Tap to connect in Blackcrab";
  const footer = (
    <Text modifiers={[font({ textStyle: "caption2" }), foregroundStyle(secondary), lineLimit(1)]}>{checked}</Text>
  );

  let body;
  if (accessory) {
    const tightest = states.reduce<{ name: string; window: { label: string; remaining: number } } | undefined>(
      (result, state) =>
        state.tightest && (!result || state.tightest.remaining < result.window.remaining)
          ? { name: state.provider.name, window: state.tightest }
          : result,
      undefined,
    );
    body = (
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[
            font({ textStyle: "caption", weight: "semibold" }),
            lineLimit(1),
            foregroundStyle(primary),
            accessibilityLabel(`Agent jobs: ${jobSummary()}`),
          ]}
        >
          {jobSummary()}
        </Text>
        {tightest ? (
          <HStack spacing={4}>
            <Text modifiers={[font({ textStyle: "caption2" }), lineLimit(1), foregroundStyle(primary)]}>
              {`${tightest.name} · ${tightest.window.label}`}
            </Text>
            <Spacer />
            <Text modifiers={[font({ textStyle: "caption2", weight: "semibold" }), lineLimit(1), layoutPriority(1), foregroundStyle(primary)]}>
              {`${tightest.window.remaining}% left`}
            </Text>
          </HStack>
        ) : null}
        {tightest ? (
          <ProgressView value={tightest.window.remaining / 100} modifiers={barModifiers(tightest.name)} />
        ) : null}
      </VStack>
    );
  } else if (small) {
    body = (
      <VStack alignment="leading" spacing={6}>
        {jobsSection(12, false)}
        <VStack alignment="leading" spacing={4}>
          {states.map((state) => slimLimit(state, 11))}
        </VStack>
      </VStack>
    );
  } else if (medium) {
    body = (
      <HStack alignment="top" spacing={14}>
        {jobsSection(12, false)}
        <VStack alignment="leading" spacing={6} modifiers={[frame({ width: 120, alignment: "leading" })]}>
          {states.map((state) => slimLimit(state, 11))}
        </VStack>
      </HStack>
    );
  } else {
    body = (
      <VStack alignment="leading" spacing={10}>
        {jobsSection(13, true)}
        <HStack alignment="top" spacing={16}>
          {simplified ? states.map((state) => slimLimit(state, 12)) : states.map((state) => fullLimit(state))}
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack
      alignment="leading"
      spacing={accessory || small || medium ? 2 : 6}
      modifiers={[
        ...(link ? [widgetURL(link)] : []),
        ...(palette
          ? [containerBackground(palette.background, "widget"), environment("colorScheme", appearance)]
          : []),
      ]}
    >
      {body}
      {!accessory ? <Spacer /> : null}
      {!accessory && !small ? footer : null}
    </VStack>
  );
}

export default createWidget("SubscriptionUsage", SubscriptionUsage);
