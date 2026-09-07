// Cider 4.x Windows metadata repair helper.
// Coalesce duplicate playback events before crossing the native 100 ms throttle.
// Re-read the current item when sending so late events cannot publish old tracks.
function __createCiderNativeMetadataPublisher(readCurrent, publish) {
  let pending = null;
  let recovery = null;
  let retry = null;
  let wantedKey = '';
  let lastSentKey = '';
  let lastSentAt = -Infinity;
  let generation = 0;
  let failures = 0;

  const keyOf = (item) => item && item.Title
    ? JSON.stringify([item.Title, item.Artist, item.Album, item.Artwork, item.Duration])
    : '';
  const current = () => {
    try { return readCurrent(); } catch { return null; }
  };
  const cancelTimers = () => {
    clearTimeout(pending);
    clearTimeout(recovery);
    clearTimeout(retry);
    pending = recovery = retry = null;
  };

  async function send(revision, isRecovery) {
    if (revision !== generation) return;
    pending = null;
    const item = current();
    const key = keyOf(item);
    if (!key) return;
    if (key !== wantedKey) { queue(); return; }
    if (!isRecovery && key === lastSentKey) return;
    try {
      await publish(JSON.stringify(item));
      if (revision !== generation) return;
      lastSentKey = key;
      lastSentAt = Date.now();
      failures = 0;
      // Cider's native metadata pipeline can lose a change during cancellation.
      // Retry once after its artwork timeout has had time to settle.
      if (!isRecovery) recovery = setTimeout(() => send(revision, true), 12000);
    } catch (error) {
      if (revision !== generation) return;
      if (++failures <= 3) retry = setTimeout(() => send(revision, true), 2000);
      console.warn('[Cider native metadata repair] Publish failed', error);
    }
  }

  function queue() {
    const key = keyOf(current());
    if (!key) {
      ++generation;
      wantedKey = lastSentKey = '';
      cancelTimers();
      return;
    }
    // The adapter polls once per second. Keep a pending retry/recovery alive
    // while the current item is unchanged instead of resetting it on every poll.
    if (key === wantedKey) return;
    ++generation;
    wantedKey = key;
    failures = 0;
    cancelTimers();
    const revision = generation;
    // Native audio-source replacement can still be finishing after a switch.
    const delay = Math.max(300, 1250 - (Date.now() - lastSentAt));
    pending = setTimeout(() => send(revision, false), delay);
  }

  return {
    queue,
    currentKey: () => keyOf(current()),
    dispose: () => { ++generation; cancelTimers(); }
  };
}

