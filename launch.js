// Opening motion has its own lifecycle; ETA fetching and rendering never wait for it.
export async function launchIntro() {
  const root = document.documentElement;
  const screen = document.querySelector('.launch-screen');
  const target = document.querySelector('.brand .brand-icon');
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set();
  const listeners = [];
  let done = false;
  let flight;
  function listen(element, event, handler, options) {
    element.addEventListener(event, handler, options);
    listeners.push(() => element.removeEventListener(event, handler, options));
  }
  function finish() {
    if (done) return;
    done = true;
    clearTimeout(window.busLaunchFallback);
    delete window.busLaunchFallback;
    root.removeAttribute('data-launch');
    for (const animation of animations) animation.cancel();
    animations.clear();
    for (const remove of listeners) remove();
    screen?.remove();
  }
  function play(element, frames, options) {
    if (done || !element) return Promise.resolve();
    const animation = element.animate(frames, { fill: 'both', ...options });
    animations.add(animation);
    // Keep completed effects until finish(), so the handoff is a single paint.
    return animation.finished.catch(() => {});
  }
  if (!root.hasAttribute('data-launch') || !screen || !target ||
      preference.matches || document.hidden || !target.animate) {
    finish();
    return;
  }
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  listen(window, 'resize', () => {
    // Reload can emit resize without changing geometry; that must not skip the intro.
    if (window.innerWidth !== viewport.width || window.innerHeight !== viewport.height) finish();
  });
  listen(window, 'orientationchange', finish);
  listen(window, 'pagehide', finish);
  listen(window, 'pageshow', event => { if (event.persisted) finish(); });
  listen(window, 'scroll', finish, { passive: true });
  listen(document, 'visibilitychange', () => { if (document.hidden) finish(); });
  listen(document, 'bus:launch-timeout', finish);
  listen(preference, 'change', () => { if (preference.matches) finish(); });
  // An intentional interaction always takes priority over the introduction.
  listen(document, 'pointerdown', finish, { capture: true });
  listen(document, 'keydown', finish, { capture: true });
  try {
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    flight = document.createElement('div');
    flight.className = 'launch-flight';
    flight.style.left = `${rect.left}px`;
    flight.style.top = `${rect.top}px`;
    flight.style.width = `${rect.width}px`;
    flight.style.height = `${rect.height}px`;
    const logo = target.cloneNode(true);
    logo.removeAttribute('id');
    flight.append(logo);
    const dx = window.innerWidth / 2 - rect.left - rect.width / 2;
    const dy = window.innerHeight / 2 - rect.top - rect.height / 2;
    const start = `translate(${dx}px, ${dy}px) scale(2.7)`;
    flight.style.transform = start;
    screen.append(flight);
    screen.querySelector('.launch-stage')?.remove();
    // One quiet breathing beat reads as loading, without an endless spinner.
    await play(logo, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.035)', offset: .62 },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: 460, easing: 'cubic-bezier(.22,1,.36,1)' });
    if (done) return;
    root.dataset.launch = 'docking';
    await play(flight, [
      { transform: start },
      { transform: 'translate(0, 0) scale(1)' },
    ], { duration: 650, easing: 'cubic-bezier(.65,0,.15,1)' });
    if (done) return;
    root.dataset.launch = 'revealing';
    // Reveal outer sections so live text and card-height animations never compete.
    const selectors = [
      '.header-status', '.brand > span:last-child', '.screen-heading',
      '.route-tabs', '.journey-panel', '.results-panel', 'footer',
    ];
    let order = 0;
    const reveals = selectors.map(selector => document.querySelector(selector))
      .filter(element => element && element.getBoundingClientRect().height > 0)
      .map(element => play(element, [
        { opacity: 0, transform: 'translateY(12px)', filter: 'blur(5px)' },
        { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
      ], { duration: 440, delay: order++ * 35, easing: 'cubic-bezier(.22,1,.36,1)' }));
    await Promise.all(reveals);
  } catch {
    // Animation support must never determine whether the timetable is usable.
  } finally {
    finish();
  }
}
launchIntro();
