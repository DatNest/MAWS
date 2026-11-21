const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

assert.equal(manifest.auto_update, true, 'SillyTavern must be allowed to update MAWS');
assert.match(index, /engine\.js\?native=\$\{ENGINE_BUILD\}-\$\{token\}-\$\{Date\.now\(\)\}/,
  'A reload must not re-import a cached engine from the previous extension version');

// Test the real toggle/read/save functions from index.js without starting the UI.
const header = index.slice(0, index.indexOf('function panelHost()'));
assert(header.includes('async function saveEnabledForChat'), 'Persistence API is missing');
const sandbox = { SillyTavern: { getContext: () => null }, console };
vm.runInNewContext(header + '\nthis.api = { currentScope, isEnabled, updateToggle, saveEnabledForChat };', sandbox);
const api = sandbox.api;
const dataKey = 'maws_engine_universal_v1';
let storedA = null, storedB = null;
function chat(id, metadata, save) {
  return {
    characterId: 4, groupId: null, chat: [], chatMetadata: metadata,
    getCurrentChatId: () => id,
    async saveMetadata() { save(JSON.parse(JSON.stringify(this.chatMetadata))); },
  };
}
(async () => {
  const a = chat('chat-A', { [dataKey]: {
    version: 43, enabled: false,
    theme: { panel: '#443344' },
    promptOverrides: { 'scene.core': 'My own roleplay rules' },
  } }, data => { storedA = data; });
  const b = chat('chat-B', {}, data => { storedB = data; });
  assert.equal(api.isEnabled(a), false);
  assert.equal(api.isEnabled(b), false);
  assert.equal(await api.saveEnabledForChat(a, true), true);
  assert.equal(storedA[dataKey].enabled, true);
  assert.equal(storedA[dataKey].theme.panel, '#443344');
  assert.equal(storedA[dataKey].promptOverrides['scene.core'], 'My own roleplay rules');
  assert.equal(api.isEnabled(chat('chat-A', storedA, () => {})), true,
    'A reloaded chat must restore its enabled state');
  assert.equal(api.isEnabled(b), false, 'Enabling another chat must not enable this one');
  assert.equal(await api.saveEnabledForChat(b, false), true);
  assert.equal(storedB[dataKey].enabled, false);
  assert.equal(await api.saveEnabledForChat(a, false), true);
  assert.equal(storedA[dataKey].enabled, false);
  const legacy = chat('legacy', {
    maws_engine_avatar_v1: { version: 42, theme: { panel: '#778899' }, ledger: [{ kind: 'manual' }] },
  }, () => {});
  await api.saveEnabledForChat(legacy, true);
  assert.equal(legacy.chatMetadata[dataKey].theme.panel, '#778899');
  assert.equal(legacy.chatMetadata[dataKey].ledger.length, 1);
  const broken = chat('broken', {}, () => {});
  delete broken.saveMetadata;
  await assert.rejects(api.saveEnabledForChat(broken, true), /saveMetadata/);
  console.log('PASS: manifest auto-update, fresh engine import, per-chat toggle persistence, reload, legacy migration, save API failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
