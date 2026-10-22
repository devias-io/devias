import { IconLoader2 } from '@tabler/icons-react';
import { cn } from '../../lib/cn';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <IconLoader2
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      aria-hidden={false}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
