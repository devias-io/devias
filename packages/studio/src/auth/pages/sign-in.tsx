import { Button, Field, FieldGroup, FieldLabel, Input } from '@devias/ui';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../../providers/auth';
import { useStudioConfig } from '../../providers/studio-config';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { clearAuthCache } from '../../router/session-cache';
import { AuthLayout, FormError, GoogleIcon, OrDivider, PasswordInput } from './auth-layout';

export const safeRedirect = (value: unknown): string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';

export function SignInPage() {
  const auth = useAuth();
  const config = useStudioConfig();
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await auth.signIn({ email: email.trim(), password });
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? 'Could not sign in');

      return;
    }

    clearAuthCache();
    navigation.navigate(safeRedirect(navigation.search.redirect), { replace: true });
  };

  // The browser leaves for Google and comes back signed in, so only a failure returns here.
  const google = async () => {
    setGoogleBusy(true);
    setGoogleError(null);
    const callbackURL = new URL(safeRedirect(navigation.search.redirect), window.location.origin).toString();
    const result = await auth.signInWithProvider?.('google', { callbackURL });
    setGoogleBusy(false);

    if (result && !result.ok) {
      setGoogleError(result.error ?? 'Could not sign in with Google');
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      description={`Sign in to ${config.title}.`}
      align="center"
      footer={
        <>
          New here?{' '}
          <navigation.Link href={links.signUp()} className="font-medium text-foreground underline underline-offset-4">
            Create one
          </navigation.Link>
        </>
      }
    >
      {auth.signInWithProvider ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 w-full gap-2.5 text-[14px]"
            disabled={googleBusy || busy}
            onClick={() => void google()}
          >
            <GoogleIcon />
            {googleBusy ? 'Opening Google…' : 'Continue with Google'}
          </Button>
          {googleError ? (
            <div className="mt-3">
              <FormError>{googleError}</FormError>
            </div>
          ) : null}
          <OrDivider>or with your email</OrDivider>
        </>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              autoFocus
              className="h-11"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              required
              className="h-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </FieldGroup>
        {error ? <FormError>{error}</FormError> : null}
        <Button type="submit" size="lg" className="h-11 w-full text-[14px]" disabled={busy || googleBusy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
