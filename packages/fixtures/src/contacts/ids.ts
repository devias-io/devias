/** Every id the module owns, written once; the manifest and the module's code point at them. */
export const ids = {
  objects: {
    person: 'fixture.person',
    company: 'fixture.company',
    opportunity: 'fixture.opportunity',
    note: 'fixture.note',
    chore: 'fixture.chore',
  },
  fields: {
    person: {
      first_name: 'fixture.person.first_name',
      last_name: 'fixture.person.last_name',
      email: 'fixture.person.email',
      phone: 'fixture.person.phone',
      job_title: 'fixture.person.job_title',
      company: 'fixture.person.company',
      city: 'fixture.person.city',
      linkedin: 'fixture.person.linkedin',
    },
    company: {
      name: 'fixture.company.name',
      domain: 'fixture.company.domain',
      industry: 'fixture.company.industry',
      employees: 'fixture.company.employees',
      annual_revenue: 'fixture.company.annual_revenue',
      ideal_customer_profile: 'fixture.company.ideal_customer_profile',
      city: 'fixture.company.city',
    },
    opportunity: {
      name: 'fixture.opportunity.name',
      stage: 'fixture.opportunity.stage',
      amount: 'fixture.opportunity.amount',
      close_date: 'fixture.opportunity.close_date',
      probability: 'fixture.opportunity.probability',
      rating: 'fixture.opportunity.rating',
      company: 'fixture.opportunity.company',
      point_of_contact: 'fixture.opportunity.point_of_contact',
    },
    note: {
      title: 'fixture.note.title',
      body: 'fixture.note.body',
      person: 'fixture.note.person',
      company: 'fixture.note.company',
    },
    chore: {
      title: 'fixture.chore.title',
      due_date: 'fixture.chore.due_date',
      done: 'fixture.chore.done',
      assignee: 'fixture.chore.assignee',
      opportunity: 'fixture.chore.opportunity',
      person: 'fixture.chore.person',
    },
  },
  views: {
    person: {
      all: 'fixture.person.all',
    },
    company: {
      all: 'fixture.company.all',
    },
    opportunity: {
      pipeline: 'fixture.opportunity.pipeline',
      all: 'fixture.opportunity.all',
    },
    note: {
      all: 'fixture.note.all',
    },
    chore: {
      open: 'fixture.chore.open',
    },
  },
  layouts: {
    person: {
      default: 'fixture.person.default',
    },
    company: {
      default: 'fixture.company.default',
    },
    opportunity: {
      default: 'fixture.opportunity.default',
    },
  },
  nav: {
    contacts_group: 'fixture.contacts_group',
    people: 'fixture.people',
    companies: 'fixture.companies',
    sales_group: 'fixture.sales_group',
    pipeline: 'fixture.pipeline',
    opportunities: 'fixture.opportunities',
    activity_group: 'fixture.activity_group',
    chores: 'fixture.chores',
    notes: 'fixture.notes',
  },
  commands: {
    new_person: 'fixture.new_person',
    new_company: 'fixture.new_company',
    new_opportunity: 'fixture.new_opportunity',
  },
  blocks: {
    person_summary: 'fixture.person_summary',
    pipeline: 'fixture.pipeline',
    chores: 'fixture.chores',
    new_this_week: 'fixture.new_this_week',
  },
} as const;
