// Every React importer, including hoisted libraries, uses the mobile renderer's React.
function createMobileResolveRequest(appRequire) {
  return (context, name, platform) => {
    if (name === 'react' || name.startsWith('react/') || name === 'react-dom' || name.startsWith('react-dom/') || name === 'react-native' || name === 'effect' || name.startsWith('effect/') || name === '@effect/atom-react' || name.startsWith('@effect/atom-react/')) {
      return { type: 'sourceFile', filePath: appRequire.resolve(name) };
    }
    // Native subpaths need Metro's platform suffix resolution, which Node does not provide.
    return context.resolveRequest(context, name, platform);
  };
}
module.exports = { createMobileResolveRequest };
