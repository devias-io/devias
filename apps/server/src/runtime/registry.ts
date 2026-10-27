import type { ModuleServer } from '@devias/server';

/** Server sides registered in this process, looked up by module id. */
export const createModuleRegistry = () => {
  const modules = new Map<string, ModuleServer>();

  return {
    register(module: ModuleServer): void {
      const id = module.manifest.id;

      if (modules.has(id)) {
        throw new Error(`Module "${id}" is already registered`);
      }

      modules.set(id, module);
    },
    get: (moduleId: string): ModuleServer | undefined => modules.get(moduleId),
    list: (): ModuleServer[] => [...modules.values()],
  };
};

export type ModuleRegistry = ReturnType<typeof createModuleRegistry>;
