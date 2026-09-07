// Read Cider's current player after the SPA (including update.cup) has loaded.
// This runs inside Cider; it does not create another WNP player or process.
(() => {
  if (window.location.hostname !== '127.0.0.1' || window.__ciderNativeMetadataRepair) return;
  const readCurrent = () => {
    const rpc = window.CiderApp?.RPC;
    const a = rpc?.nowPlayingAttributes;
    if (!a?.name) return null;
    const artwork = a.artwork || {};
    const url = typeof artwork.url === 'string'
      ? artwork.url.replace(/\{w\}/g, '600').replace(/\{h\}/g, '600')
          .replace(/\{f\}/g, 'png').replace(/\{c\}/g, 'bb')
      : '';
    return {
      Title: a.name, Artist: a.artistName || '', Album: a.albumName || '',
      Artwork: url || null, HeroArtwork: null,
      Duration: a.durationInMillis ?? a.durationInMilliseconds,
      Position: Math.round((rpc.currentPlaybackTime || 0) * 1000),
      InLibrary: a.inLibrary, InFavorites: a.inFavorites,
      BgColor: artwork.bgColor ?? null, TextColor1: artwork.textColor1 ?? null,
      TextColor2: artwork.textColor2 ?? null, TextColor3: artwork.textColor3 ?? null,
      TextColor4: artwork.textColor4 ?? null
    };
  };
  const publisher = __createCiderNativeMetadataPublisher(readCurrent,
    json => window.chrome.webview.hostObjects.playbackState.SetNowPlaying(json));
  const timer = setInterval(() => publisher.queue(), 1000);
  window.__ciderNativeMetadataRepair = {version: '2026-09-07.3', publisher};
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    publisher.dispose();
    delete window.__ciderNativeMetadataRepair;
  }, {once: true});
  publisher.queue();
})();

