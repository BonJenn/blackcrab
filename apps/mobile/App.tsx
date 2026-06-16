import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  AppState,
  Dimensions,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import type {
  ApprovalRequest,
  HostId,
  MessageId,
  RemoteAttachment,
  SessionId,
  SessionSummary,
  TranscriptEntry,
} from "@blackcrab/remote-protocol";

import { ApprovalScreen } from "./src/screens/ApprovalScreen";
import { NewSessionScreen } from "./src/screens/NewSessionScreen";
import { PairedHostsScreen } from "./src/screens/PairedHostsScreen";
import { PairHostScreen } from "./src/screens/PairHostScreen";
import { SessionsScreen } from "./src/screens/SessionsScreen";
import { TranscriptScreen } from "./src/screens/TranscriptScreen";
import {
  forgetStoredHost,
  loadReadCursors,
  loadStoredHosts,
  readCursorKey,
  saveReadCursor,
  type StoredPairedHost,
} from "./src/pairingStore";
import { connectWithFailover } from "./src/transport/failoverTransport";
import { firstConnectableHost } from "./src/transport/reconnect";
import type { Transport, TransportStatus } from "./src/transport/types";
import { tapHaptic } from "./src/haptics";

/** Last path segment, used as a provisional title for a brand-new session. */
function dirName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Turn a raw host failure reason into a clear, actionable alert. The common
 * one is an expired Claude login on the desktop, which surfaces as a 401.
 */
function describeActionFailure(reason: string): { title: string; message: string } {
  const r = reason.toLowerCase();
  if (r.includes("401") || r.includes("authentication") || r.includes("invalid api")) {
    return {
      title: "Desktop login expired",
      message:
        "Your desktop's Claude login needs refreshing. On the desktop, run “claude /login” (or sign in via the Blackcrab app), then try again.",
    };
  }
  if (r.includes("another window") || r.includes("active in")) {
    return {
      title: "Session busy elsewhere",
      message:
        "This conversation is open in another window on the desktop. Close it there, or continue from that window.",
    };
  }
  return { title: "Couldn’t send", message: reason };
}

type TabKey = "hosts" | "sessions" | "approval";

const TABS: { key: TabKey; label: string }[] = [
  { key: "hosts", label: "Hosts" },
  { key: "sessions", label: "Chats" },
  { key: "approval", label: "Attention" },
];

export default function App() {
  const [tab, setTab] = useState<TabKey>("hosts");
  const [storedHosts, setStoredHosts] = useState<StoredPairedHost[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [pairing, setPairing] = useState(false);
  const [activeTransport, setActiveTransport] = useState<Transport | null>(null);
  const [activeStatus, setActiveStatus] = useState<TransportStatus | null>(null);
  const [activeHostId, setActiveHostId] = useState<HostId | null>(null);
  const [liveSessions, setLiveSessions] = useState<SessionSummary[] | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<TranscriptEntry[] | null>(
    null,
  );
  const [approvals, setApprovals] = useState<ApprovalRequest[] | null>(null);
  // Partial assistant reply streamed by the host while a turn is in flight, so
  // a long answer shows incrementally. Cleared on finalize or when the real
  // entry lands in the next transcript_tail.
  const [streamingMsg, setStreamingMsg] = useState<{
    sessionId: SessionId;
    messageId: MessageId | null;
    text: string;
  } | null>(null);
  // The session whose transcript is open as a slide-over detail, and the
  // host-canonical read cursors keyed by `${hostId}:${sessionId}`.
  const [focusedSession, setFocusedSession] = useState<SessionSummary | null>(
    null,
  );
  const [readCursors, setReadCursors] = useState<
    Record<string, { lastReadMessageId: MessageId; readAtMs: number }>
  >({});
  // New-session flow: recent project dirs pushed by the active host, the modal
  // toggle, and the cwd of a start we're waiting to open via session_started.
  const [projectDirs, setProjectDirs] = useState<string[]>([]);
  const [showNewSession, setShowNewSession] = useState(false);
  const pendingStartCwdRef = useRef<string | null>(null);
  // Mirror of focusedSession for use inside the transport event callback (which
  // closes over a stale value otherwise), so we can drop transcript pushes that
  // don't belong to the conversation currently on screen.
  const focusedSessionRef = useRef<SessionSummary | null>(null);
  // Bumped when the host reports an action it couldn't fulfil, so the open
  // transcript can flip a stuck "sending…" bubble to "not delivered".
  const [sendFailSignal, setSendFailSignal] = useState(0);

  // Slide-over animation for the transcript detail.
  const screenWidth = Dimensions.get("window").width;
  const slideX = useRef(new Animated.Value(screenWidth)).current;
  useEffect(() => {
    if (focusedSession) {
      Animated.timing(slideX, {
        toValue: 0,
        duration: 240,
        useNativeDriver: true,
      }).start();
    }
  }, [focusedSession, slideX]);

  // Horizontal pager so the tab pages slide as you switch tabs.
  const tabIndex = Math.max(0, TABS.findIndex((t) => t.key === tab));
  const pagerX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(pagerX, {
      toValue: -tabIndex * screenWidth,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [tabIndex, screenWidth, pagerX]);

  useEffect(() => {
    let mounted = true;

    loadStoredHosts()
      .then((hosts) => {
        if (!mounted) return;
        setStoredHosts(hosts);
        // Re-establish the most-recent connectable host without re-pairing,
        // preferring LAN and falling back to the relay off-network.
        const host = firstConnectableHost(hosts);
        if (!host) return;
        const transport = connectWithFailover(host, {
          onFatalReject: () => {
            setActiveTransport((current) => {
              current?.close();
              return null;
            });
            setActiveHostId(null);
          },
        });
        if (transport) {
          setActiveTransport(transport);
          setActiveHostId(host.hostId);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingHosts(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Restore cached read cursors so the divider/landing point is available even
  // before the host's snapshot arrives.
  useEffect(() => {
    let mounted = true;
    loadReadCursors()
      .then((cursors) => {
        if (!mounted) return;
        setReadCursors((prev) => {
          const next = { ...prev };
          for (const c of cursors) {
            next[readCursorKey(c.hostId, c.sessionId)] = {
              lastReadMessageId: c.lastReadMessageId,
              readAtMs: c.readAtMs,
            };
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activeTransport) {
      setActiveStatus(null);
      setLiveSessions(null);
      setLiveTranscript(null);
      setApprovals(null);
      setProjectDirs([]);
      return;
    }
    setApprovals([]);
    const unsubStatus = activeTransport.subscribe((status) => {
      setActiveStatus(status);
    });
    const unsubEvents = activeTransport.subscribeEvents((event) => {
      if (event.type === "sessions") {
        setLiveSessions(event.sessions);
      } else if (event.type === "transcript_tail") {
        // Only render a transcript that belongs to the focused conversation.
        // During a new-session start, the host may briefly push the most-recent
        // session's tail (its focus fallback) before our focus_session lands —
        // ignoring mismatches stops a different conversation flashing up first.
        const focused = focusedSessionRef.current;
        if (focused && event.sessionId === focused.sessionId) {
          setLiveTranscript(event.entries);
        }
        // If a streamed reply has now landed as a real assistant entry, drop
        // the transient bubble so we don't render it twice.
        setStreamingMsg((prev) => {
          if (!prev) return prev;
          if (event.sessionId !== prev.sessionId) return prev;
          const reconciled = event.entries.some(
            (e) =>
              e.kind === "assistant_message" &&
              e.preview.trim().length > 0 &&
              prev.text.trim().startsWith(e.preview.trim().replace(/[.…]+$/, "")),
          );
          return reconciled ? null : prev;
        });
      } else if (event.type === "assistant_streaming") {
        if (event.finalized) {
          setStreamingMsg((prev) =>
            prev && prev.sessionId === event.sessionId ? null : prev,
          );
        } else {
          setStreamingMsg({
            sessionId: event.sessionId,
            messageId: event.messageId,
            text: event.text,
          });
        }
      } else if (event.type === "approval_requested") {
        setApprovals((prev) => {
          const list = prev ?? [];
          if (list.some((a) => a.id === event.approval.id)) return list;
          return [...list, event.approval];
        });
      } else if (event.type === "approval_resolved") {
        setApprovals((prev) =>
          (prev ?? []).filter((a) => a.id !== event.approvalId),
        );
      } else if (event.type === "read_cursor") {
        // The host advanced a cursor (this device or another). Mirror it and
        // cache it; the host is authoritative on order.
        const key = readCursorKey(event.hostId, event.sessionId);
        setReadCursors((prev) => {
          const current = prev[key];
          if (
            current?.lastReadMessageId === event.lastReadMessageId &&
            current?.readAtMs === event.readAtMs
          ) {
            return prev;
          }
          return {
            ...prev,
            [key]: {
              lastReadMessageId: event.lastReadMessageId,
              readAtMs: event.readAtMs,
            },
          };
        });
        void saveReadCursor({
          hostId: event.hostId,
          sessionId: event.sessionId,
          lastReadMessageId: event.lastReadMessageId,
          readAtMs: event.readAtMs,
        }).catch(() => {});
      } else if (event.type === "project_dirs") {
        setProjectDirs(event.dirs);
      } else if (event.type === "session_started") {
        // A session we asked to start has spawned — open it.
        if (
          pendingStartCwdRef.current &&
          event.cwd === pendingStartCwdRef.current
        ) {
          pendingStartCwdRef.current = null;
          openSession({
            hostId: event.hostId,
            sessionId: event.sessionId,
            title: dirName(event.cwd),
            projectPath: event.cwd,
            model: "",
            state: "running",
            updatedAt: new Date().toISOString(),
            pendingApprovalCount: 0,
            unreadCount: 0,
          });
        }
      } else if (event.type === "action_failed") {
        if (pendingStartCwdRef.current) pendingStartCwdRef.current = null;
        setSendFailSignal((n) => n + 1);
        const { title, message } = describeActionFailure(event.reason);
        Alert.alert(title, message);
      }
    });
    return () => {
      unsubStatus();
      unsubEvents();
    };
  }, [activeTransport]);

  useEffect(() => () => activeTransport?.close(), [activeTransport]);

  // Re-establish the connection when the app returns to the foreground. The OS
  // often drops the socket while backgrounded; the transports auto-retry on a
  // clean close, but a fresh connect here resets any backoff and recovers a
  // silently-killed socket immediately — so always-on machines stay reachable
  // without the user re-pairing or relaunching.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (activeStatus?.state === "connected") return;
      const host =
        (activeHostId && storedHosts.find((h) => h.hostId === activeHostId)) ||
        firstConnectableHost(storedHosts);
      if (!host) return;
      const transport = connectWithFailover(host, {
        onFatalReject: () => {
          setActiveTransport((current) => {
            current?.close();
            return null;
          });
          setActiveHostId(null);
        },
      });
      if (transport) {
        activeTransport?.close();
        setActiveTransport(transport);
        setActiveHostId(host.hostId);
      }
    });
    return () => sub.remove();
  }, [activeStatus?.state, activeHostId, storedHosts, activeTransport]);

  async function handleForgetHost(hostId: HostId) {
    const hosts = await forgetStoredHost(hostId);
    setStoredHosts(hosts);
    if (activeHostId === hostId) {
      activeTransport?.close();
      setActiveTransport(null);
      setActiveHostId(null);
    }
  }

  // Record that the user read up to `messageId` in a session: tell the host
  // (which persists and re-broadcasts), and update/cache locally right away.
  function markRead(sessionId: SessionId, messageId: MessageId) {
    if (!activeTransport || !activeHostId || !messageId) return;
    const readAtMs = Date.now();
    activeTransport.sendAction({
      type: "set_read_cursor",
      hostId: activeHostId,
      sessionId,
      lastReadMessageId: messageId,
      readAtMs,
    });
    const key = readCursorKey(activeHostId, sessionId);
    setReadCursors((prev) => ({
      ...prev,
      [key]: { lastReadMessageId: messageId, readAtMs },
    }));
    void saveReadCursor({
      hostId: activeHostId,
      sessionId,
      lastReadMessageId: messageId,
      readAtMs,
    }).catch(() => {});
  }

  // Open a session's transcript as a slide-over detail. The transcript lives on
  // the Chats tab, so opening one selects that tab.
  function openSession(session: SessionSummary) {
    if (!activeTransport) return;
    activeTransport.sendAction({
      type: "focus_session",
      hostId: session.hostId,
      sessionId: session.sessionId,
    });
    setLiveTranscript(null);
    // Set the ref synchronously so the very next transcript_tail (which can
    // arrive before this render commits) isn't filtered out as a mismatch.
    focusedSessionRef.current = session;
    slideX.setValue(screenWidth);
    setFocusedSession(session);
    setTab("sessions");
  }

  function closeTranscript() {
    Animated.timing(slideX, {
      toValue: screenWidth,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      focusedSessionRef.current = null;
      setFocusedSession(null);
    });
  }

  // Switch tabs with a light haptic. The open conversation is kept (the
  // transcript only shows on the Chats tab), so returning to Chats lands you
  // back in the conversation you were in.
  function selectTab(key: TabKey) {
    tapHaptic();
    setTab(key);
  }

  function sendToFocused(body: string, attachments?: RemoteAttachment[]) {
    if (!activeTransport || !focusedSession) return;
    activeTransport.sendAction({
      type: "send_message",
      hostId: focusedSession.hostId,
      sessionId: focusedSession.sessionId,
      body,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
  }

  function stopFocused() {
    if (!activeTransport || !focusedSession) return;
    activeTransport.sendAction({
      type: "stop_session",
      hostId: focusedSession.hostId,
      sessionId: focusedSession.sessionId,
    });
  }

  function handlePaired(
    hosts: StoredPairedHost[],
    host: StoredPairedHost,
    transport: Transport | null,
  ) {
    setStoredHosts(hosts);
    if (transport) {
      activeTransport?.close();
      setActiveTransport(transport);
      setActiveHostId(host.hostId);
    }
    setPairing(false);
    setTab("hosts");
  }

  // Make a paired host the active connection (used by the new-session machine
  // picker so you can start on any paired machine, not just the connected one).
  function switchToHost(host: StoredPairedHost) {
    if (host.hostId === activeHostId) return;
    const transport = connectWithFailover(host, {
      onFatalReject: () => {
        setActiveTransport((current) => {
          current?.close();
          return null;
        });
        setActiveHostId(null);
      },
    });
    if (transport) {
      activeTransport?.close();
      setActiveTransport(transport);
      setActiveHostId(host.hostId);
      setProjectDirs([]);
    }
  }

  // Start a session on the active host in `cwd`. The host spawns an idle
  // session and replies with session_started, which drops us straight into the
  // (empty) conversation — the user types the first message in the composer.
  function handleStartSession(cwd: string) {
    if (!activeTransport || !activeHostId) return;
    activeTransport.sendAction({
      type: "start_session",
      hostId: activeHostId,
      cwd,
      body: "",
    });
    pendingStartCwdRef.current = cwd;
    setShowNewSession(false);
  }

  const connected = activeStatus?.state === "connected" && Boolean(activeTransport);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Text style={styles.title}>Blackcrab Remote</Text>
        <Text style={styles.subtitle}>Control your desktop Claude Code sessions</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}
      >
        {TABS.map((entry) => {
          const active = entry.key === tab;
          return (
            <Text
              key={entry.key}
              accessibilityRole="button"
              onPress={() => selectTab(entry.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              {entry.label}
            </Text>
          );
        })}
      </ScrollView>
      <View style={styles.body}>
        {/* The three tab pages sit side by side and slide horizontally as the
            active tab changes. */}
        <Animated.View
          style={[
            styles.pager,
            { width: screenWidth * TABS.length, transform: [{ translateX: pagerX }] },
          ]}
        >
          <View style={{ width: screenWidth }}>
            <PairedHostsScreen
              loading={loadingHosts}
              storedHosts={storedHosts}
              onForgetHost={handleForgetHost}
              onPairHost={() => setPairing(true)}
              activeHostId={activeHostId}
              activeStatus={activeStatus}
            />
          </View>
          <View style={{ width: screenWidth }}>
            <SessionsScreen
              transport={activeTransport}
              status={activeStatus}
              sessions={liveSessions}
              onOpenSession={openSession}
              onNewSession={() => setShowNewSession(true)}
            />
          </View>
          <View style={{ width: screenWidth }}>
            <ApprovalScreen transport={activeTransport} approvals={approvals} />
          </View>
        </Animated.View>

        {/* Transcript detail for the open conversation. It belongs to the Chats
            tab: kept mounted (so the draft and scroll survive) but parked
            off-screen while another tab is active, so returning to Chats lands
            back in the same conversation. */}
        {focusedSession && (
          <Animated.View
            pointerEvents={tab === "sessions" ? "auto" : "none"}
            style={[
              styles.overlay,
              { transform: [{ translateX: tab === "sessions" ? slideX : screenWidth }] },
            ]}
          >
            <TranscriptScreen
              entries={liveTranscript}
              loading={liveTranscript === null}
              sessionId={focusedSession.sessionId}
              streamingText={
                streamingMsg &&
                streamingMsg.sessionId === focusedSession.sessionId
                  ? streamingMsg.text
                  : null
              }
              title={focusedSession.title}
              connected={connected}
              sessionState={
                liveSessions?.find(
                  (s) => s.sessionId === focusedSession.sessionId,
                )?.state ?? focusedSession.state
              }
              lastReadMessageId={
                activeHostId
                  ? readCursors[
                      readCursorKey(activeHostId, focusedSession.sessionId)
                    ]?.lastReadMessageId ?? null
                  : null
              }
              onBack={closeTranscript}
              onSend={sendToFocused}
              onStop={stopFocused}
              failSignal={sendFailSignal}
              onMarkRead={(messageId) =>
                markRead(focusedSession.sessionId, messageId)
              }
            />
          </Animated.View>
        )}
      </View>

      {/* Start a new session: pick machine + directory + first message. */}
      {showNewSession && (
        <View style={styles.pairOverlay}>
          <NewSessionScreen
            storedHosts={storedHosts}
            activeHostId={activeHostId}
            activeStatus={activeStatus}
            projectDirs={projectDirs}
            onSwitchHost={switchToHost}
            onStart={handleStartSession}
            onCancel={() => setShowNewSession(false)}
          />
        </View>
      )}

      {/* Pairing is an action launched from the Hosts screen, not a tab. */}
      {pairing && (
        <View style={styles.pairOverlay}>
          <View style={styles.pairHeader}>
            <Text
              accessibilityRole="button"
              onPress={() => setPairing(false)}
              style={styles.backLink}
            >
              ‹ Hosts
            </Text>
          </View>
          <PairHostScreen onPaired={handlePaired} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0b0d10",
  },
  header: {
    padding: 16,
  },
  title: {
    color: "#f4f6f8",
    fontSize: 22,
    fontWeight: "600",
  },
  subtitle: {
    color: "#9aa3ad",
    fontSize: 13,
    marginTop: 2,
  },
  tabs: {
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1f242b",
  },
  tabsContent: {
    flexDirection: "row",
    paddingHorizontal: 8,
  },
  tab: {
    color: "#9aa3ad",
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  tabActive: {
    color: "#f4f6f8",
    fontWeight: "600",
    borderBottomWidth: 2,
    borderBottomColor: "#e26a4b",
  },
  body: {
    flex: 1,
    overflow: "hidden",
  },
  pager: {
    flex: 1,
    flexDirection: "row",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0b0d10",
  },
  pairOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0b0d10",
  },
  pairHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  backLink: {
    color: "#e26a4b",
    fontSize: 15,
    fontWeight: "600",
    paddingVertical: 6,
  },
});
