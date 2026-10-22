import { Button, Field, FieldDescription, FieldGroup, FieldLabel, Input } from '@devias/ui';
import { type FormEvent, useState } from 'react';
import { useAuth } from '../../providers/auth';
import { useStudioConfig } from '../../providers/studio-config';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { clearAuthCache } from '../../router/session-cache';
import { AuthLayout, FormError, PasswordInput } from './auth-layout';

export function SignUpPage() {
  const auth = useAuth();
  const config = useStudioConfig();
  const navigation = useNavigation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await auth.signUp({ name: name.trim(), email: email.trim(), password });
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? 'Could not create the account');

      return;
    }

    clearAuthCache();
    navigation.navigate(links.workspaces(), { replace: true });
  };

  return (
    <AuthLayout
      title="Create your account"
      description={`Start with ${config.title}: create a workspace or join your team.`}
      footer={
        <>
          Already have an account?{' '}
          <navigation.Link href={links.signIn()} className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </navigation.Link>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input
              id="name"
              autoComplete="name"
              required
              autoFocus
              className="h-10"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              className="h-10"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <FieldDescription>At least 8 characters.</FieldDescription>
          </Field>
        </FieldGroup>
        {error ? <FormError>{error}</FormError> : null}
        <Button type="submit" size="lg" className="h-10 w-full" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
