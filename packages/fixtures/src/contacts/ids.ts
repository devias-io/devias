/** Every id the module owns, written once; the manifest and the module's code point at them. */
export const ids = {
  objects: {
    person: '01a1751f-5f09-7114-9d75-bebf2c7785e8',
    company: '01a1751f-5f09-7114-9d75-c6298b7cb4b3',
    opportunity: '01a17522-1eb7-7744-b55d-ab0f8f95f17d',
    note: '01a17526-8e0c-7010-b63c-57e54e8e6ced',
    chore: '01a17526-8e0c-7010-b63c-590e089043fc',
  },
  fields: {
    person: {
      first_name: '01a17522-1eb8-7612-9ae6-873de332d467',
      last_name: '01a17526-8e0c-7010-b63c-5c0469b87dee',
      email: '01a17526-8e0c-7010-b63c-609084a6f142',
      phone: '01a17526-8e0c-7010-b63c-65ea0a5d5271',
      job_title: '01a17526-8e0c-7010-b63c-6b5d79201ae6',
      company: '01a17526-8e0c-7010-b63c-6c9773d96d19',
      city: '01a17526-8e0c-7010-b63c-711e78bc0b2a',
      linkedin: '01a17526-8e0c-7010-b63c-742a683f5346',
    },
    company: {
      name: '01a17526-8e0c-7010-b63c-78778a3a6967',
      domain: '01a17526-8e0c-7010-b63c-7ee7710ea752',
      industry: '01a17526-8e0c-7010-b63c-830dda8a29a7',
      employees: '01a17526-8e0c-7010-b63c-84f2f6ed0cb0',
      annual_revenue: '01a17526-8e0c-7010-b63c-8bbdc364194b',
      ideal_customer_profile: '01a17526-8e0c-7010-b63c-8e1acd1104c6',
      city: '01a17526-8e0c-7010-b63c-905f9b651e6d',
    },
    opportunity: {
      name: '01a17526-8e0c-7010-b63c-962463e2d99f',
      stage: '01a17522-9493-74bb-9f20-bb523e19b8fb',
      amount: '01a17526-8e0c-7010-b63c-99fcd1e28485',
      close_date: '01a17526-8e0c-7010-b63c-9d7b6d5b1cf5',
      probability: '01a17526-8e0c-7010-b63c-a1b74f23ccc1',
      rating: '01a17526-8e0c-7010-b63c-a52e121f111e',
      company: '01a17526-8e0c-7010-b63c-a955ac281b53',
      point_of_contact: '01a17526-8e0c-7010-b63c-ad0467d09c25',
    },
    note: {
      title: '01a17526-8e0c-7010-b63c-b31ecfe50db3',
      body: '01a17526-8e0c-7010-b63c-b49e53711ef5',
      person: '01a17526-8e0c-7010-b63c-b948c1752e7c',
      company: '01a17526-8e0c-7010-b63c-bea263800c01',
    },
    chore: {
      title: '01a17526-8e0c-7010-b63c-c0a7f0c3f316',
      due_date: '01a17526-8e0c-7010-b63c-c439e4cf194e',
      done: '01a17526-8e0c-7010-b63c-c82022214485',
      assignee: '01a17526-8e0c-7010-b63c-cd74d0fe0671',
      opportunity: '01a17526-8e0c-7010-b63c-d17d99ae691d',
      person: '01a17526-8e0c-7010-b63c-d76505936a5e',
    },
  },
  views: {
    person: {
      all: '01a17522-948a-774f-9272-cf1d32843a07',
    },
    company: {
      all: '01a17522-1eb6-7569-a9cf-6317c155bf19',
    },
    opportunity: {
      pipeline: '01a17522-9493-74bb-9f20-b69ed17e9143',
      all: '01a17526-8e0c-7010-b63c-d825f67536b1',
    },
    note: {
      all: '01a17526-8e0c-7010-b63c-dc6b2556f021',
    },
    chore: {
      open: '01a17526-8e0c-7010-b63c-e0b814607efb',
    },
  },
  layouts: {
    person: {
      default: '01a17526-8e0c-7010-b63c-e6d515d0c3d3',
    },
    company: {
      default: '01a17526-8e0c-7010-b63c-e8d5636df792',
    },
    opportunity: {
      default: '01a17526-8e0c-7010-b63c-effedea3496d',
    },
  },
  nav: {
    contacts_group: '01a17526-8e0c-7010-b63c-f20794f6a37c',
    people: '01a1751f-5f09-7114-9d75-bae48e0719e6',
    companies: '01a1751f-5f09-7114-9d75-c382766ba2a2',
    sales_group: '01a17526-8e0c-7010-b63c-f664be3e1a33',
    pipeline: '01a17522-1eb7-7744-b55d-a6cecb6732fe',
    opportunities: '01a17526-8e0c-7010-b63c-f8def99b0df2',
    activity_group: '01a17526-8e0c-7010-b63c-fd02e43ed979',
    chores: '01a17526-8e0c-7010-b63d-01008d77fb64',
    notes: '01a17522-1eb7-7744-b55d-aee680c0f0f2',
  },
  commands: {
    new_person: '01a17522-1eb3-749e-bd91-7dddee58a90e',
    new_company: '01a17526-8e0c-7010-b63d-048706465e0b',
    new_opportunity: '01a17526-8e0c-7010-b63d-08b01ae9cfb2',
  },
  blocks: {
    person_summary: '01a17526-8e0c-7010-b63d-0d6dfe78eb9b',
    pipeline: '01a17522-1eb7-7744-b55d-a6cecb6732fe',
    chores: '01a17526-8e0c-7010-b63d-01008d77fb64',
    new_this_week: '01a17526-8e0c-7010-b63d-105a746b881f',
  },
} as const;
