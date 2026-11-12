import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const registries = [
  new URL('./patches/registry.json', import.meta.url),
  new URL('../managed-host/patches/registry.json', import.meta.url),
];

function functionsFromSource(source, names, globals = {}) {
  const parsed = ts.createSourceFile('links.ts', source, ts.ScriptTarget.Latest, true);
  const statements = parsed.statements.filter(statement => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(parsed)));
    }
    return ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text);
  });
  assert.equal(statements.length, names.length);
  const code = statements.map(statement => statement.getText(parsed).replace(/^export /, '')).join('\n');
  const javascript = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(`${javascript}\n({ ${names.join(', ')} });`, { URL, URLSearchParams, ...globals });
}

for (const registryUrl of registries) {
  test(`${registryUrl.pathname}: owned pairing links retain strict envelope validation`, async () => {
    const registry = JSON.parse(await fs.readFile(registryUrl, 'utf8'));
    const source = registry.filter(record => record.target === 'packages/shared/src/remote.ts').at(-1).replacements.at(-1).after;
    const { buildPairingAppLink, readPairingAppLink } = functionsFromSource(source, [
      'PAIRING_APP_LINK_PARAM', 'APP_LINK_PROTOCOL', 'buildPairingAppLink', 'readPairingAppLink',
    ]);
    const pairingUrl = 'https://host.example/pair#token=fixture';
    const link = buildPairingAppLink(pairingUrl);
    assert.equal(new URL(link).protocol, 'blackcrab:');
    assert.equal(readPairingAppLink(link), pairingUrl);
    assert.equal(readPairingAppLink(link.replace('blackcrab:', 'blackcrab-remote:')), pairingUrl);
    assert.equal(readPairingAppLink(link.replace('blackcrab:', 'blackcrab-dev:')), pairingUrl);
    for (const invalid of [
      link.replace('blackcrab:', 't3code:'),
      link.replace('//pair?', '//user:password@pair?'),
      link.replace('//pair?', '//pair/extra?'),
      `${link}&pairingUrl=second`, `${link}&extra=value`, `${link}#fragment`,
      'blackcrab://pair?pairingUrl=',
    ]) assert.equal(readPairingAppLink(invalid), null, invalid);
  });

  test(`${registryUrl.pathname}: auth returns retain explicit owned hosted configuration`, async () => {
    const registry = JSON.parse(await fs.readFile(registryUrl, 'utf8'));
    const source = registry.filter(record => record.target === 'packages/shared/src/providerAuthReturnUrl.ts').at(-1).replacements.at(-1).after;
    for (const origin of ['', 'https://app.blackcrab.example']) {
      const { providerAuthReturnUrl } = functionsFromSource(source, ['providerAuthReturnUrl'], {
        DEFAULT_HOSTED_APP_URL: origin,
        isLoopbackHost: hostname => hostname === '127.0.0.1',
      });
      assert.equal(providerAuthReturnUrl('blackcrab://app/settings'), 'blackcrab://app/settings');
      assert.equal(providerAuthReturnUrl('http://127.0.0.1:1234/settings'), 'http://127.0.0.1:1234/settings');
      assert.equal(providerAuthReturnUrl('https://app.blackcrab.example/settings'), origin ? `${origin}/settings` : undefined);
      assert.equal(providerAuthReturnUrl('https://app.t3.codes/settings'), undefined);
      assert.equal(providerAuthReturnUrl('https://app.blackcrab.example.attacker.example/settings'), undefined);
    }
  });
}
