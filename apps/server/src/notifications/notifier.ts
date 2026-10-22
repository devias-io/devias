import {
  NotificationInputSchema,
  type NotificationSendResult,
  type ParsedNotificationInput,
  personOf,
} from '@devias/core';
import { type DataEngine, type EngineContext, EngineError, fromZodError } from '@devias/data-engine';
import type { Directory } from '../auth/directory';
import { highestRole } from '../auth/roles';

export interface NotifierOptions {
  engine: DataEngine;
  /** Where the workspace's members come from. */
  directory: Directory;
}

/**
 * Sends notifications for the `notifications.send` action, workflow steps and module actions (`ctx.notify`): it
 * resolves who `to` means against the workspace's members, then hands the content and the recipients to the engine,
 * which stores one row per person and announces them on the feed. The engine never sees `to`.
 */
export const createNotifier = ({ engine, directory }: NotifierOptions) => {
  /** The distinct members `to` names; unknown user ids and `me` without a person are the caller's mistake. */
  const resolve = async (ctx: EngineContext, to: ParsedNotificationInput['to']): Promise<string[]> => {
    const members = await directory.members.list(ctx.workspaceId);
    const recipients = new Set<string>();

    if (to.all) {
      for (const member of members) {
        recipients.add(member.userId);
      }
    }

    if (to.roles && to.roles.length > 0) {
      const roles = new Set<string>(to.roles);

      for (const member of members) {
        const role = highestRole(member.role);

        if (role && roles.has(role)) {
          recipients.add(member.userId);
        }
      }
    }

    if (to.users && to.users.length > 0) {
      const known = new Set(members.map((member) => member.userId));
      const unknown = to.users.filter((id) => !known.has(id));

      if (unknown.length > 0) {
        throw new EngineError('VALIDATION', `Not members of this workspace: ${unknown.join(', ')}`, {
          path: 'to.users',
          unknown,
        });
      }

      for (const id of to.users) {
        recipients.add(id);
      }
    }

    if (to.me) {
      const person = personOf(ctx.actor);

      if (person === null) {
        throw new EngineError('VALIDATION', 'to.me needs a signed-in person', { path: 'to.me' });
      }

      recipients.add(person);
    }

    return [...recipients];
  };

  return {
    /** Parse a `NotificationInput`, resolve its audience and send; an audience that resolves to nobody sends nothing. */
    send: async (ctx: EngineContext, input: unknown): Promise<NotificationSendResult> => {
      engine.permissions.authorize(ctx, 'notification.send');
      const parsed = NotificationInputSchema.safeParse(input);

      if (!parsed.success) {
        throw fromZodError(parsed.error, 'Invalid notification');
      }

      const { to, ...content } = parsed.data;
      const recipients = await resolve(ctx, to);

      if (recipients.length === 0) {
        return { recipients: 0, created: 0, updated: 0 };
      }

      return engine.notifications.send(ctx, { recipients, ...content });
    },
  };
};

export type Notifier = ReturnType<typeof createNotifier>;
