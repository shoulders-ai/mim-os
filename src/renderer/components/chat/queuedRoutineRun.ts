export function queuedRoutineSeedMessage(sess: any, msgs: any[]): any | null {
  if (!sess?.id || !sess.routineId || !sess.routineRunId || sess.routineStatus !== 'working') return null
  if (!Array.isArray(msgs) || msgs.length !== 1) return null
  const message = msgs[0]
  const routine = message?.metadata?.routine
  if (message?.role !== 'user') return null
  if (!routine || routine.queued !== true) return null
  if (routine.id !== sess.routineId || routine.runId !== sess.routineRunId) return null
  return message
}
