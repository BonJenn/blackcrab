// Blackcrab-owned. In-app deletion of the signed-in Blackcrab account.
//
// Order matters: the relay only accepts requests from a signed-in account, so the computers
// are unlinked and this phone is unregistered first, and the account itself is deleted last.
// Relay cleanup is best effort. A failure there must not leave someone unable to delete their
// account, and nothing can sign in to a deleted account's leftovers.
import { useAuth, useUser } from "@clerk/expo";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import * as Dialog from "../../components/ui/Dialog";
import { runtime } from "../../lib/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { unregisterAgentAwarenessDeviceForCurrentUser } from "../agent-awareness/remoteRegistration";
import {
  deregisterManagedRelayEnvironmentCommand,
  useManagedRelayEnvironments,
} from "./managedRelayState";
import { resolveRelayClerkTokenOptions } from "./publicConfig";

const CONFIRM_TITLE = "Delete your Blackcrab account?";
const CONFIRM_MESSAGE =
  "This permanently deletes your Blackcrab account, unlinks your computers from Blackcrab Connect and signs you out on every device. It cannot be undone.\n\nProjects, threads and files on your own computers are not touched.";

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const clerk = (error as { errors?: ReadonlyArray<{ longMessage?: string; message?: string }> })
      .errors?.[0];
    if (clerk?.longMessage) return clerk.longMessage;
    if (clerk?.message) return clerk.message;
    if (error instanceof Error && error.message) return error.message;
  }
  return "The account could not be deleted. Check your connection and try again.";
}

export function useAccountDeletion(): {
  readonly available: boolean;
  readonly deleting: boolean;
  readonly requestDeletion: () => void;
} {
  const { getToken, isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  const environments = useManagedRelayEnvironments();
  const deregisterEnvironment = useAtomCommand(deregisterManagedRelayEnvironmentCommand, {
    reportFailure: false,
    reportDefect: false,
  });
  const [deleting, setDeleting] = useState(false);
  const pendingRef = useRef(false);

  const deleteAccount = async () => {
    if (pendingRef.current || !user) return;
    pendingRef.current = true;
    setDeleting(true);
    try {
      const accountId = environments.accountId;
      if (accountId) {
        for (const environment of environments.data ?? []) {
          try {
            await deregisterEnvironment({ accountId, environmentId: environment.environmentId });
          } catch {
            // Best effort; see the note at the top of this file.
          }
        }
      }
      try {
        await runtime.runPromiseExit(
          unregisterAgentAwarenessDeviceForCurrentUser(() =>
            getToken(resolveRelayClerkTokenOptions()),
          ),
        );
      } catch {
        // Best effort.
      }
      await user.delete();
      Dialog.alert(
        "Account deleted",
        "Your Blackcrab account has been deleted and you are signed out.",
      );
    } catch (error) {
      Dialog.alert("Could not delete account", errorMessage(error));
    } finally {
      pendingRef.current = false;
      setDeleting(false);
    }
  };

  return {
    available: isLoaded && isSignedIn === true && Boolean(user),
    deleting,
    requestDeletion: () => {
      if (pendingRef.current) return;
      Dialog.confirm({
        title: CONFIRM_TITLE,
        message: CONFIRM_MESSAGE,
        confirmText: "Delete account",
        destructive: true,
        onConfirm: () => void deleteAccount(),
      });
    },
  };
}

/** The deletion entry on the Blackcrab Connect page of the account screen. */
export function DeleteAccountSection() {
  const deletion = useAccountDeletion();
  if (!deletion.available) return null;
  return (
    <View>
      <Text className="min-h-4 border-b border-clerk-border px-6 pt-8 pb-4 text-xs font-medium tracking-[0.3px] text-clerk-foreground-muted uppercase">
        Account
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete account"
        accessibilityHint="Permanently deletes your Blackcrab account"
        disabled={deletion.deleting}
        onPress={deletion.requestDeletion}
        className="flex-row items-center gap-3 border-b border-clerk-border px-6 py-4 active:opacity-60 disabled:opacity-50"
      >
        <Text className="flex-1 text-base font-semibold text-red-600">Delete account</Text>
        {deletion.deleting ? (
          <AppActivityIndicator colorClassName={"accent-clerk-foreground-muted"} size="small" />
        ) : null}
      </Pressable>
      <Text className="px-6 pt-3 text-xs leading-normal text-clerk-foreground-muted">
        Permanently deletes your Blackcrab account and unlinks your computers. Data on your own
        computers is not touched.
      </Text>
    </View>
  );
}
