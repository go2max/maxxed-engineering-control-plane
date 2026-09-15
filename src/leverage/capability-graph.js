// Capability graph: capability -> shared implementation -> product family -> product instances
// -> tests -> release channels.
//
// reuse: internal -- this is a thin, typed wrapper around the existing generic
// `SemanticCodeGraph` (src/leverage/semantic-code-graph.js), which already provides
// node/edge storage, dependency-slice traversal, and snapshot/restore. Rather than building a
// second graph engine, this module reuses that engine unchanged and layers capability-specific
// node kinds, edge types, and a duplicate-capability guard on top of it. It also composes with
// the existing `ProductFamilyPlanner` (src/leverage/product-family-planner.js) -- a capability's
// `family` link points at a family name already registered there, so family-level
// feature/policy baselines stay the single source of truth for "what a family requires";
// this module only adds the capability-to-implementation-to-instance layer that was missing.
//
// Issue #102 ("Capability graph + automatic abstraction mining + portfolio fan-out") asks for:
//   capability -> shared implementation -> product family -> product instances -> tests ->
//   release channels
// This module implements exactly that chain as typed node kinds/edges over SemanticCodeGraph.

import { SemanticCodeGraph } from './semantic-code-graph.js';

export const CAPABILITY_NODE_KINDS = Object.freeze([
  'capability',
  'implementation',
  'family',
  'instance',
  'test',
  'channel',
]);

export const CAPABILITY_EDGE_TYPES = Object.freeze({
  IMPLEMENTS: 'implements', // implementation -> capability
  BELONGS_TO_FAMILY: 'belongs-to-family', // implementation -> family
  INSTANTIATED_AS: 'instantiated-as', // family -> instance
  VERIFIED_BY: 'verified-by', // instance -> test
  RELEASES_TO: 'releases-to', // instance -> channel
});

function capabilityNodeId(key) { return `capability:${key}`; }
function implementationNodeId(key) { return `implementation:${key}`; }
function familyNodeId(key) { return `family:${key}`; }
function instanceNodeId(key) { return `instance:${key}`; }
function testNodeId(key) { return `test:${key}`; }
function channelNodeId(key) { return `channel:${key}`; }

/**
 * Typed capability graph. Wraps a `SemanticCodeGraph` instance (created internally, or injected
 * for sharing/testing) and exposes capability-domain-specific registration/query methods rather
 * than requiring callers to hand-build generic node/edge rows.
 */
export class CapabilityGraph {
  constructor({ graph } = {}) {
    this.graph = graph ?? new SemanticCodeGraph();
  }

  /**
   * Register (or update) a capability node. A capability is an abstract, reusable unit of
   * behavior (e.g. "tenant-scoped billing entitlements check") that may have zero or more
   * concrete implementations.
   */
  registerCapability({ key, name, description = '', tags = [] } = {}) {
    if (!key) throw new Error('capability key is required');
    return this.graph.upsertNode({ id: capabilityNodeId(key), kind: 'capability', key, name: name ?? key, description, tags: [...new Set(tags)] });
  }

  /**
   * Find a capability already registered under this key, or by matching tag set, so callers can
   * check "does a canonical capability already exist?" before writing a new implementation
   * (issue #102's "prevent duplicate implementation when a canonical capability already exists").
   */
  findCanonicalCapability({ key, tags = [] } = {}) {
    if (key && this.graph.nodes.has(capabilityNodeId(key))) return structuredClone(this.graph.nodes.get(capabilityNodeId(key)));
    if (!tags.length) return null;
    const wanted = new Set(tags);
    for (const node of this.graph.nodes.values()) {
      if (node.kind !== 'capability') continue;
      const nodeTags = new Set(node.tags ?? []);
      if (nodeTags.size && [...wanted].every((tag) => nodeTags.has(tag))) return structuredClone(node);
    }
    return null;
  }

  /**
   * Register a shared implementation of a capability (the "solve once" artifact -- an SDK
   * function, transform, validator, schema, or policy rule) and link it to that capability.
   */
  registerImplementation({ key, capabilityKey, kind = 'function', location = null, transformId = null, metadata = {} } = {}) {
    if (!key) throw new Error('implementation key is required');
    if (!capabilityKey) throw new Error('capabilityKey is required');
    if (!this.graph.nodes.has(capabilityNodeId(capabilityKey))) throw new Error(`unknown capability: ${capabilityKey}`);
    const node = this.graph.upsertNode({ id: implementationNodeId(key), kind: 'implementation', key, implKind: kind, location, transformId, metadata: structuredClone(metadata) });
    this.graph.addEdge({ from: implementationNodeId(key), to: capabilityNodeId(capabilityKey), type: CAPABILITY_EDGE_TYPES.IMPLEMENTS });
    return node;
  }

  /** Link a shared implementation to a product family (the family adopts this implementation). */
  linkFamily({ implementationKey, family } = {}) {
    if (!implementationKey || !family) throw new Error('implementationKey and family are required');
    if (!this.graph.nodes.has(implementationNodeId(implementationKey))) throw new Error(`unknown implementation: ${implementationKey}`);
    this.graph.upsertNode({ id: familyNodeId(family), kind: 'family', key: family });
    return this.graph.addEdge({ from: implementationNodeId(implementationKey), to: familyNodeId(family), type: CAPABILITY_EDGE_TYPES.BELONGS_TO_FAMILY });
  }

  /** Register a concrete product instance belonging to a family. */
  linkInstance({ family, instance, repo = null } = {}) {
    if (!family || !instance) throw new Error('family and instance are required');
    if (!this.graph.nodes.has(familyNodeId(family))) this.graph.upsertNode({ id: familyNodeId(family), kind: 'family', key: family });
    this.graph.upsertNode({ id: instanceNodeId(instance), kind: 'instance', key: instance, repo });
    return this.graph.addEdge({ from: familyNodeId(family), to: instanceNodeId(instance), type: CAPABILITY_EDGE_TYPES.INSTANTIATED_AS });
  }

  /** Link a product instance to the test(s) that verify it. */
  linkTest({ instance, test, suite = null } = {}) {
    if (!instance || !test) throw new Error('instance and test are required');
    if (!this.graph.nodes.has(instanceNodeId(instance))) throw new Error(`unknown instance: ${instance}`);
    this.graph.upsertNode({ id: testNodeId(test), kind: 'test', key: test, suite });
    return this.graph.addEdge({ from: instanceNodeId(instance), to: testNodeId(test), type: CAPABILITY_EDGE_TYPES.VERIFIED_BY });
  }

  /** Link a product instance to a release channel it ships through. */
  linkChannel({ instance, channel, kind = 'default' } = {}) {
    if (!instance || !channel) throw new Error('instance and channel are required');
    if (!this.graph.nodes.has(instanceNodeId(instance))) throw new Error(`unknown instance: ${instance}`);
    this.graph.upsertNode({ id: channelNodeId(channel), kind: 'channel', key: channel, channelKind: kind });
    return this.graph.addEdge({ from: instanceNodeId(instance), to: channelNodeId(channel), type: CAPABILITY_EDGE_TYPES.RELEASES_TO });
  }

  /**
   * Walk the full chain from a capability down to release channels: capability -> implementations
   * -> families -> instances -> tests/channels. Used to answer "what would fan out if this
   * capability changed?" (the impact set for issue #102's regeneration/verification step).
   */
  impactOf(capabilityKey) {
    const capId = capabilityNodeId(capabilityKey);
    if (!this.graph.nodes.has(capId)) throw new Error(`unknown capability: ${capabilityKey}`);
    const implementations = [...this.graph.in.get(capId) ?? []]
      .map((edgeKey) => this.graph.edges.get(edgeKey))
      .filter((edge) => edge.type === CAPABILITY_EDGE_TYPES.IMPLEMENTS)
      .map((edge) => structuredClone(this.graph.nodes.get(edge.from)));

    const families = [];
    const instances = [];
    const tests = [];
    const channels = [];
    for (const impl of implementations) {
      const implId = implementationNodeId(impl.key);
      const familyEdges = [...this.graph.out.get(implId) ?? []].map((k) => this.graph.edges.get(k)).filter((e) => e.type === CAPABILITY_EDGE_TYPES.BELONGS_TO_FAMILY);
      for (const fe of familyEdges) {
        const familyNode = structuredClone(this.graph.nodes.get(fe.to));
        families.push(familyNode);
        const instanceEdges = [...this.graph.out.get(fe.to) ?? []].map((k) => this.graph.edges.get(k)).filter((e) => e.type === CAPABILITY_EDGE_TYPES.INSTANTIATED_AS);
        for (const ie of instanceEdges) {
          instances.push(structuredClone(this.graph.nodes.get(ie.to)));
          const testEdges = [...this.graph.out.get(ie.to) ?? []].map((k) => this.graph.edges.get(k)).filter((e) => e.type === CAPABILITY_EDGE_TYPES.VERIFIED_BY);
          for (const te of testEdges) tests.push(structuredClone(this.graph.nodes.get(te.to)));
          const channelEdges = [...this.graph.out.get(ie.to) ?? []].map((k) => this.graph.edges.get(k)).filter((e) => e.type === CAPABILITY_EDGE_TYPES.RELEASES_TO);
          for (const ce of channelEdges) channels.push(structuredClone(this.graph.nodes.get(ce.to)));
        }
      }
    }

    return {
      capability: structuredClone(this.graph.nodes.get(capId)),
      implementations,
      families,
      instances,
      tests,
      channels,
      instanceCount: instances.length,
    };
  }

  snapshot() { return { version: 1, graph: this.graph.snapshot() }; }
  restore(snapshot) { if (snapshot?.graph) this.graph.restore(snapshot.graph); }
}
