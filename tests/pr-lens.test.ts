import { describe, expect, test } from 'vitest';
import { prLensLink } from '../packages/ui/src/pr-lens.js';

describe('PR Lens desktop handoff', () => {
  test('preserves the PR identity and strips browser-only query and fragment', () => {
    expect(prLensLink('https://github.com/example/project/pull/42?tab=files#diff-123'))
      .toBe('pr-lens://review/example/project/pull/42');
  });
  test.each([
    'https://github.com.evil.test/example/project/pull/42',
    'https://user:pass@github.com/example/project/pull/42',
    'http://github.com/example/project/pull/42',
    'https://github.com/example/project/pull/0',
    'https://github.com/example/project/issues/42',
    'https://github.com/example/project/pull/42/files',
    'file:///tmp/repo', 'not a URL',
  ])('does not hand off unsupported targets: %s', (url) => {
    expect(prLensLink(url)).toBeNull();
  });
});
