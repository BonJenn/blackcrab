import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Alert,
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
  RemoteAttachment,
  SessionId,
  SessionSummary,
  TranscriptEntry,
} from "@blackcrab/remote-protocol";

import { MobileQueueClient } from "./src/queue/client";
import { queueStorage, queueId } from "./src/queue/storage";

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
import { subscribeToHost } from "./src/transport/activeHost";
import { MobileHostConnection } from "./src/transport/hostConnection";

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
  const [queueClient] = useState(() => new MobileQueueClient(queueStorage,queueId));
  const [tab, setTab] = useState<TabKey>("hosts");
  const [storedHosts, setStoredHosts] = useState<StoredPairedHost[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [pairing, setPairing] = useState(false);
  const [hostConnection] = useState(() => new MobileHostConnection((host, onFatalReject) => connectWithFailover(host, { onFatalReject })));
  const connection = useSyncExternalStore(hostConnection.subscribe, hostConnection.state);
  const { transport: activeTransport, hostId: activeHostId } = connection;
  const [activeStatus, setActiveStatus] = useState<TransportStatus | null>(null);
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
  const focusedSessionRef = useRef(focusedSession);
  focusedSessionRef.current = focusedSession;
  const [readCursors, setReadCursors] = useState<
    Record<string, { lastReadMessageId: MessageId; readAtMs: number }>
  >({});
  // New-session flow: recent project dirs pushed by the active host, the modal
  // toggle, and the cwd of a start we're waiting to open via session_started.
  const [projectDirs, setProjectDirs] = useState<string[]>([]);
  const [showNewSession, setShowNewSession] = useState(false);
  const pendingStartCwdRef = useRef<string | null>(null);
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
        hostConnection.connect(host);
      })
      .finally(() => {
        if (mounted) {
          setLoadingHosts(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [hostConnection]);

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
    if (!activeTransport || !activeHostId) {
      setActiveStatus(null);
      setLiveSessions(null);
      setLiveTranscript(null);
      setApprovals(null);
      setProjectDirs([]);
      return;
    }
    setApprovals([]);
    setLiveSessions(null);
    setLiveTranscript(null);
    setProjectDirs([]);
    pendingStartCwdRef.current = null;
    return subscribeToHost(activeTransport, activeHostId, (status) => {
      setActiveStatus(status);
      if (status.state !== "connected") setApprovals(null);
    }, (event) => {
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
      } else if (event.type === "action_failed") {
        if (pendingStartCwdRef.current) pendingStartCwdRef.current = null;
        setSendFailSignal((n) => n + 1);
        Alert.alert("Couldn’t send", event.reason);
      }
    }, () => focusedSessionRef.current?.hostId === activeHostId ? focusedSessionRef.current.sessionId : null);
  }, [activeTransport, activeHostId]);

  useEffect(() => {
    setFocusedSession(current=>current && current.hostId!==activeHostId ? null : current);
    setApprovals(null);
    setProjectDirs([]);
    pendingStartCwdRef.current = null;
    setLiveTranscript(null);
    setLiveSessions(null);
  },[activeHostId]);
  useEffect(() => () => hostConnection.dispose(), [hostConnection]);
  useEffect(() => { queueClient.bind(activeTransport,activeHostId); return () => queueClient.bind(null,null); }, [queueClient,activeTransport,activeHostId]);

  async function handleForgetHost(hostId: HostId) {
    const hosts = await forgetStoredHost(hostId);
    setStoredHosts(hosts);
    hostConnection.forget(hostId);
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
    if (!activeTransport || session.hostId!==activeHostId) return;
    setLiveTranscript(null);
    focusedSessionRef.current = session;
    slideX.setValue(screenWidth);
    setFocusedSession(session);
    activeTransport.sendAction({
      type: "focus_session",
      hostId: session.hostId,
      sessionId: session.sessionId,
    });
  }

  function closeTranscript() {
    const closing = focusedSessionRef.current;
    Animated.timing(slideX, {
      toValue: screenWidth,
      duration: 200,
      useNativeDriver: true,
    }).start(() => { if (focusedSessionRef.current === closing) { focusedSessionRef.current = null; setFocusedSession(null); } });
  }

  function sendToFocused(body: string, attachments?: RemoteAttachment[]) {
    if (!activeTransport || !focusedSession || focusedSession.hostId!==activeHostId) return;
    activeTransport.sendAction({
      type: "send_message",
      hostId: focusedSession.hostId,
      sessionId: focusedSession.sessionId,
      body,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
  }

  function stopFocused() {
    if (!activeTransport || !focusedSession || focusedSession.hostId!==activeHostId) return;
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
      hostConnection.adopt(host.hostId, transport);
    }
    setPairing(false);
    setTab("hosts");
  }

  // Reuse one owner for startup, pairing, host selection and the new-session picker.
  function switchToHost(host: StoredPairedHost) {
    hostConnection.connect(host);
  }

  function selectHost(hostId: HostId, reconnect = false) {
    const host = storedHosts.find(value => value.hostId === hostId);
    if (host && hostConnection.connect(host, reconnect)) setTab("sessions");
  }

  // Start a session on the active host in `cwd`, sending `body` as the first
  // message. The host spawns it and replies with session_started, which opens
  // the conversation here.
  function handleStartSession(cwd: string, body: string) {
    if (!activeTransport || !activeHostId || activeTransport.status().state !== "connected" || (activeTransport.status().hostId && activeTransport.status().hostId !== activeHostId)) {
      Alert.alert("Host not connected", "Wait for the selected host to connect before starting an agent."); return;
    }
    pendingStartCwdRef.current = cwd;
    const accepted = activeTransport.sendAction({ type: "start_session", hostId: activeHostId, cwd, body });
    if (!accepted) { pendingStartCwdRef.current = null; Alert.alert("Not sent", "The host is no longer connected. Your new-session form is still open."); return; }
    setShowNewSession(false);
  }

  const connected = activeStatus?.state === "connected" && activeTransport?.status().state === "connected" && (!activeStatus.hostId || activeStatus.hostId === activeHostId);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Text style={styles.title}>Blackcrab Remote</Text>
        <Text style={styles.subtitle}>Control your desktop Claude Code sessions</Text>
        <Text style={styles.subtitle}>{activeHostId ? `${storedHosts.find(host => host.hostId === activeHostId)?.displayName ?? "Selected host"} · ${connected ? "connected" : "not connected"}` : "No host selected"}</Text>
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
            connectionError={connection.error}
            onConnectHost={selectHost}
            onDisconnectHost={() => hostConnection.disconnect()}
            onViewSessions={() => setTab("sessions")}
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
          <ApprovalScreen transport={activeTransport} status={activeStatus} hostId={activeHostId} approvals={approvals} />
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
              key={JSON.stringify([focusedSession.hostId,focusedSession.sessionId])}
              queueClient={queueClient}
              hostId={focusedSession.hostId}
              entries={liveTranscript?.filter(entry => entry.sessionId===focusedSession.sessionId) ?? null}
              sessionId={focusedSession.sessionId}
              title={focusedSession.title}
              connected={connected && focusedSession.hostId===activeHostId}
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
