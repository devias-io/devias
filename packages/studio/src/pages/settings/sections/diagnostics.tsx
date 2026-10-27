import { defineSettingsSection } from '@devias/core';
import { Badge, Section } from '@devias/ui';
import { useSchema } from '../../../providers/schema';
import { useStudioConfig } from '../../../providers/studio-config';

function DiagnosticsSettings() {
  const config = useStudioConfig();
  const { schema } = useSchema();
  const registries = [
    ['Field types', [...config.registries.fieldTypes.keys()]],
    ['View types', [...config.registries.viewTypes.keys()]],
    ['Blocks', [...config.registries.blocks.keys()]],
    ['Pages', [...config.registries.pages.keys()]],
    ['Commands', [...config.registries.commands.keys()]],
    ['Command providers', [...config.registries.commandProviders.keys()]],
    ['Settings sections', [...config.registries.settingsSections.keys()]],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <Section title="Config diagnostics" description="Reported while resolving the studio config.">
        {config.diagnostics.length === 0 ? (
          <div className="text-xs text-muted-foreground">No issues.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {config.diagnostics.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <Badge variant={d.level === 'error' ? 'destructive' : 'secondary'} className="mt-0.5 shrink-0">
                  {d.level}
                </Badge>
                <span>
                  <span className="font-mono text-xs text-muted-foreground">{d.code}</span> {d.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Registries" description={`Contributions: ${config.contributions.map((c) => c.id).join(' → ')}`}>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-xs">
          {registries.map(([title, names]) => (
            <div key={title} className="contents">
              <dt className="text-muted-foreground">
                {title} <span className="tabular-nums">({names.length})</span>
              </dt>
              <dd className="flex flex-wrap gap-1">
                {names.map((name) => (
                  <Badge key={name} variant="outline" className="font-mono text-xs">
                    {name}
                  </Badge>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Workspace metadata">
        <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Metadata version</dt>
          <dd className="tabular-nums">{schema.version}</dd>
          <dt className="text-muted-foreground">Objects / fields</dt>
          <dd className="tabular-nums">
            {schema.objects.length} / {schema.fields.length}
          </dd>
          <dt className="text-muted-foreground">Views / layouts</dt>
          <dd className="tabular-nums">
            {schema.views.length} / {schema.layouts.length}
          </dd>
          <dt className="text-muted-foreground">Installed modules</dt>
          <dd>{schema.modules.map((e) => `${e.id}@${e.version}`).join(', ') || 'none'}</dd>
        </dl>
      </Section>
    </div>
  );
}

export const diagnosticsSection = defineSettingsSection({
  name: 'diagnostics',
  label: 'Diagnostics',
  icon: 'activity',
  group: 'developer',
  component: DiagnosticsSettings,
});
