/** Inline the same build constant used by the managed desktop/web/server clients. */
module.exports = function ({ types }) {
  return {
    name: 'blackcrab-owned-hosted-origin',
    visitor: {
      ReferencedIdentifier(path, state) {
        if (path.node.name === '__BLACKCRAB_HOSTED_APP_URL__' && !path.scope.hasBinding(path.node.name)) {
          path.replaceWith(types.stringLiteral(state.opts.hostedAppUrl));
        }
      },
    },
  };
};
