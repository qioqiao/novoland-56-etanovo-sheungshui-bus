// One opening lifecycle chooses a visual profile; ETA fetching never waits for it.
export async function launchIntro() {
  const root = document.documentElement;
  const smooth = root.dataset.theme === 'classic';
  const screen = document.querySelector('.launch-screen');
  const target = document.querySelector('.brand .brand-icon');
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set();
  const listeners = [];
  let watchdog;
  let done = false;
  let flight;
  function listen(element, event, handler, options) {
    element.addEventListener(event, handler, options);
    listeners.push(() => element.removeEventListener(event, handler, options));
  }
  function finish() {
    if (done) return;
    done = true;
    if (window.busLaunchFallback !== undefined) clearTimeout(window.busLaunchFallback);
    delete window.busLaunchFallback;
    if (watchdog !== undefined) clearTimeout(watchdog);
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
  // The head timer bounds a failed module download. Once loaded, give the
  // actual choreography its own budget instead of cutting it off mid-reveal.
  if (!smooth) {
    clearTimeout(window.busLaunchFallback);
    delete window.busLaunchFallback;
    watchdog = setTimeout(finish, 4500);
  }
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  listen(window, 'resize', () => {
    // Reload can emit resize without changing geometry; that must not skip the intro.
    if (window.innerWidth !== viewport.width || window.innerHeight !== viewport.height) finish();
  });
  listen(window, 'orientationchange', finish);
  listen(window, 'pagehide', finish);
  listen(window, 'pageshow', event => { if (event.persisted) finish(); });
  // Data can change page height and trigger scroll anchoring without an input.
  // Only intentional scrolling skips the intro; layout scroll must not flash it.
  listen(window, 'wheel', finish, { passive: true });
  listen(window, 'touchmove', finish, { passive: true });
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
    const placeholder = screen.querySelector('.launch-placeholder');
    const markOpacity = smooth ? 1 : Number(window.getComputedStyle?.(placeholder)?.opacity ?? 0);
    screen.append(flight);
    screen.querySelector('.launch-stage')?.remove();
    // Keep the mark readable while the two plates arrive, then dock in one arc.
    await play(logo, smooth ? [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.035)', offset: .62 },
      { opacity: 1, transform: 'scale(1)' },
    ] : [
      { opacity: markOpacity, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(1.025)', offset: .55 },
      { opacity: 1, transform: 'scale(1)' },
    ], { duration: smooth ? 460 : 600, easing: 'cubic-bezier(.22,1,.36,1)' });
    if (done) return;
    // Station data may have introduced a scrollbar while the logo was centred.
    // Rebase before docking so the clone still hands off to the real logo.
    const dockRect = target.getBoundingClientRect();
    flight.style.left = `${dockRect.left}px`;
    flight.style.top = `${dockRect.top}px`;
    const dockStart = `translate(${window.innerWidth / 2 - dockRect.left - rect.width / 2}px, ${window.innerHeight / 2 - dockRect.top - rect.height / 2}px) scale(2.7)`;
    root.dataset.launch = 'docking';
    const docking = play(flight, [
      { transform: dockStart },
      { transform: 'translate(0, 0) scale(1)' },
    ], { duration: smooth ? 650 : 720, easing: 'cubic-bezier(.65,0,.15,1)' });
    const backdrop = smooth ? Promise.resolve() : play(screen.querySelector('.launch-backdrop'), [
      { opacity: 1 }, { opacity: 0 },
    ], { duration: 700, easing: 'cubic-bezier(.3,0,.4,1)' });
    await Promise.all([docking, backdrop]);
    if (done) return;
    root.dataset.launch = 'revealing';
    // Move each section as one piece, including its protruding accents and shadows.
    // Cut masks belong to individual surfaces, not these outer containers.
    // Follow the visual reading order on both the stacked phone layout and the
    // two-column desktop layout; move whole sections with all their decoration.
    const panels = smooth ? ['.journey-panel', '.results-panel'] :
      ['.results-panel', '.journey-panel'].sort((a, b) =>
        document.querySelector(a).getBoundingClientRect().top - document.querySelector(b).getBoundingClientRect().top);
    const selectors = [
      '.header-status', '.brand > span:last-child', '.screen-heading',
      '.route-tabs', ...panels, 'footer',
    ];
    let order = 0;
    const reveals = selectors.map(selector => document.querySelector(selector))
      .filter(element => element && element.getBoundingClientRect().height > 0)
      .map(element => {
        const frames = smooth ? [
          { opacity: 0, transform: 'translateY(12px)', filter: 'blur(5px)' },
          { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
        ] : [
          { opacity: 0, transform: 'translate(20px, 10px)' },
          { opacity: 1, transform: 'translate(0, 0)' },
        ];
        return play(element, frames, { duration: smooth ? 440 : 720, delay: order++ * (smooth ? 35 : 70), easing: smooth ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.3,0,.3,1)' });
      });
    if (!smooth) reveals.push(play(document.querySelector('.topbar-rule'), [
      { transform: 'scaleX(0)' },
      { transform: 'scaleX(1)' },
    ], { duration: 820, easing: 'cubic-bezier(.3,0,.3,1)' }));
    await Promise.all(reveals);
  } catch {
    // Animation support must never determine whether the timetable is usable.
  } finally {
    finish();
  }
}
launchIntro();
