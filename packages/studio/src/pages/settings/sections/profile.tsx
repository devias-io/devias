import { AVATAR_MAX_BYTES, defineSettingsSection } from '@devias/core';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  Section,
} from '@devias/ui';
import { useRouter } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../../providers/auth';
import { useWorkspace } from '../../../providers/workspace';
import { clearAuthCache } from '../../../router/session-cache';
import { initials } from '../../../shell/user-menu';

const PICTURE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

/** The picture of the signed-in person: what everyone sees next to their name, set from a file or taken away. */
function PictureSettings() {
  const auth = useAuth();
  const router = useRouter();
  const { user } = useWorkspace();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const change = async (work: () => Promise<void>, done: string) => {
    setBusy(true);

    try {
      await work();
      // The session is cached between navigations: drop it and reload the route so the new picture shows up everywhere.
      clearAuthCache();
      await router.invalidate();
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change your picture');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Picture" description="Shown next to your name wherever you appear, in every workspace.">
      <div className="flex items-center gap-4 pt-2" data-slot="profile-picture">
        <Avatar size="lg" className="size-14">
          {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
          <AvatarFallback className="bg-avatar text-base font-medium text-avatar-foreground">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => picker.current?.click()}>
              <Icon name="upload" /> {user.image ? 'Change picture' : 'Upload picture'}
            </Button>
            {user.image ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void change(() => auth.removeAvatar?.() ?? Promise.resolve(), 'Picture removed')}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            A PNG, JPEG, WebP, GIF or AVIF of up to {AVATAR_MAX_BYTES / 1024 / 1024} MB.
          </p>
        </div>
        <input
          ref={picker}
          type="file"
          hidden
          accept={PICTURE_TYPES}
          aria-label="Choose a picture"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';

            if (file) {
              void change(() => auth.setAvatar?.(file) ?? Promise.resolve(), 'Picture updated');
            }
          }}
        />
      </div>
    </Section>
  );
}

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
      {auth.setAvatar ? <PictureSettings /> : null}
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
