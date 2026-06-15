import { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
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

type TabKey = "hosts" | "pair" | "sessions" | "transcript" | "approval";

const TABS: { key: TabKey; label: string }[] = [
  { key: "hosts", label: "Hosts" },
  { key: "pair", label: "Pair" },
  { key: "sessions", label: "Sessions" },
  { key: "transcript", label: "Transcript" },
  { key: "approval", label: "Attention" },
];

export default function App() {
  const [tab, setTab] = useState<TabKey>("hosts");
  const [storedHosts, setStoredHosts] = useState<StoredPairedHost[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(true);
  const [activeTransport, setActiveTransport] = useState<Transport | null>(null);
  const [activeStatus, setActiveStatus] = useState<TransportStatus | null>(null);
  const [activeHostId, setActiveHostId] = useState<HostId | null>(null);
  const [liveSessions, setLiveSessions] = useState<SessionSummary[] | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<TranscriptEntry[] | null>(
    null,
  );
  const [approvals, setApprovals] = useState<ApprovalRequest[] | null>(null);
  // Session whose transcript is being viewed, and the host-canonical read
  // cursors keyed by `${hostId}:${sessionId}`. The cursor drives the
  // "new messages" divider and where the transcript lands on open.
  const [focusedSessionId, setFocusedSessionId] = useState<SessionId | null>(
    null,
  );
  const [readCursors, setReadCursors] = useState<
    Record<string, { lastReadMessageId: MessageId; readAtMs: number }>
  >({});

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
    setTab("hosts");
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Text style={styles.title}>Blackcrab Remote</Text>
        <Text style={styles.subtitle}>Experimental scaffold · local demo</Text>
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
            onPairHost={() => setTab("pair")}
            activeHostId={activeHostId}
            activeStatus={activeStatus}
          />
        )}
        {tab === "pair" && <PairHostScreen onPaired={handlePaired} />}
        {tab === "sessions" && (
          <SessionsScreen
            transport={activeTransport}
            status={activeStatus}
            sessions={liveSessions}
            onViewTranscript={(session) => {
              if (!activeTransport) return;
              activeTransport.sendAction({
                type: "focus_session",
                hostId: session.hostId,
                sessionId: session.sessionId,
              });
              // Clear stale entries; the host pushes the focused tail at once.
              setLiveTranscript(null);
              setFocusedSessionId(session.sessionId);
              setTab("transcript");
            }}
          />
        )}
        {tab === "transcript" && (
          <TranscriptScreen
            entries={liveTranscript}
            sessionId={focusedSessionId}
            lastReadMessageId={
              focusedSessionId && activeHostId
                ? readCursors[readCursorKey(activeHostId, focusedSessionId)]
                    ?.lastReadMessageId ?? null
                : null
            }
            onMarkRead={(messageId) => {
              if (focusedSessionId) markRead(focusedSessionId, messageId);
            }}
          />
        )}
        {tab === "approval" && (
          <ApprovalScreen transport={activeTransport} approvals={approvals} />
        )}
      </View>
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
});
