import { BrandLockup, cn, Icon, Input } from '@devias/ui';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { AuthPanel } from './auth-panel';

/**
 * Every auth page: the form on the left, centered, with the brand at the top, and the picture on the right (a photo
 * with floating glass panes, hidden on small screens, where the form takes the whole width). Without the panel the
 * form is centered on the page.
 */
export function AuthLayout({
  title,
  description,
  children,
  footer,
  wide = false,
  panel = true,
  align = 'start',
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Show the brand panel beside the form (default). Off for pages that are a place to pick from, not a way in. */
  panel?: boolean;
  /** Where the title and description sit: `start` (default) or `center`, over a centered form. */
  align?: 'start' | 'center';
}) {
  return (
    <div
      className={cn(
        'grid min-h-dvh bg-background text-foreground',
        panel && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]',
      )}
    >
      <div className="flex min-h-dvh flex-col px-6 py-8 sm:px-12">
        <BrandLockup tile={false} />
        <main className="flex flex-1 items-center justify-center py-10">
          <div className={cn('w-full', wide ? 'max-w-md' : 'max-w-sm')}>
            <div className={cn('mb-8 flex flex-col gap-2', align === 'center' && 'items-center text-center')}>
              <h1
                className={cn('font-heading font-semibold tracking-tight', align === 'center' ? 'text-2xl' : 'text-xl')}
              >
                {title}
              </h1>
              {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
            </div>
            {children}
            {footer ? <div className="mt-8 text-center text-xs text-muted-foreground">{footer}</div> : null}
          </div>
        </main>
      </div>
      {panel ? <AuthPanel /> : null}
    </div>
  );
}

/** Google's "G", in its own colors. */
export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('size-5 shrink-0', className)} aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** A hairline with a word in the middle, between two ways of doing the same thing. */
export function OrDivider({ children }: { children: ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

/** A password input with a button that shows or hides what was typed. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('h-10 pr-10', className)} />
      <button
        type="button"
        className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible((v) => !v)}
      >
        <Icon name={visible ? 'eye-off' : 'eye'} className="size-4" />
      </button>
    </div>
  );
}

/** An error under a form, with enough weight to be noticed. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <Icon name="triangle-alert" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
