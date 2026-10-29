import { describe, expect, it } from 'vitest';
import { createFileUrlSigner } from '../src';

const file = { id: '01a173ad-5d3f-7091-8466-4dcdeb689686', workspaceId: 'ws_1' };
const parts = (url: string) => {
  const parsed = new URL(url, 'http://localhost');

  return {
    path: parsed.pathname,
    exp: parsed.searchParams.get('exp') ?? '',
    sig: parsed.searchParams.get('sig') ?? '',
  };
};

describe('file url signer', () => {
  const at = (iso: string) => () => new Date(iso);
  const signer = (iso: string, extra = {}) => createFileUrlSigner({ secret: 'secret', clock: at(iso), ...extra });

  it('makes a link that opens the file until it expires', () => {
    const { url, expiresAt } = signer('2026-10-29T10:00:00Z').link(file, 600);
    const { path, exp, sig } = parts(url);

    expect(path).toBe(`/files/${file.id}`);
    expect(expiresAt).toBe('2026-10-29T10:10:00.000Z');
    expect(signer('2026-10-29T10:09:59Z').verify(file, exp, sig)).toBe(true);
    expect(signer('2026-10-29T10:10:01Z').verify(file, exp, sig)).toBe(false);
  });

  it('refuses a link that was changed or is for something else', () => {
    const { url } = signer('2026-10-29T10:00:00Z').link(file, 600);
    const { exp, sig } = parts(url);
    const now = signer('2026-10-29T10:01:00Z');

    expect(now.verify({ ...file, id: '01a173ad-5d3f-7091-8466-502573300bd7' }, exp, sig)).toBe(false);
    expect(now.verify({ ...file, workspaceId: 'ws_2' }, exp, sig)).toBe(false);
    expect(now.verify(file, String(Number(exp) + 3600), sig)).toBe(false);
    expect(now.verify(file, exp, `${sig.slice(0, -2)}AA`)).toBe(false);
    expect(now.verify(file, exp, '')).toBe(false);
    expect(now.verify(file, 'soon', sig)).toBe(false);
    expect(createFileUrlSigner({ secret: 'another', clock: at('2026-10-29T10:01:00Z') }).verify(file, exp, sig)).toBe(
      false,
    );
  });

  it('caps how long a link lasts', () => {
    const { expiresAt } = signer('2026-10-29T10:00:00Z', { maxLinkSeconds: 3600 }).link(file, 999_999);

    expect(expiresAt).toBe('2026-10-29T11:00:00.000Z');
  });

  it('gives embedded content one link all bucket long, so browsers keep the file', () => {
    const morning = signer('2026-10-29T01:00:00Z').url(file);
    const evening = signer('2026-10-29T23:00:00Z').url(file);
    const nextDay = signer('2026-10-30T01:00:00Z').url(file);

    expect(evening).toBe(morning);
    expect(nextDay).not.toBe(morning);
    // A link from one bucket still works through the next one, and not after.
    const { exp, sig } = parts(morning);
    expect(signer('2026-10-30T23:00:00Z').verify(file, exp, sig)).toBe(true);
    expect(signer('2026-10-31T00:00:01Z').verify(file, exp, sig)).toBe(false);
  });

  it('gives a public file one plain link that never changes, and still signs a link that is asked for', () => {
    const publicFile = { ...file, public: true };
    const morning = signer('2026-10-29T01:00:00Z').url(publicFile);

    expect(morning).toBe(`/files/${file.id}`);
    expect(signer('2027-05-01T01:00:00Z').url(publicFile)).toBe(morning);
    expect(signer('2026-10-29T10:00:00Z', { baseUrl: 'https://api.example.com' }).url(publicFile)).toBe(
      `https://api.example.com/files/${file.id}`,
    );
    expect(signer('2026-10-29T10:00:00Z').link(publicFile, 600).url).toMatch(/\?exp=\d+&sig=/);
    // A private file is signed.
    expect(signer('2026-10-29T10:00:00Z').url(file)).toMatch(/\?exp=\d+&sig=/);
  });

  it('can make absolute links', () => {
    expect(signer('2026-10-29T10:00:00Z', { baseUrl: 'https://api.example.com/' }).url(file)).toMatch(
      /^https:\/\/api\.example\.com\/files\//,
    );
  });
});
