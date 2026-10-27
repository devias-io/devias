import { defineSettingsSection } from '@devias/core';
import { ModuleMark } from '../../../components/module-mark';
import { useOAuthReturn, useRuntimeModules } from '../../../hooks/use-module-connections';
import { ProviderConnections } from './module-runtime';

/**
 * Each person's own connections: the accounts they connected to installed modules (a Google account, say). Admins
 * manage the workspace's connections in Settings → Modules; this page is for everyone, about themselves.
 */
function Integrations() {
  const { items, isPending } = useRuntimeModules();
  useOAuthReturn();
  const personal = items
    .map((item) => ({
      ...item,
      offered: item.module.connections.filter((provider) => provider.visibility !== 'workspace'),
    }))
    .filter((item) => item.offered.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-muted-foreground">
        Accounts you connect are yours: modules use them when you, or the agent for you, run their actions.
      </p>
      {isPending ? null : personal.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          No installed module offers an account to connect.
        </p>
      ) : (
        personal.map((item) => (
          <section key={item.module.id} className="flex flex-col gap-3" data-module={item.module.id}>
            <h2 className="flex items-center gap-2 text-xs font-medium">
              <ModuleMark moduleId={item.module.id} module={item.module} className="size-4" />
              {item.module.label}
            </h2>
            {item.offered.map((provider) => (
              <ProviderConnections
                key={provider.id}
                module={item.module}
                provider={provider}
                status={item.providers.find((candidate) => candidate.providerId === provider.id)}
                connections={item.connections}
                visibilities={['user']}
              />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

export const integrationsSection = defineSettingsSection({
  name: 'integrations',
  label: 'Integrations',
  icon: 'plug',
  group: 'account',
  component: Integrations,
});
