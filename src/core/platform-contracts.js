export const PlatformContracts = Object.freeze({
  controlPlaneSnapshot: 6,
  leverageSnapshot: 4,
  patchFabricSnapshot: 1,
  patchBundle: 1,
  patchComposition: 1,
  trajectory: 1,
  semanticGraph: 1,
  transformRegistry: 2,
  planningManifest: 1
});

export function platformContractManifest() {
  return structuredClone(PlatformContracts);
}
