import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { hostAllowed, sameOriginMutation } from '../packages/server/src/http/security.js';
import type { AppSettings } from '../packages/server/src/config/app.js';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    host: '127.0.0.1',
    port: 4500,
    allowedOrigins: [],
    discoverIntervalMs: 15_000,
    remoteSyncIntervalMs: 120_000,
    takeoverGraceMs: 4_000,
    serviceReadinessTimeoutMs: 120_000,
    ...overrides,
  };
}

type FakeRequest = { headers: Record<string, string | undefined> };

function request(headers: Record<string, string | undefined>): FakeRequest {
  return { headers };
}

describe('hostAllowed', () => {
  test('accepts loopback host headers on the configured port', () => {
    const config = settings();
    assert.equal(hostAllowed(request({ host: 'localhost:4500' }) as never, config), true);
    assert.equal(hostAllowed(request({ host: '127.0.0.1:4500' }) as never, config), true);
  });

  test('rejects rebinding-style and foreign hosts', () => {
    const config = settings();
    assert.equal(hostAllowed(request({ host: 'evil.example:4500' }) as never, config), false);
    assert.equal(hostAllowed(request({ host: '127.0.0.1:4444' }) as never, config), false);
    assert.equal(hostAllowed(request({}) as never, config), false);
  });

  test('rejects the wrong port for the configured bind', () => {
    assert.equal(hostAllowed(request({ host: 'localhost:4500' }) as never, settings({ port: 4600 })), false);
  });
});

describe('sameOriginMutation', () => {
  test('allows a matching Origin header', () => {
    const config = settings();
    assert.equal(sameOriginMutation(request({ origin: 'http://127.0.0.1:4500', host: '127.0.0.1:4500' }) as never, config), true);
    assert.equal(sameOriginMutation(request({ origin: 'http://localhost:4500', host: 'localhost:4500' }) as never, config), true);
  });

  test('allows requests without Origin from loopback (CLI/curl)', () => {
    const config = settings();
    assert.equal(sameOriginMutation(request({ host: '127.0.0.1:4500' }) as never, config), true);
  });

  test('rejects requests without Origin bound to a non-loopback host', () => {
    const config = settings({ host: '0.0.0.0' });
    assert.equal(sameOriginMutation(request({ host: '192.168.1.5:4500' }) as never, config), false);
  });

  test('rejects cross-site origins — the CSRF case', () => {
    const config = settings();
    assert.equal(sameOriginMutation(request({ origin: 'https://evil.example', host: '127.0.0.1:4500' }) as never, config), false);
    assert.equal(sameOriginMutation(request({ origin: 'http://127.0.0.1:4444', host: '127.0.0.1:4500' }) as never, config), false);
    assert.equal(sameOriginMutation(request({ origin: 'null', host: '127.0.0.1:4500' }) as never, config), false);
  });

  test('honors Sec-Fetch-Site metadata from modern browsers', () => {
    const config = settings();
    assert.equal(
      sameOriginMutation(request({ origin: 'http://127.0.0.1:4500', host: '127.0.0.1:4500', 'sec-fetch-site': 'same-origin' }) as never, config),
      true,
    );
    assert.equal(
      sameOriginMutation(request({ origin: 'http://127.0.0.1:4500', host: '127.0.0.1:4500', 'sec-fetch-site': 'cross-site' }) as never, config),
      false,
    );
  });

  test('supports explicitly configured dev origins only', () => {
    const config = settings({ allowedOrigins: ['http://localhost:5173'] });
    assert.equal(sameOriginMutation(request({ origin: 'http://localhost:5173', host: '127.0.0.1:4500' }) as never, config), true);
    assert.equal(sameOriginMutation(request({ origin: 'http://localhost:5174', host: '127.0.0.1:4500' }) as never, config), false);
  });
});
