import { ClerkProvider, getClerkInstance } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import type { ReactNode } from "react";
import { cloudAccountService } from "./cloudAccountService";
import { resolveCloudPublicConfig } from "./publicConfig";

const cloudConfig = resolveCloudPublicConfig();
const publishableKey = cloudConfig.relay.url && cloudConfig.clerk.jwtTemplate
  ? cloudConfig.clerk.publishableKey : null;

if (publishableKey) {
  // Use the original process-lifetime account, relay and notification services.
  cloudAccountService.attach(getClerkInstance({ publishableKey }));
}
// An unconfigured build leaves stored accounts/catalogs untouched.
export function CloudAuthProvider({ children }: { readonly children: ReactNode }) {
  return publishableKey
    ? <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>{children}</ClerkProvider>
    : children;
}
