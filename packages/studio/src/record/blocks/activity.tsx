import { coreIds, defineBlockComponent } from '@devias/core';
import { ActivityTimeline } from '../activity/activity-timeline';

/** A record's history, in an "Activity" tab unless the layout places it. */
export const activityBlock = defineBlockComponent({
  id: coreIds.blocks.activity,
  label: 'Activity',
  icon: 'history',
  surfaces: { record: { placement: 'tab' } },
  component: ({ record, object }) => <ActivityTimeline object={object} record={record} />,
});
