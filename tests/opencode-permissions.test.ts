import { expect, test } from 'vitest';
import { openCodePermissionRequest, openCodeRule, parseOpenCodeRule, permissionLabel } from '../desktop/src/lib/opencode-permissions';
import { isValidRule, ruleFor } from '../desktop/src/lib/server/stage-permission-rules';

test('parses OpenCode logged permission requests without broadening patterns', () => {
  const request = openCodePermissionRequest(String.raw`timestamp=now message=asking id=per_test permission=read patterns="[\".env.template\"]"`);
  expect(request).toEqual({ permission: 'read', patterns: ['.env.template'] });
  expect(openCodePermissionRequest('message=evaluated permission=read action.action=ask')).toBeUndefined();
  expect(openCodePermissionRequest('message=asking permission=read patterns="broken"')).toBeUndefined();
});

test('provider-tagged grants round-trip special characters and keep readable UI labels', () => {
  const pattern = '/path/with spaces/(template).env';
  const rule = ruleFor({ provider: 'opencode', tool_name: 'read', tool_input: { pattern } });
  expect(parseOpenCodeRule(rule)).toEqual({ permission: 'read', pattern });
  expect(permissionLabel(rule)).toBe(`read: ${pattern}`);
  expect(isValidRule(rule)).toBe(true);
  expect(isValidRule('OpenCode(read:%XX)')).toBe(false);
  expect(isValidRule(openCodeRule('read', '\n'))).toBe(false);
  expect(isValidRule('Bash(git *)')).toBe(true);
  expect(parseOpenCodeRule('Read')).toBeUndefined();
});
