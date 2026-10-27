import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
} from '@devias/ui';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../providers/auth';
import { useWorkspace } from '../providers/workspace';
import { keys } from '../query/keys';
import { links } from '../router/links';
import { useNavigation } from '../router/navigation';

/** The workspace's name, styled as a sidebar row, opening the list of workspaces. */
export function WorkspaceSwitcher() {
  const auth = useAuth();
  const { organization } = useWorkspace();
  const navigation = useNavigation();
  const organizations = useQuery({ queryKey: keys.organizations(), queryFn: () => auth.organizations.list() });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-medium text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent/30 focus-visible:ring-3 focus-visible:ring-sidebar-ring/30 aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
          />
        }
      >
        <span className="min-w-0 truncate">{organization.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {(organizations.data ?? [organization]).map((org) => (
            <DropdownMenuItem key={org.id} onClick={() => navigation.navigate(links.workspace(org.slug))}>
              <span className="truncate">{org.name}</span>
              {org.id === organization.id ? <Icon name="check" className="ml-auto size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigation.navigate(links.workspaces())}>
          <Icon name="plus" /> Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
