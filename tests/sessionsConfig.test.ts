import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ConfigError,
  DEFAULTS,
  candidateConfigPaths,
  parseSessionsConfig,
  stripJsonComments,
} from '../src/main/config/sessionsConfig.ts';

const minimal = { targets: [{ id: 'app', label: 'App', url: 'https://example.com/' }] };

describe('parseSessionsConfig', () => {
  it('applies defaults and marks targets enabled', () => {
    const config = parseSessionsConfig(minimal, 'test');
    assert.deepEqual(config.defaults, DEFAULTS);
    assert.equal(config.targets[0]?.enabled, true);
    assert.equal(config.targets[0]?.label, 'App');
  });

  it('falls back to the id when no label is given', () => {
    const config = parseSessionsConfig({ targets: [{ id: 'crm', url: 'https://crm.example.com/' }] }, 'test');
    assert.equal(config.targets[0]?.label, 'crm');
  });

  it('merges partial defaults rather than replacing the whole block', () => {
    const config = parseSessionsConfig({ defaults: { concurrency: 4 }, ...minimal }, 'test');
    assert.equal(config.defaults.concurrency, 4);
    assert.equal(config.defaults.timeoutMs, DEFAULTS.timeoutMs);
  });

  it('rejects ids that would escape the profile directory', () => {
    assert.throws(
      () => parseSessionsConfig({ targets: [{ id: '../../etc', url: 'https://example.com/' }] }, 'test'),
      (error: unknown) => error instanceof ConfigError && /id must be a slug/.test(error.message),
    );
  });

  it('rejects duplicate ids, since they share a profile directory', () => {
    assert.throws(
      () =>
        parseSessionsConfig(
          { targets: [{ id: 'a', url: 'https://a.example.com/' }, { id: 'a', url: 'https://b.example.com/' }] },
          'test',
        ),
      /duplicated/,
    );
  });

  it('rejects non-http schemes', () => {
    assert.throws(
      () => parseSessionsConfig({ targets: [{ id: 'a', url: 'file:///etc/passwd' }] }, 'test'),
      /must be http\(s\)/,
    );
  });

  it('rejects a malformed url', () => {
    assert.throws(() => parseSessionsConfig({ targets: [{ id: 'a', url: 'not a url' }] }, 'test'), /not a valid absolute URL/);
  });

  it('reports every problem at once, with its JSON path', () => {
    try {
      parseSessionsConfig(
        {
          defaults: { concurrency: 0 },
          targets: [
            { id: 'ok', url: 'https://ok.example.com/', timeoutMs: 5 },
            { id: 'bad id', url: 'https://bad.example.com/' },
          ],
        },
        'test',
      );
      assert.fail('expected a ConfigError');
    } catch (error) {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.issues.length, 3);
      assert.ok(error.issues.some((issue) => issue.includes('defaults.concurrency')));
      assert.ok(error.issues.some((issue) => issue.includes('targets[0].timeoutMs')));
      assert.ok(error.issues.some((issue) => issue.includes('targets[1].id')));
    }
  });

  it('keeps a validated probe intact', () => {
    const config = parseSessionsConfig(
      {
        targets: [
          {
            id: 'a',
            url: 'https://a.example.com/',
            probe: { readySelector: '[data-user]', loggedOutUrlPattern: ['*/login*'] },
          },
        ],
      },
      'test',
    );
    assert.deepEqual(config.targets[0]?.probe, { readySelector: '[data-user]', loggedOutUrlPattern: ['*/login*'] });
  });

  it('requires targets to be an array', () => {
    assert.throws(() => parseSessionsConfig({ targets: {} }, 'test'), /`targets` must be an array/);
  });
});

describe('stripJsonComments', () => {
  it('removes line and block comments', () => {
    const source = `{
      // a line comment
      "a": 1, /* inline */
      "b": 2
      /* multi
         line */
    }`;
    assert.deepEqual(JSON.parse(stripJsonComments(source)), { a: 1, b: 2 });
  });

  it('leaves comment-like sequences inside strings alone', () => {
    const source = '{ "url": "https://example.com/a//b", "note": "/* not a comment */" }';
    assert.deepEqual(JSON.parse(stripJsonComments(source)), {
      url: 'https://example.com/a//b',
      note: '/* not a comment */',
    });
  });

  it('handles escaped quotes without losing track of the string', () => {
    const source = '{ "a": "he said \\"//\\" loudly", "b": 1 }';
    assert.deepEqual(JSON.parse(stripJsonComments(source)), { a: 'he said "//" loudly', b: 1 });
  });
});

describe('candidateConfigPaths', () => {
  it('prefers an explicit path, then the state root, then the project', () => {
    const paths = candidateConfigPaths({ stateRoot: '/state', cwd: '/repo', explicitPath: '/tmp/x.json' });
    assert.equal(paths[0], '/tmp/x.json');
    assert.equal(paths[1], '/state/sessions.json');
    assert.equal(paths[2], '/repo/config/sessions.json');
    assert.equal(paths[3], '/repo/config/sessions.example.json');
  });

  it('omits the explicit slot when none was given', () => {
    const paths = candidateConfigPaths({ stateRoot: '/state', cwd: '/repo' });
    assert.equal(paths.length, 3);
  });

  it('falls back to a packaged build resources dir', () => {
    // Regression: a packaged app's cwd is not the repo, so without this the
    // example shipped via electron-builder `extraResources` is unreachable and a
    // first run finds no config at all - which is a fatal error dialog.
    const paths = candidateConfigPaths({ stateRoot: '/state', cwd: '/state', resourcesDir: '/app/resources/config' });
    assert.deepEqual(paths.slice(-2), [
      '/app/resources/config/sessions.json',
      '/app/resources/config/sessions.example.json',
    ]);
  });

  it('still prefers the user copy over the shipped example', () => {
    const paths = candidateConfigPaths({ stateRoot: '/state', cwd: '/state', resourcesDir: '/app/resources/config' });
    assert.ok(
      paths.indexOf('/state/sessions.json') < paths.indexOf('/app/resources/config/sessions.example.json'),
    );
  });
});
