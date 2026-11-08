  const canOpenProjectFromFileManager =
    isBrowsing &&
    browseEnvironmentId !== null &&
    (browseEnvironmentId === primaryEnvironmentId ||
      (browseEnvironmentIsDesktopLocal && browseDesktopInstanceId !== null)) &&
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined;
