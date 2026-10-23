import { type AiSkill, SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_TITLE_MAX } from '@devias/core';
import {
  Breadcrumbs,
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  Page,
  Textarea,
} from '@devias/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../hooks/use-mutations';
import { useClient } from '../../providers/client';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { keys } from '../../query/keys';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';

interface Draft {
  title: string;
  description: string;
  body: string;
}

const draftOf = (skill: AiSkill | null): Draft => ({
  title: skill?.title ?? '',
  description: skill?.description ?? '',
  body: skill?.body ?? '',
});

/** A skill's page: its title, the line saying when to use it, and the procedure. Null `skill` is a new one. */
export function SkillEditorPage({ skill }: { skill: AiSkill | null }) {
  const client = useClient();
  const { workspaceId, slug } = useWorkspace();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { index } = useSchema();
  const [initial, setInitial] = useState(() => draftOf(skill));
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const archived = skill?.archivedAt != null;
  // A module's skill: what it says is the module's, so only archiving is ours.
  const owner = skill?.moduleId
    ? { name: index.schema.modules.find((m) => m.moduleId === skill.moduleId)?.name ?? skill.moduleId }
    : null;
  const title = draft.title.trim() || 'New skill';
  const complete = draft.title.trim() !== '' && draft.description.trim() !== '' && draft.body.trim() !== '';
  const dirty = !skill || JSON.stringify(draft) !== JSON.stringify(initial);
  const listHref = links.skills(slug);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.aiSkills(workspaceId) });

  const save = async () => {
    setBusy(true);

    try {
      const input = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        body: draft.body.trim(),
      };
      const saved = skill ? await client.ai.skills.update(skill.id, input) : await client.ai.skills.create(input);
      await refresh();
      toast.success(skill ? 'Skill updated' : 'Skill written');

      if (skill) {
        const next = draftOf(saved);
        setInitial(next);
        setDraft(next);
      } else {
        navigation.navigate(links.skill(slug, saved.id), { replace: true });
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const setArchived = async (next: boolean) => {
    if (!skill) {
      return;
    }

    setBusy(true);

    try {
      await client.ai.skills.update(skill.id, { archived: next });
      await refresh();
      toast.success(next ? `${skill.title} archived` : `${skill.title} restored`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page fullBleed className="bg-background">
      <div className="border-b border-border" data-slot="skill-header">
        <div className="mx-auto w-full max-w-6xl px-8 pt-5 pb-5">
          <Breadcrumbs
            items={[
              { label: 'Agents', href: links.agents(slug) },
              { label: 'Skills', href: listHref },
              { label: title },
            ]}
            linkComponent={navigation.Link}
            className="-ml-1"
          />
          <div className="mt-5 flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h1 className="truncate font-heading text-heading">{title}</h1>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {draft.description.trim() || 'A procedure agents can load when a request calls for it.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="lg" onClick={() => navigation.navigate(listHref)} disabled={busy}>
                {dirty && skill ? 'Cancel' : 'Back'}
              </Button>
              {owner ? null : (
                <Button
                  size="lg"
                  onClick={() => void save()}
                  disabled={busy || !complete || !dirty}
                  title={!complete ? 'A title, a line saying when to use it, and the procedure' : undefined}
                >
                  {skill ? 'Save' : 'Write skill'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl flex-1 px-8 pt-8 pb-12">
        <div className="max-w-3xl">
          {owner ? (
            <p
              data-slot="module-owned"
              className="mb-6 flex items-start gap-2 rounded-lg bg-muted/60 px-4 py-3 text-xs text-muted-foreground"
            >
              <Icon name="puzzle" className="mt-0.5 size-4 shrink-0" />
              <span>
                Comes with the module {owner.name}. Its title, description and procedure change when the module updates.
                You can archive it, or write a skill of your own.
              </span>
            </p>
          ) : null}
          <fieldset disabled={owner !== null} className="m-0 min-w-0 border-0 p-0">
            <FieldGroup className="gap-6">
              <Field>
                <FieldLabel htmlFor="skill-title">Title</FieldLabel>
                <Input
                  id="skill-title"
                  value={draft.title}
                  maxLength={SKILL_TITLE_MAX}
                  placeholder="Qualify a lead"
                  autoFocus={!skill}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-description">When to use it</FieldLabel>
                <Input
                  id="skill-description"
                  value={draft.description}
                  maxLength={SKILL_DESCRIPTION_MAX}
                  placeholder="When a new lead arrives or someone asks whether a lead is worth a call"
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
                <FieldDescription>
                  One line. An agent reads it with the title to decide whether to load the skill.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="skill-body">Procedure</FieldLabel>
                <Textarea
                  id="skill-body"
                  value={draft.body}
                  rows={18}
                  maxLength={SKILL_BODY_MAX}
                  className="min-h-72 resize-y font-mono"
                  placeholder={
                    '1. Look the company up with lookup_records.\n2. Score it from its size and industry.\n3. Add a comment with the score.'
                  }
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                />
                <FieldDescription>
                  Markdown, loaded only when the agent uses the skill.{' '}
                  <span data-slot="body-count" className="tabular-nums">
                    {draft.body.length.toLocaleString()} / {SKILL_BODY_MAX.toLocaleString()}
                  </span>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </fieldset>
          {skill ? (
            <section
              data-slot="skill-archive"
              className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-border px-5 py-4"
            >
              <div className="min-w-0 max-w-xl">
                <h3 className="text-xs font-semibold">
                  {archived ? `${skill.title} is archived` : `Archive ${skill.title}`}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {archived
                    ? 'No agent lists or loads it. Restore it to let agents use it again.'
                    : 'No agent lists or loads it any more. You can restore it any time.'}
                </p>
              </div>
              <Button variant="outline" disabled={busy} onClick={() => void setArchived(!archived)}>
                <Icon name={archived ? 'rotate-ccw' : 'archive'} /> {archived ? 'Restore' : 'Archive'}
              </Button>
            </section>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
