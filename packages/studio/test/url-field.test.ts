import { describe, expect, it } from 'vitest';
import { externalHref, shortAddress } from '../src/fields/links';

describe('url field', () => {
  it('links to https unless the address says otherwise', () => {
    expect(externalHref('acme.com')).toBe('https://acme.com');
    expect(externalHref('http://acme.com/x')).toBe('http://acme.com/x');
  });

  it('shows an address without its scheme, www and closing slash', () => {
    expect(shortAddress('https://www.acme.com/')).toBe('acme.com');
    expect(shortAddress('http://acme.com/pricing')).toBe('acme.com/pricing');
    expect(shortAddress('linkedin.com/company/acme/')).toBe('linkedin.com/company/acme');
  });
});
