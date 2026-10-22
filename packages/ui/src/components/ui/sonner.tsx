import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconInfoCircle, IconLoader2 } from '@tabler/icons-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useTheme } from '../../theme';

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme: theme } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      icons={{
        success: <IconCircleCheck className="size-4" />,
        info: <IconInfoCircle className="size-4" />,
        warning: <IconAlertTriangle className="size-4" />,
        error: <IconCircleX className="size-4" />,
        loading: <IconLoader2 className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
