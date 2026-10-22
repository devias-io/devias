import { Toaster } from '@devias/ui';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Studio, type StudioProps } from './studio';

/** Mount the studio (with the toast host) into a DOM element. */
export const renderStudio = (options: StudioProps, element: Element): Root => {
  const root = createRoot(element);
  root.render(
    <StrictMode>
      <Studio {...options} />
      <Toaster />
    </StrictMode>,
  );

  return root;
};
