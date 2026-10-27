import { defineSettingsSection } from '@devias/core';
import { Button, Field, FieldDescription, FieldGroup, FieldLabel, Input, Section } from '@devias/ui';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../../providers/auth';
import { useWorkspace } from '../../../providers/workspace';
import { clearAuthCache } from '../../../router/session-cache';

function ProfileSettings() {
  const auth = useAuth();
  const router = useRouter();
  const { user } = useWorkspace();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const trimmedEmail = email.trim();
  const nameChanged = trimmed !== user.name;
  const emailChanged = trimmedEmail !== user.email;
  const valid = Boolean(trimmed) && /^\S+@\S+\.\S+$/.test(trimmedEmail);

  const save = async () => {
    setSaving(true);

    try {
      if (nameChanged) {
        await auth.updateUser({ name: trimmed });
      }

      if (emailChanged) {
        await auth.changeEmail(trimmedEmail);
      }

      // The session is cached between navigations: drop it and reload the route so the new name shows up.
      clearAuthCache();
      await router.invalidate();
      toast.success('Profile updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update your profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Personal details" description="How you appear to others in this workspace.">
        <FieldGroup className="gap-3 pt-2">
          <Field>
            <FieldLabel htmlFor="profile-name">Name</FieldLabel>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-email">Email</FieldLabel>
            <Input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <FieldDescription>Your email is also what you sign in with.</FieldDescription>
          </Field>
          <Button
            size="sm"
            className="self-start"
            disabled={!(nameChanged || emailChanged) || saving || !valid}
            onClick={() => void save()}
          >
            Save
          </Button>
        </FieldGroup>
      </Section>
    </div>
  );
}

export const profileSection = defineSettingsSection({
  name: 'profile',
  label: 'Profile',
  icon: 'user',
  group: 'account',
  component: ProfileSettings,
});
