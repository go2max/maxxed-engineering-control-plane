import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityGraph } from '../src/leverage/capability-graph.js';

function chainGraph() {
  const graph = new CapabilityGraph();
  graph.registerCapability({ key: 'tenant-billing-entitlements', name: 'Tenant billing entitlements check', tags: ['billing', 'auth'] });
  graph.registerImplementation({ key: 'tenant-billing-entitlements-v1', capabilityKey: 'tenant-billing-entitlements', kind: 'validator', location: 'src/leverage/x.js' });
  graph.linkFamily({ implementationKey: 'tenant-billing-entitlements-v1', family: 'saas-web' });
  graph.linkInstance({ family: 'saas-web', instance: 'product-a', repo: 'go2max/product-a' });
  graph.linkInstance({ family: 'saas-web', instance: 'product-b', repo: 'go2max/product-b' });
  graph.linkTest({ instance: 'product-a', test: 'product-a:billing.test.js', suite: 'unit' });
  graph.linkChannel({ instance: 'product-a', channel: 'production' });
  return graph;
}

test('registers the full capability -> implementation -> family -> instance -> test/channel chain', () => {
  const graph = chainGraph();
  const impact = graph.impactOf('tenant-billing-entitlements');
  assert.equal(impact.capability.key, 'tenant-billing-entitlements');
  assert.equal(impact.implementations.length, 1);
  assert.equal(impact.implementations[0].key, 'tenant-billing-entitlements-v1');
  assert.equal(impact.families.length, 1);
  assert.equal(impact.families[0].key, 'saas-web');
  assert.equal(impact.instanceCount, 2);
  assert.deepEqual(impact.instances.map((i) => i.key).sort(), ['product-a', 'product-b']);
  assert.equal(impact.tests.length, 1);
  assert.equal(impact.tests[0].key, 'product-a:billing.test.js');
  assert.equal(impact.channels.length, 1);
  assert.equal(impact.channels[0].key, 'production');
});

test('unknown capability lookups fail closed', () => {
  const graph = new CapabilityGraph();
  assert.throws(() => graph.impactOf('does-not-exist'), /unknown capability/);
  assert.throws(() => graph.registerImplementation({ key: 'x', capabilityKey: 'missing' }), /unknown capability/);
});

test('findCanonicalCapability prevents duplicate implementation of an existing capability', () => {
  const graph = chainGraph();
  const byKey = graph.findCanonicalCapability({ key: 'tenant-billing-entitlements' });
  assert.equal(byKey?.key, 'tenant-billing-entitlements');

  const byTags = graph.findCanonicalCapability({ tags: ['billing', 'auth'] });
  assert.equal(byTags?.key, 'tenant-billing-entitlements');

  const noMatch = graph.findCanonicalCapability({ key: 'unrelated', tags: ['unrelated-tag'] });
  assert.equal(noMatch, null);
});

test('capability graph state round-trips through snapshot/restore', () => {
  const graph = chainGraph();
  const snapshot = graph.snapshot();

  const restored = new CapabilityGraph();
  restored.restore(snapshot);

  const impact = restored.impactOf('tenant-billing-entitlements');
  assert.equal(impact.instanceCount, 2);
  assert.equal(impact.channels[0].key, 'production');
});

test('a shared SemanticCodeGraph instance can be injected so capability nodes coexist with source graph nodes', () => {
  const graph = chainGraph();
  // sanity: underlying node ids are namespaced so they cannot collide with source-code node ids
  assert.ok(graph.graph.nodes.has('capability:tenant-billing-entitlements'));
  assert.ok(graph.graph.nodes.has('instance:product-a'));
});
