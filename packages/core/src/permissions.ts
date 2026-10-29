/** The permissions the engine checks before acting. Roles, api keys and actors are mapped onto them in the data engine. */
export const PERMISSIONS = [
  'record.read',
  'record.write',
  'metadata.read',
  'metadata.write',
  'module.read',
  'module.run',
  /** Connect one's own accounts to modules (a person's Google account); workspace connections need `module.manage`. */
  'module.connect',
  'module.manage',
  'apikey.manage',
  'event.read',
  'member.read',
  'member.manage',
  'ai.manage',
  'workflow.read',
  'workflow.run',
  'workflow.manage',
  /** Read documents. */
  'document.read',
  /** Write, append to and delete documents. */
  'document.write',
  /** Read the files of the workspace and open them. */
  'asset.read',
  /** Upload, rename, describe and delete files. */
  'asset.write',
  /** Read tasks and their timelines. */
  'task.read',
  /** Create, change, comment on and delete tasks. */
  'task.write',
  /** Stop and retry the runs agents make on tasks. */
  'task.control',
  'notification.read',
  'notification.send',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
