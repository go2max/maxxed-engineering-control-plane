import { fabricTaskFromDispatch as fabricCodingTaskFromDispatch } from './coding-task.js';
import { fabricValidationTaskFromDispatch } from './validation-task.js';

export function isFabricExecutionTask(task) {
  return ['coding-agent', 'validation-agent'].includes(task?.metadata?.execution?.kind);
}

export function fabricTaskFromDispatch(task, dispatch) {
  const kind = task?.metadata?.execution?.kind;
  if (kind === 'coding-agent') return fabricCodingTaskFromDispatch(task, dispatch);
  if (kind === 'validation-agent') return fabricValidationTaskFromDispatch(task, dispatch);
  throw new Error(`unsupported fabric execution kind: ${kind ?? '<none>'}`);
}
