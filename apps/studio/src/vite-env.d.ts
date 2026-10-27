/// <reference types="vite/client" />
/// <reference types="@devias/studio/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
