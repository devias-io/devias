import type { Layout, ObjectMetadata, RecordData } from '@devias/core';

/** What every shell of a record page is given: the record and the layout of its shape, which says what the page holds. */
export interface ShellProps<L extends Layout = Layout> {
  object: ObjectMetadata;
  record: RecordData;
  layout: L;
}
