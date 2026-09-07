const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

let sample, tick, pagehide, disposed = false;
const window = {
  location: {hostname: '127.0.0.1'},
  addEventListener: (event, fn) => { if (event === 'pagehide') pagehide = fn; }
};
const context = {
  window,
  setInterval: fn => { tick = fn; return 1; },
  clearInterval: () => { tick = null; },
  __createCiderNativeMetadataPublisher: read => ({
    queue: () => { sample = read(); },
    dispose: () => { disposed = true; }
  })
};
const source = fs.readFileSync(__dirname + '/../src/native-metadata-preload.js', 'utf8');
vm.runInNewContext(source, context);
assert.equal(sample, null);

window.CiderApp = {
  musicKitStore: {},
  RPC: {
    nowPlayingAttributes: {
      name: 'Rain after Summer', artistName: '羽肿',
      artwork: {url: 'https://example.test/{w}x{h}bb.{f}'},
      durationInMillis: 345000
    }
  }
};
tick();
assert.equal(sample.Title, 'Rain after Summer');
assert.equal(sample.Artist, '羽肿');
assert.equal(sample.Artwork, 'https://example.test/600x600bb.png');

window.CiderApp.RPC.nowPlayingAttributes = {name: 'Butterflies', artistName: 'Nohidea'};
tick();
assert.equal(sample.Title, 'Butterflies');
assert.equal(sample.Artwork, null);

const original = window.__ciderNativeMetadataRepair;
vm.runInNewContext(source, context);
assert.equal(window.__ciderNativeMetadataRepair, original, 'duplicate preload must be ignored');
pagehide();
assert.equal(tick, null);
assert.equal(disposed, true);
console.log('PASS: late SPA startup, unified provider data, artwork formatting, automatic track change, duplicate initialization, and unload cleanup.');

