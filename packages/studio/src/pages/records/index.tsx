import { definePageComponent } from '@devias/core';
import { EmptyState } from '@devias/ui';
import { useEffect } from 'react';
import { useObject } from '../../hooks/use-schema-lookups';
import { useSetBreadcrumbs } from '../../providers/breadcrumbs';
import { useWorkspace } from '../../providers/workspace';
import { RecordPage } from '../../record/record-page';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { ViewHost } from '../../views/view-host';

/** `/records` used to list every object; the sidebar and the record pages go straight to objects now. */
export function RecordsIndexRedirect() {
  const { navigate } = useNavigation();
  const { slug } = useWorkspace();
  useEffect(() => {
    navigate(links.workspace(slug), { replace: true });
  }, [navigate, slug]);

  return null;
}

export function ObjectViewPage() {
  const { params, search, navigate } = useNavigation();
  const { slug } = useWorkspace();
  const object = useObject(params.objectKey);
  useSetBreadcrumbs([{ label: object?.labelPlural ?? params.objectKey ?? '' }]);

  if (!object) {
    return (
      <EmptyState icon="circle-help" title="Unknown object" description={`No object named "${params.objectKey}".`} />
    );
  }

  const viewId = typeof search.view === 'string' ? search.view : undefined;

  return (
    <div className="h-full">
      <ViewHost
        object={object}
        viewId={viewId}
        onViewChange={(id) => navigate(links.object(slug, object.nameSingular, id), { replace: true })}
      />
    </div>
  );
}

export function RecordRoutePage() {
  const { params } = useNavigation();
  const object = useObject(params.objectKey);

  if (!object || !params.recordId) {
    return (
      <EmptyState icon="circle-help" title="Unknown object" description={`No object named "${params.objectKey}".`} />
    );
  }

  return <RecordPage object={object} recordId={params.recordId} />;
}

export const recordsPages = [
  // Pages only, no title: objects open from their own sidebar rows, and there is no listing of every object.
  definePageComponent({ path: 'records', component: RecordsIndexRedirect }),
  definePageComponent({ path: 'records/$objectKey', component: ObjectViewPage }),
  definePageComponent({ path: 'records/$objectKey/$recordId', component: RecordRoutePage }),
];
