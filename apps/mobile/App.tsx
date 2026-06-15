import { useEffect, useRef, useState } from "react";
import {
  Animated,
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

/** Last path segment, used as a provisional title for a brand-new session. */
function dirName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
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
        setLiveTranscript(event.entries);
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
      }
    });
    return () => {
      unsubStatus();
      unsubEvents();
    };
  }, [activeTransport]);

  useEffect(() => () => activeTransport?.close(), [activeTransport]);

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

  // Open a session's transcript as a slide-over detail.
  function openSession(session: SessionSummary) {
    if (!activeTransport) return;
    activeTransport.sendAction({
      type: "focus_session",
      hostId: session.hostId,
      sessionId: session.sessionId,
    });
    setLiveTranscript(null);
    slideX.setValue(screenWidth);
    setFocusedSession(session);
  }

  function closeTranscript() {
    Animated.timing(slideX, {
      toValue: screenWidth,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setFocusedSession(null));
  }

  function sendToFocused(body: string) {
    if (!activeTransport || !focusedSession) return;
    activeTransport.sendAction({
      type: "send_message",
      hostId: focusedSession.hostId,
      sessionId: focusedSession.sessionId,
      body,
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

  // Start a session on the active host in `cwd`, sending `body` as the first
  // message. The host spawns it and replies with session_started, which opens
  // the conversation here.
  function handleStartSession(cwd: string, body: string) {
    if (!activeTransport || !activeHostId) return;
    activeTransport.sendAction({
      type: "start_session",
      hostId: activeHostId,
      cwd,
      body,
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
              onPress={() => setTab(entry.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              {entry.label}
            </Text>
          );
        })}
      </ScrollView>
      <View style={styles.body}>
        {tab === "hosts" && (
          <PairedHostsScreen
            loading={loadingHosts}
            storedHosts={storedHosts}
            onForgetHost={handleForgetHost}
            onPairHost={() => setPairing(true)}
            activeHostId={activeHostId}
            activeStatus={activeStatus}
          />
        )}
        {tab === "sessions" && (
          <SessionsScreen
            transport={activeTransport}
            status={activeStatus}
            sessions={liveSessions}
            onOpenSession={openSession}
            onNewSession={() => setShowNewSession(true)}
          />
        )}
        {tab === "approval" && (
          <ApprovalScreen transport={activeTransport} approvals={approvals} />
        )}

        {/* Transcript detail slides over the active tab when a session opens. */}
        {focusedSession && (
          <Animated.View
            style={[
              styles.overlay,
              { transform: [{ translateX: slideX }] },
            ]}
          >
            <TranscriptScreen
              entries={liveTranscript}
              sessionId={focusedSession.sessionId}
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
