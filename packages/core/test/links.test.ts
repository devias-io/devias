import { describe, expect, it } from 'vitest';
import {
  linkHref,
  linkOfMention,
  linksIn,
  markdownToRichText,
  mentionAttrsOf,
  mentionsOf,
  parseLink,
  parseManifest,
  richTextToMarkdown,
} from '../src';

describe('links to records, workflows and documents', () => {
  it('writes and reads the three kinds', () => {
    const targets = [
      { kind: 'record', object: 'person', id: 'p1' },
      { kind: 'workflow', id: 'w1' },
      { kind: 'document', id: 'd1' },
      { kind: 'task', id: 't1' },
      { kind: 'member', id: 'u1' },
      { kind: 'agent', id: 'a1' },
      { kind: 'asset', id: 'f1' },
    ] as const;

    expect(targets.map(linkHref)).toEqual([
      'record:person/p1',
      'workflow:w1',
      'document:d1',
      'task:t1',
      'member:u1',
      'agent:a1',
      'asset:f1',
    ]);

    for (const target of targets) {
      expect(parseLink(linkHref(target))).toEqual(target);
    }

    expect(parseLink('https://example.com')).toBeNull();
    expect(parseLink('record:person')).toBeNull();
  });

  it('keeps the reserved object of a mention for what is not a record', () => {
    expect(mentionAttrsOf({ kind: 'workflow', id: 'w1' }, 'Nightly')).toEqual({
      object: 'workflow',
      id: 'w1',
      label: 'Nightly',
    });
    expect(mentionAttrsOf({ kind: 'document', id: 'd1' }, 'Plan')).toEqual({
      object: 'document',
      id: 'd1',
      label: 'Plan',
    });
    expect(linkOfMention('document', 'd1')).toEqual({ kind: 'document', id: 'd1' });
    expect(linkOfMention('workflow', 'w1')).toEqual({ kind: 'workflow', id: 'w1' });
    expect(linkOfMention('task', 't1')).toEqual({ kind: 'task', id: 't1' });
    expect(linkOfMention('member', 'u1')).toEqual({ kind: 'member', id: 'u1' });
    expect(linkOfMention('agent', 'a1')).toEqual({ kind: 'agent', id: 'a1' });
    expect(linkOfMention('asset', 'f1')).toEqual({ kind: 'asset', id: 'f1' });
    expect(mentionAttrsOf({ kind: 'asset', id: 'f1' }, 'Logo')).toEqual({ object: 'asset', id: 'f1', label: 'Logo' });
    expect(mentionAttrsOf({ kind: 'agent', id: 'a1' }, 'Sales')).toEqual({ object: 'agent', id: 'a1', label: 'Sales' });
    expect(mentionAttrsOf({ kind: 'member', id: 'u1' }, 'Ana')).toEqual({ object: 'member', id: 'u1', label: 'Ana' });
    expect(mentionAttrsOf({ kind: 'task', id: 't1' }, 'Call')).toEqual({ object: 'task', id: 't1', label: 'Call' });
    expect(linkOfMention('person', 'p1')).toEqual({ kind: 'record', object: 'person', id: 'p1' });
  });

  it('finds the links of a text with their places', () => {
    const text =
      'See [Ana](record:person/p1), [Plan](document:d1) and [a site](https://example.com) or [Run](workflow:w1) and [Call](task:t1) and [Ana](member:u1) and [Sales](agent:a1).';
    const found = linksIn(text);

    expect(found.map((link) => [link.label, linkHref(link.target)])).toEqual([
      ['Ana', 'record:person/p1'],
      ['Plan', 'document:d1'],
      ['Run', 'workflow:w1'],
      ['Call', 'task:t1'],
      ['Ana', 'member:u1'],
      ['Sales', 'agent:a1'],
    ]);
    expect(text.slice(found[1]?.start, found[1]?.end)).toBe('[Plan](document:d1)');
  });

  it('turns the three kinds into mentions and back through Markdown', () => {
    const source =
      'A [Ana](record:person/p1), a [Plan](document:d1), a [Run](workflow:w1), a [Call](task:t1), a [Ana](member:u1) and a [Sales](agent:a1).';
    const doc = markdownToRichText(source);

    expect(mentionsOf(doc)).toEqual([
      { object: 'person', id: 'p1', label: 'Ana' },
      { object: 'document', id: 'd1', label: 'Plan' },
      { object: 'workflow', id: 'w1', label: 'Run' },
      { object: 'task', id: 't1', label: 'Call' },
      { object: 'member', id: 'u1', label: 'Ana' },
      { object: 'agent', id: 'a1', label: 'Sales' },
    ]);
    expect(richTextToMarkdown(doc)).toBe(source);
  });
});

describe('reserved object names', () => {
  it('refuses a manifest object named like what a mention can point at', () => {
    const declare = (name: string) =>
      parseManifest({
        id: '01a1751f-5f11-731b-b87a-359da5e6aabd',
        version: '0.1.0',
        objects: [
          { id: `books.${name}`, nameSingular: name, namePlural: `${name}s`, labelSingular: 'X', labelPlural: 'Xs' },
        ],
      });

    for (const name of ['workflow', 'document', 'task', 'member', 'agent', 'asset']) {
      expect(() => declare(name), name).toThrow(/reserved/);
    }

    expect(declare('book').objects).toHaveLength(1);
  });
});
