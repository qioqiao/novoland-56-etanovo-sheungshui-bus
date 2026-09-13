// Theme changes only presentation: the live journey and refresh loop stay mounted.
(() => {
  const root = document.documentElement;
  const storageKey = 'bus-theme-v1';
  const themes = {
    p5r: { color: '#f5f0e6', assets: './', next: '切換至經典風格' },
    classic: { color: '#f4f5f7', assets: './themes/classic/', next: '切換至 P5R 風格' },
  };
  const styles = [...document.querySelectorAll('[data-theme-style]')];
  const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let transition;
  let busy = false;
  function stopTransition() { transition?.cancel(); transition = null; }
  function remember(theme) {
    try { localStorage.setItem(storageKey, theme); } catch {}
  }
  function display(theme) {
    root.dataset.theme = theme;
    for (const link of styles) link.media = link.dataset.themeStyle === theme ? 'all' : 'not all';
    const config = themes[theme];
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', config.color);
    for (const [selector, file] of [
      ['link[rel="icon"]', 'favicon.svg'],
      ['link[rel="apple-touch-icon"]', 'apple-touch-icon.png'],
      ['link[rel="manifest"]', 'manifest.json'],
    ]) document.querySelector(selector)?.setAttribute('href', `${config.assets}${file}?v=themes1`);
    const label = document.querySelector('[data-theme-toggle-label]');
    if (label) label.textContent = config.next;
    document.getElementById('themeToggle')?.setAttribute('aria-label', config.next);
  }
  let saved;
  try { saved = localStorage.getItem(storageKey); } catch {}
  const requested = new URLSearchParams(location.search).get('theme');
  const initial = Object.hasOwn(themes, requested) ? requested : Object.hasOwn(themes, saved) ? saved : 'p5r';
  // Runs in the head, before the interface is painted or the ETA module starts.
  display(initial);
  if (Object.hasOwn(themes, requested)) remember(initial);

  let styleAttempt = 0;
  function ready(theme) {
    const pending = styles.filter(link => link.dataset.themeStyle === theme && !link.sheet);
    if (!pending.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('theme timeout')), 8000);
      const listeners = [];
      let remaining = pending.length;
      let settled = false;
      const failed = () => finish(new Error('theme stylesheet unavailable'));
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const [link, loaded] of listeners) {
          link.removeEventListener('load', loaded);
          link.removeEventListener('error', failed);
        }
        error ? reject(error) : resolve();
      }
      for (const link of pending) {
        const loaded = () => { if (--remaining === 0) finish(); };
        listeners.push([link, loaded]);
        link.addEventListener('load', loaded, { once: true });
        link.addEventListener('error', failed, { once: true });
      }
      // Retry a missing/failed sheet without replacing any active-theme styles.
      for (const link of pending) {
        const url = new URL(link.getAttribute('href'), location.href);
        url.searchParams.set('theme-load', String(++styleAttempt));
        link.setAttribute('href', url.href);
      }
    });
  }
  function setup() {
    const toggle = document.getElementById('themeToggle');
    const status = document.getElementById('themeStatus');
    if (!toggle) return;
    display(root.dataset.theme);
    toggle.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      toggle.disabled = true;
      status.textContent = '';
      status.classList.remove('is-error');
      const next = root.dataset.theme === 'classic' ? 'p5r' : 'classic';
      try {
        await ready(next);
        stopTransition();
        document.dispatchEvent(new Event('bus:themechange'));
        display(next);
        remember(next);
        const url = new URL(location.href);
        url.searchParams.set('theme', next);
        history.replaceState(null, '', url);
        document.dispatchEvent(new Event('bus:themeapplied'));
        // Keep the switch reachable when the new layout changes page height.
        toggle.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
        const shell = document.querySelector('.shell');
        if (shell?.animate && !preference?.matches && !document.hidden) {
          transition = shell.animate([{ opacity: .55 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
        }
        status.textContent = next === 'classic' ? '已切換至經典風格' : '已切換至 P5R 風格';
      } catch {
        status.textContent = '風格未能載入，請稍後再試。';
        status.classList.add('is-error');
      } finally {
        busy = false;
        toggle.disabled = false;
      }
    });
  }
  preference?.addEventListener?.('change', () => { if (preference.matches) stopTransition(); });
  window.addEventListener('resize', stopTransition);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopTransition(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true });
  else setup();
})();
