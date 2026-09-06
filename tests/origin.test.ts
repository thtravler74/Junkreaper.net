import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSameOrigin } from '../src/main/origin.ts';

describe('isSameOrigin', () => {
  it('accepts the packaged renderer on the custom app:// scheme', () => {
    // The regression this exists for: `new URL('app://bundle/index.html').origin`
    // is the string "null", because `app:` is not a "special" scheme. Comparing
    // origins directly would reject every IPC call in a packaged build.
    assert.equal(new URL('app://bundle/index.html').origin, 'null', 'assumption behind this helper');
    assert.equal(isSameOrigin('app://bundle/index.html', 'app://bundle'), true);
    assert.equal(isSameOrigin('app://bundle/assets/index-abc.js', 'app://bundle'), true);
  });

  it('accepts the dev server, path and query notwithstanding', () => {
    assert.equal(isSameOrigin('http://localhost:5173/', 'http://localhost:5173'), true);
    assert.equal(isSameOrigin('http://localhost:5173/index.html?x=1#y', 'http://localhost:5173'), true);
  });

  it('rejects a different host, port or scheme', () => {
    assert.equal(isSameOrigin('app://evil/index.html', 'app://bundle'), false);
    assert.equal(isSameOrigin('http://localhost:9999/', 'http://localhost:5173'), false);
    assert.equal(isSameOrigin('https://localhost:5173/', 'http://localhost:5173'), false);
    assert.equal(isSameOrigin('https://bundle/', 'app://bundle'), false);
  });

  it('rejects unparseable input and a missing sender frame', () => {
    assert.equal(isSameOrigin('not a url', 'app://bundle'), false);
    assert.equal(isSameOrigin(undefined, 'app://bundle'), false);
    assert.equal(isSameOrigin('', 'app://bundle'), false);
  });

  it('does not treat a look-alike host as the real one', () => {
    assert.equal(isSameOrigin('app://bundle.evil.com/index.html', 'app://bundle'), false);
  });
});
