export const WORK_PACKET_SCHEMA = 'maxxed.work-packet-contract.v1';

function clean(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

export function workPacketView(task) {
  const raw = task?.metadata?.workPacket ?? task?.metadata?.workPacketContract ?? null;
  if (!raw) return { present: false, valid: true, packetKey: null, contract: null, reason: null };

  if (raw.schema !== WORK_PACKET_SCHEMA || raw.formed !== true) {
    return { present: true, valid: false, packetKey: null, contract: null, reason: 'invalid-work-packet-contract' };
  }

  const packetKey = clean(raw.packetKey, 200);
  const repository = clean(raw.repository, 200).toLowerCase();
  const taskRepository = clean(task?.repository, 200).toLowerCase();
  const members = Array.isArray(raw.memberTaskIds) ? raw.memberTaskIds.map((value) => clean(value, 240)).filter(Boolean) : [];
  const taskExternalId = clean(task?.metadata?.externalTaskId ?? task?.metadata?.issueId ?? task?.key, 240);

  if (!packetKey || !repository || repository !== taskRepository || !members.length || !members.includes(taskExternalId)) {
    return { present: true, valid: false, packetKey: packetKey || null, contract: null, reason: 'work-packet-contract-mismatch' };
  }

  return {
    present: true,
    valid: true,
    packetKey,
    contract: {
      schema: WORK_PACKET_SCHEMA,
      packetKey,
      repository,
      scope: clean(raw.scope, 200) || null,
      memberTaskIds: members,
      dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.map((value) => clean(value, 240)).filter(Boolean) : [],
      riskClass: clean(raw.riskClass, 80) || 'standard',
      baseCommit: clean(raw.baseCommit, 160) || null,
      branch: clean(raw.branch, 240) || null,
      validationTiers: raw.validationTiers ? structuredClone(raw.validationTiers) : null,
      rollbackStrategy: raw.rollbackStrategy ? structuredClone(raw.rollbackStrategy) : null
    },
    reason: null
  };
}

export function workPacketClaimScope(task) {
  const packet = workPacketView(task);
  return packet.valid && packet.packetKey ? `packet:${packet.packetKey}` : null;
}

export function packetBlockedByActiveClaim(task, activeClaims = []) {
  const packet = workPacketView(task);
  if (!packet.valid || !packet.packetKey) return false;
  return activeClaims.some((claim) => claim.packetKey === packet.packetKey && claim.taskKey !== task.key);
}
