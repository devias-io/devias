import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { client, createTestServer } from './helpers';
import { type Vocabulary, vocabularyProblems } from './vocabulary';

/** A layout's cells and tabs, in each of its three shapes: a cell has a name and may have a heading. */
const layout = (shape: string) => {
  const cells = ['header', 'blocks[]', 'main[]', 'aside[]', 'tabs[].blocks[]'];

  return {
    api: [...cells.map((cell) => `${shape}.${cell}.name`), `${shape}.tabs[].name`],
    label: [`${shape}.label`, `${shape}.tabs[].label`, ...cells.map((cell) => `${shape}.${cell}.label`)],
    cells: cells.map((cell) => `${shape}.${cell}.label`),
  };
};
const layouts = ['Layout', 'LayoutDefinition', 'LayoutInput'].map(layout);

/** One line per thing the API serves that has a text: what the text is for. Adding a shape that says `name`, `label` or `title` asks for a line. */
const VOCABULARY: Vocabulary = {
  api: [
    'ActionField.name',
    'ActionOutputField.name',
    'AiToolInfo.name',
    'ChatEvent.name',
    'FieldDefinition.name',
    'FieldInput.name',
    'FieldMetadata.name',
    'Job.name',
    'ObjectCreateInput.nameSingular',
    'ObjectCreateInput.namePlural',
    'ObjectDefinition.nameSingular',
    'ObjectDefinition.namePlural',
    'ObjectFieldInput.name',
    'ObjectMetadata.nameSingular',
    'ObjectMetadata.namePlural',
    'SettingField.name',
    'ToolCall.name',
    'WorkspaceEvent.name',
    ...layouts.flatMap((one) => one.api),
  ],
  party: [
    'AgentDefinition.name',
    'AiAgent.name',
    'AiAgentInput.name',
    'AiAgentPatch.name',
    'ApiKeySummary.name',
    'CreateApiKey.name',
    'CreateWorkspace.name',
    'CreatedApiKey.name',
    'InputRequest.consent.name',
    'InstalledModule.name',
    'Me.user.name',
    'ModuleManifest.name',
    'ModulePublisher.name',
    'WorkspaceMember.user.name',
    'WorkspaceSummary.name',
  ],
  label: [
    'ActionDefinition.label',
    'ActionField.label',
    'AggregateResult.groups[].label',
    'BlockDeclaration.label',
    'BlockList.blocks[].label',
    'CommandItem.label',
    'CommandItemDefinition.label',
    'CommandItemInput.label',
    'Connection.label',
    'ConnectionCreate.label',
    'ConnectionPatch.label',
    'ConnectionProvider.label',
    'ConnectionProviderStatus.label',
    'FieldDefinition.label',
    'FieldInput.label',
    'FieldMetadata.label',
    'InputRequest.connect.label',
    'InputRequest.question.options[].label',
    'LayoutAction.label',
    'ModuleVariable.label',
    'NavItem.label',
    'NavItemDefinition.label',
    'NavItemInput.label',
    'NavOverrides.label',
    'ObjectCreateInput.labelSingular',
    'ObjectCreateInput.labelPlural',
    'ObjectDefinition.labelSingular',
    'ObjectDefinition.labelPlural',
    'ObjectFieldInput.label',
    'ObjectMetadata.labelSingular',
    'ObjectMetadata.labelPlural',
    'PageDeclaration.label',
    'PlanChange.label',
    'RevealedValue.label',
    'SettingField.label',
    'VariableDefinition.label',
    'ViewDefinition.label',
    'ViewInput.label',
    'ViewMetadata.label',
    'WorkflowRunStep.label',
    'WorkflowStep.label',
    'WorkflowStepInput.label',
    ...layouts.flatMap((one) => one.label),
  ],
  title: [
    'Conversation.title',
    'CreateConversationInput.title',
    'Document.title',
    'DocumentInput.title',
    'DocumentPatch.title',
    'DocumentSummary.title',
    'InputRequest.title',
    // A row in a list of results: a title over a subtitle.
    'LookupHit.title',
    'Note.title',
    'NoteInput.title',
    'NotePatch.title',
    'Notification.title',
    'NotificationInput.title',
    // A procedure the workspace wrote for its agents: authored text, like a workflow.
    'AiSkill.title',
    'AiSkillInput.title',
    'AiSkillPatch.title',
    'AiSkillSummary.title',
    'SkillDefinition.title',
    'Task.title',
    'TaskInput.title',
    'TaskPatch.title',
    'TaskSummary.title',
    'Workflow.title',
    'WorkflowInput.title',
  ],
};

/**
 * Labels that may be left out, each with one fixed meaning: a cell with none has no heading, a layout action takes its
 * action's label, a nav override keeps the module's, a connection is shown by its account, an aggregate group's is the
 * option's or the record's own, a connection's label is chosen when it is made or changed, and a step with none is
 * shown by its action.
 */
const OPTIONAL_LABELS = [
  'AggregateResult.groups[].label',
  'ConnectionCreate.label',
  'ConnectionPatch.label',
  'LayoutAction.label',
  'NavOverrides.label',
  'WorkflowRunStep.label',
  'WorkflowStep.label',
  'WorkflowStepInput.label',
  ...layouts.flatMap((one) => one.cells),
];

describe('the words the API uses for the text of a thing', () => {
  let server: Server;
  beforeAll(async () => {
    server = await createTestServer();
  });
  afterAll(() => server.close());

  it('are the ones in the table, each for what it is for', async () => {
    const document = (await client(server)('/api/openapi.json')).json as Parameters<typeof vocabularyProblems>[0];
    expect(vocabularyProblems(document, VOCABULARY, { optionalLabels: OPTIONAL_LABELS })).toEqual([]);
  });
});

describe('the check', () => {
  const document = (schemas: Record<string, unknown>) => ({ components: { schemas } });
  const string = { type: 'string' };
  const table: Vocabulary = { api: [], party: [], label: ['View.label'], title: ['Note.title'] };
  const check = (schemas: Record<string, unknown>, vocabulary = table, optionalLabels: string[] = []) =>
    vocabularyProblems(document(schemas), vocabulary, { optionalLabels });

  it('passes what the table says', () => {
    expect(
      check({
        View: { properties: { label: string }, required: ['label'] },
        Note: { properties: { title: string }, required: ['title'] },
      }),
    ).toEqual([]);
  });

  it('refuses a shape that is not in the table, and says what to decide', () => {
    const [problem] = check({ Thing: { properties: { label: string }, required: ['label'] } });
    expect(problem).toContain('Thing.label uses `label` and is not in the vocabulary table');
    expect(problem).toContain('`title` is the text of a page of work');
  });

  it('refuses a word that is not one of them', () => {
    expect(check({ Module: { properties: { displayName: string } } })[0]).toContain(
      '`displayName` is not one of the words',
    );
    expect(check({ Card: { properties: { heading: string } } })[0]).toContain('`heading` is not one of the words');
  });

  it('refuses a part that says title, nested ones included', () => {
    const problems = check(
      {
        View: {
          properties: { label: string, tabs: { items: { properties: { title: string } } } },
          required: ['label'],
        },
      },
      { ...table, label: ['View.label', 'View.tabs[].title'] },
    );
    expect(problems.join('\n')).toContain('View.tabs[].title is a label but says `title`');
  });

  it('refuses an optional label that is not on the list, and a party beside a label', () => {
    expect(check({ View: { properties: { label: string } } })[0]).toContain('optional label');
    expect(check({ View: { properties: { label: string } } }, { ...table, title: [] }, ['View.label'])).toEqual([]);
    const problems = check(
      { Agent: { properties: { name: string, label: string }, required: ['name', 'label'] } },
      { api: [], party: ['Agent.name'], label: ['Agent.label'], title: [] },
    );
    expect(problems.join('\n')).toContain("a party's name beside a label");
  });

  it('refuses a line in the table that names nothing', () => {
    expect(check({}, table)).toEqual([
      'View.label (label) is in the vocabulary table but not in the API document: remove it or fix its name',
      'Note.title (title) is in the vocabulary table but not in the API document: remove it or fix its name',
    ]);
  });
});
