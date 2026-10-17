// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, DAYS_BACK, RESOLUTION } from '../src/config.js';
import { ACTIONS } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, />=5\.2\.0/, 'publishEnergyConsumption needs Gladys 5.2');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-fluvius:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.deepEqual(manifest.categories, ['energy']);
  for (const lang of ['en', 'fr', 'nl']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('every text is in English, French and Dutch', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr', 'nl']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields.password.type, 'secret');
  // Never claim the secret is encrypted: Gladys stores it as is.
  for (const text of Object.values(fields.password.description)) {
    assert.doesNotMatch(text, /(?<!not |non |niet )(encrypted|chiffré|versleuteld)/i);
  }
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, `${key} default`);
  }
  assert.deepEqual(
    fields.resolution.options.map((o) => o.value),
    Object.values(RESOLUTION),
  );
  assert.equal(fields.days_back.min, DAYS_BACK.min);
  assert.equal(fields.days_back.max, DAYS_BACK.max);
  for (const key of ['email', 'electricity_ean', 'electricity_serial', 'gas_ean', 'gas_serial']) {
    assert.ok(fields[key], key);
  }
  for (const link of fields.intro.links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the actions of the manifest are the handlers of the code', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  assert.ok(index.includes('onDeviceCreated'));
});
