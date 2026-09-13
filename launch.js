// One opening lifecycle chooses a visual profile; ETA fetching never waits for it.
export async function launchIntro() {
  const root = document.documentElement;
  const smooth = root.dataset.theme === 'classic';
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
  // A theme swap cancels this opening; it never starts a second overlay or engine.
  listen(document, 'bus:themechange', finish);
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
    for (const color of smooth ? [] : ['red', 'black']) {
      const slash = document.createElement('span');
      slash.className = `launch-slash launch-slash-${color}`;
      screen.append(slash);
    }
    screen.append(flight);
    screen.querySelector('.launch-stage')?.remove();
    // Classic breathes quietly; P5R holds while two hard-edged plates cut past it.
    await play(logo, smooth ? [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.035)', offset: .62 },
      { opacity: 1, transform: 'scale(1)' },
    ] : [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.055)', offset: .3 },
      { opacity: 1, transform: 'scale(1)', offset: .5 },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: smooth ? 460 : 430, easing: smooth ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.16,.86,.22,1)' });
    if (done) return;
    root.dataset.launch = 'docking';
    await play(flight, [
      { transform: start },
      { transform: 'translate(0, 0) scale(1)' },
    ], { duration: smooth ? 650 : 500, easing: smooth ? 'cubic-bezier(.65,0,.15,1)' : 'cubic-bezier(.68,0,.18,1)' });
    if (done) return;
    root.dataset.launch = 'revealing';
    // Move each section as one piece, including its protruding accents and shadows.
    // Cut masks belong to individual surfaces, not these outer containers.
    const selectors = [
      '.header-status', '.brand > span:last-child', '.screen-heading',
      '.route-tabs', ...(smooth ? ['.journey-panel', '.results-panel'] : ['.results-panel', '.journey-panel']), 'footer',
    ];
    let order = 0;
    const reveals = selectors.map(selector => document.querySelector(selector))
      .filter(element => element && element.getBoundingClientRect().height > 0)
      .map(element => {
        const frames = smooth ? [
          { opacity: 0, transform: 'translateY(12px)', filter: 'blur(5px)' },
          { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
        ] : [
          { opacity: 0, transform: 'translate(12px, 5px)' },
          { opacity: 1, transform: 'translate(-1px, 0)', offset: .8 },
          { opacity: 1, transform: 'translate(0, 0)' },
        ];
        return play(element, frames, { duration: smooth ? 440 : 280, delay: order++ * 35, easing: smooth ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.16,.86,.22,1)' });
      });
    if (!smooth) reveals.push(play(document.querySelector('.topbar-rule'), [
      { transform: 'scaleX(0)' },
      { transform: 'scaleX(1)' },
    ], { duration: 420, easing: 'cubic-bezier(.3,0,.2,1)' }));
    await Promise.all(reveals);
  } catch {
    // Animation support must never determine whether the timetable is usable.
  } finally {
    finish();
  }
}
launchIntro();
