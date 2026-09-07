const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const code = fs.readFileSync(__dirname + '/../src/native-metadata-publisher.js', 'utf8');

function harness() {
  let now = 0, id = 0, item = null, fail = false;
  const timers = new Map();
  const sent = [];
  const context = vm.createContext({
    Date: {now: () => now},
    setTimeout: (fn, ms) => { timers.set(++id, {at: now + ms, fn}); return id; },
    clearTimeout: timerId => timers.delete(timerId),
    console: {warn() {}}
  });
  vm.runInContext(code, context);
  const publisher = context.__createCiderNativeMetadataPublisher(
    () => item,
    async json => {
      if (fail) throw new Error('Native host temporarily unavailable');
      sent.push({at: now, data: JSON.parse(json)});
    }
  );
  async function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }
    now = end;
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }
  return {publisher, sent, advance, set: value => {item = value;}, fail: value => {fail = value;}};
}

const track = name => ({
  Title: name, Artist: 'Artist', Album: 'Album', Artwork: name + '.png',
  Duration: 180000, Position: 0
});

(async () => {
  const a = harness();
  a.set(track('A')); a.publisher.queue(); a.publisher.queue();
  await a.advance(100);
  a.set(track('B')); a.publisher.queue();
  await a.advance(300);
  assert.deepEqual(a.sent.map(x => x.data.Title), ['B'], 'Only the latest event in a burst should publish');
  a.set({...track('B'), Position: 5000}); a.publisher.queue();
  await a.advance(500);
  assert.equal(a.sent.length, 1, 'Progress and duplicate state notifications must not cancel artwork work');
  a.set(track('C')); a.publisher.queue('stale A payload');
  await a.advance(800);
  assert.equal(a.sent[1].data.Title, 'C', 'Publish must read authoritative current state');
  assert.ok(a.sent[1].at - a.sent[0].at >= 1250, 'Native sends must be separated');
  await a.advance(12000);
  assert.deepEqual(a.sent.map(x => x.data.Title), ['B', 'C', 'C'], 'Only the latest track gets one recovery send');
  await a.advance(30000);
  assert.equal(a.sent.length, 3, 'Recovery must not repeatedly publish forever');

  const b = harness();
  b.set(track('D')); b.fail(true); b.publisher.queue();
  await b.advance(1000); // polling during the failure must not reset the retry timer
  b.publisher.queue();
  b.fail(false); await b.advance(1400);
  assert.equal(b.sent[0].data.Title, 'D', 'Transient native failure must retry despite polling');

  const c = harness();
  c.set(track('E')); c.publisher.queue(); c.publisher.dispose(); await c.advance(15000);
  assert.equal(c.sent.length, 0, 'Reload/disposal must cancel pending sends');

  const d = harness();
  d.set(track('F')); d.publisher.queue(); d.set(null); d.publisher.queue(); await d.advance(15000);
  assert.equal(d.sent.length, 0, 'Clearing the current item must cancel stale work');
  console.log('PASS: burst coalescing, duplicate suppression, authoritative reads, native spacing, latest-only recovery, bounded retry, polling stability, disposal, and empty playback.');
})().catch(error => { console.error(error); process.exitCode = 1; });

