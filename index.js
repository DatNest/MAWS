/** MAWS Universal Lite: isolated SillyTavern extension bootstrap. */
(async () => {
  // ST may load user extensions while the chat UI is still mounting.
  for (let tries=0;tries<80;tries++) {
    if (window.SillyTavern?.getContext && document.getElementById('chat')) {
      await import('./engine.js');
      return;
    }
    await new Promise(resolve=>window.setTimeout(resolve,125));
  }
  console.warn('[MAWS] Chat UI unavailable. Extension will load after a page refresh.');
})().catch(error=>console.error('[MAWS] Failed to initialize extension:',error));
