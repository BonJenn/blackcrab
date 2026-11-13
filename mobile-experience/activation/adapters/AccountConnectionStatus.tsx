import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { EmptyState } from "../../components/ui/EmptyState";

export const ACCOUNT_CONNECTION_WAIT_MS = 15_000;

// A failed Clerk initialization never reaches isLoaded. Keep the account entry
// accessible and bound its loading presentation without changing session storage.
export function useAccountConnectionStatus(isLoaded: boolean) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (isLoaded) {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), ACCOUNT_CONNECTION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [isLoaded]);
  return isLoaded ? "ready" : timedOut ? "unavailable" : "loading";
}

export function AccountConnectionPending({
  status,
  onBack,
}: {
  readonly status: "loading" | "unavailable";
  readonly onBack: () => void;
}) {
  return (
    <View className="flex-1 justify-center p-6" accessibilityLiveRegion="polite">
      {status === "loading" ? <ActivityIndicator accessibilityLabel="Connecting to Blackcrab Account" /> : null}
      <EmptyState
        variant="plain"
        title={status === "loading" ? "Connecting to Blackcrab Account" : "Blackcrab Account is unavailable"}
        detail={status === "loading"
          ? "Waiting for the sign-in service. You can go back and use your saved environments."
          : "The sign-in service could not finish connecting. Check your internet connection, then close and reopen Blackcrab to retry. Your saved environments and drafts are kept."}
        actionLabel="Go back"
        onAction={onBack}
      />
    </View>
  );
}
