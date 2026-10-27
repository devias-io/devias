import type { AiToolInfo } from '@devias/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolRow } from '../src/pages/agents/tool-access';

afterEach(cleanup);

const tool = (over: Partial<AiToolInfo>): AiToolInfo => ({
  name: 'list_records',
  description: 'List records.',
  area: 'records',
  readOnly: true,
  escalates: false,
  approval: 'auto',
  locked: false,
  moduleId: null,
  ...over,
});

const row = (info: AiToolInfo) =>
  render(
    <ul>
      <ToolRow tool={info} area="Area" mode="auto" own={false} onMode={() => {}} />
    </ul>,
  );

describe('a tool in the agent’s tool list', () => {
  it('names the module of a module’s tool from its info, whatever the tool is called', () => {
    row(tool({ name: 'send_email', description: 'Resend: Send an email.', area: 'modules', moduleId: 'email-resend' }));
    expect(screen.getAllByText('Send email').length).toBeGreaterThan(0);
    expect(screen.getByText('email-resend')).toBeTruthy();
  });

  it('names no module for a core tool', () => {
    row(tool({}));
    expect(screen.getAllByText('List records').length).toBeGreaterThan(0);
    expect(screen.queryByText('email-resend')).toBeNull();
  });
});
