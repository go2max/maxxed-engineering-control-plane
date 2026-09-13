export const TaskStage = Object.freeze({
  IMPLEMENTATION: 'IMPLEMENTATION',
  VERIFICATION: 'VERIFICATION',
  REPAIR: 'REPAIR',
  DEPLOYMENT: 'DEPLOYMENT'
});

const VALID = new Set(Object.values(TaskStage));

export function taskStage(task = {}) {
  const explicit = String(task?.metadata?.stage ?? '').toUpperCase();
  if (VALID.has(explicit)) return explicit;

  const taskClass = String(task?.taskClass ?? '').toLowerCase();
  const kind = String(task?.metadata?.execution?.kind ?? '').toLowerCase();
  if (taskClass === 'repair' || task?.metadata?.repairOf) return TaskStage.REPAIR;
  if (taskClass === 'validation' || kind === 'validation-agent') return TaskStage.VERIFICATION;
  if (taskClass === 'deployment' || kind === 'deployment-agent' || task?.metadata?.deployment === true) return TaskStage.DEPLOYMENT;
  return TaskStage.IMPLEMENTATION;
}

export function stageAllowed(task, decision = {}) {
  const blocked = new Set(decision.blockedStages ?? []);
  return !blocked.has(taskStage(task));
}
