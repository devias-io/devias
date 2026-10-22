import { describe, expect, it } from 'vitest';
import { workspaceErrorMessage } from '../src/auth/pages/workspace-errors';

describe('workspaceErrorMessage', () => {
  it('explains that a taken address may belong to another account', () => {
    expect(workspaceErrorMessage(new Error('Organization already exists'), 'unedo', 'x')).toContain('“unedo” is taken');
    expect(workspaceErrorMessage(new Error('slug is taken'), 'acme', 'x')).toContain('another workspace');
  });

  it('passes other messages through, with a fallback', () => {
    expect(workspaceErrorMessage(new Error('Network down'), 'acme', 'Could not create')).toBe('Network down');
    expect(workspaceErrorMessage('boom', 'acme', 'Could not create')).toBe('Could not create');
  });
});
