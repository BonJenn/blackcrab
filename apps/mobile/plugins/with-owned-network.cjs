// Owned self-hosted network policy, adapted from pinned mobile network capability.
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const xml = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;
module.exports = config => withDangerousMod(withAndroidManifest(config, cfg => {
  const application = cfg.modResults.manifest.application?.[0];
  if (!application) throw new Error('Android application is required for the owned network policy.');
  application.$ ??= {};
  application.$['android:usesCleartextTraffic'] = 'true';
  application.$['android:networkSecurityConfig'] = '@xml/blackcrab_network_security';
  return cfg;
}), ['android', cfg => {
  const target = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'blackcrab_network_security.xml'), xml);
  return cfg;
}]);
