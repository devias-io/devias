import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Icon,
  type Theme,
  useTheme,
} from '@devias/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../providers/auth';
import { useWorkspace } from '../providers/workspace';
import { links } from '../router/links';
import { useNavigation } from '../router/navigation';
import { clearAuthCache } from '../router/session-cache';

export const initials = (name: string | undefined): string =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const auth = useAuth();
  const { user, slug } = useWorkspace();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const signOut = async () => {
    await auth.signOut();
    clearAuthCache();
    queryClient.clear();
    navigation.navigate(links.signIn());
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? 'icon-lg' : 'sm'}
            className={cn(
              // The avatar is a circle: its hover and open background follows it, not the button's square corners.
              compact && 'rounded-full',
              !compact &&
                'h-7 w-full justify-start gap-1.5 rounded-md px-1.5 text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent/30 group-data-[sidebar=collapsed]/shell:justify-center group-data-[sidebar=collapsed]/shell:px-0',
            )}
            aria-label="Account menu"
          />
        }
      >
        <Avatar size={compact ? 'default' : 'sm'} className={cn(!compact && 'size-4.5')}>
          {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
          {/* Without a picture the initials sit on a darker step of the brand, not on a grey that looks unfinished. */}
          <AvatarFallback
            className={cn('bg-avatar font-medium text-avatar-foreground', !compact && 'text-[0.5625rem] font-semibold')}
          >
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        {!compact ? (
          <span className={cn('truncate', 'group-data-[sidebar=collapsed]/shell:hidden')}>{user.name}</span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? 'end' : 'start'} className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="truncate font-medium text-foreground">{user.name}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigation.navigate(links.settings(slug, 'general'))}>
          <Icon name="settings" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigation.navigate(links.workspaces())}>
          <Icon name="layers" /> Switch workspace
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name={resolvedTheme === 'dark' ? 'moon' : 'sun'} /> Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()}>
          <Icon name="log-out" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
