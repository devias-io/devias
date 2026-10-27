/** Every id the module owns, its own included, written once; the manifest and the module's code point at them. */
export const ids = {
  module: '01a17ead-51f8-77e3-a0d1-7b99efb1b867',
  actions: {
    enrich_person: '01a17ead-51f9-718e-a1bd-47b20dbc21da',
  },
  connections: {
    default: '01a17ead-51f9-718e-a1bd-48c8e2997dd9',
  },
  variables: {
    min_match_score: '01a17ead-51f9-718e-a1bd-4d17c194bf35',
  },
  workflows: {
    enrich_person: '01a17ead-51f9-718e-a1bd-53d28cbee95a',
    enrich_new_people: '01a17ead-51f9-718e-a1bd-5613ddd75ffb',
  },
  steps: {
    enrich_person: '01a17ead-51f9-718e-a1bd-5a95cf34ad61',
    enrich_new_person: '01a17ead-51f9-718e-a1bd-5db2c0c84cb8',
  },
} as const;
