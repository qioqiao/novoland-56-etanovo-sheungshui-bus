const $ = (id) => document.getElementById(id);

// Motion is presentation only: data and accessible text update immediately.
const motionPreference = window.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
);
const runningAnimations = new WeakMap();
const activeMotion = new Set();
const motionOwners = new WeakMap();
const motionEase = "cubic-bezier(.16,.86,.22,1)";
const classicEase = "cubic-bezier(.22,1,.36,1)";
const classic = () => document.documentElement.dataset.theme === 'classic';
const opening = () => document.documentElement.hasAttribute('data-launch');
function playMotion(element, frames, options = {}, cleanup = () => {}) {
  runningAnimations.get(element)?.cancel();
  const revealingData = !classic() && document.documentElement.dataset.launch === 'revealing' &&
    !!element?.closest?.('.island, #trips, #arrivals');
  if (!element?.animate || motionPreference?.matches || document.hidden || (opening() && !revealingData)) {
    cleanup();
    return;
  }
  if (revealingData) {
    // A response may arrive after the card starts appearing. Reveal the real
    // new data locally without exposing cut masks or detached old-text copies.
    frames = frames.map(({ clipPath, 'clip-path': mask, ...frame }) => frame);
    options = { ...options, duration: Math.max(480, options.duration || 0), easing: 'cubic-bezier(.3,0,.3,1)' };
  }
  let animation;
  try {
    animation = element.animate(frames, {
      duration: classic() ? 440 : 260,
      easing: classic() ? classicEase : motionEase,
      ...options,
    });
  } catch {
    cleanup();
    return;
  }
  const entry = {
    element,
    cancel() {
      animation.cancel();
      finish();
    },
  };
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    cleanup();
    activeMotion.delete(entry);
    if (runningAnimations.get(element) === entry)
      runningAnimations.delete(element);
  }
  runningAnimations.set(element, entry);
  activeMotion.add(entry);
  animation.onfinish = finish;
  animation.oncancel = finish;
  return entry;
}
const stopMotion = () => [...activeMotion].forEach((entry) => entry.cancel());
// Plates live inside their controls, so scrolling cannot detach them. Only
// viewport-positioned text copies and content effects need to stop on scroll.
const stopContentMotion = () => [...activeMotion]
  .filter(entry => !entry.element.classList?.contains('segment-lens'))
  .forEach(entry => entry.cancel());
motionPreference?.addEventListener?.("change", () => {
  if (motionPreference.matches) stopMotion();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopMotion();
});
window.addEventListener("resize", stopContentMotion);
window.addEventListener("scroll", () => {
  // During the intro there are no detached text ghosts to realign. Layout
  // anchoring must not cut short the permitted late-arrival fades either.
  if (!opening()) stopContentMotion();
}, { passive: true });
// The controller sends this before replacing theme CSS. Keep one engine and
// remove old-theme effects without changing any live timetable or form nodes.
document.addEventListener('bus:themechange', () => {
  stopMotion();
  document.querySelectorAll('.motion-ghost, .motion-sheen').forEach(node => node.remove());
  pendingHeroHeight = null;
  journeyTransition = false;
});
function animateIn(element, distance = 6, duration = classic() ? 440 : 260, blur = 0) {
  const smooth = classic();
  const time = smooth ? duration : Math.max(180, Math.min(320, duration));
  // Mobile P5R places the unit below the list number. Enter from above so the
  // moving number never crosses the unit while its value changes.
  if (element?.matches('.trip-wait strong')) distance = -Math.abs(distance);
  if (element?.matches('.station-fields')) {
    // Keep the rail and its endpoints in one fixed coordinate space. Only station
    // labels move; the red progress stroke and diamond pulses run independently.
    element.querySelectorAll('label, select').forEach(node => playMotion(node, smooth ? [
      { opacity: .3, transform: 'translateY(' + distance + 'px)', filter: 'blur(' + blur + 'px)' },
      { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
    ] : [
      { opacity: 0, transform: 'translateY(' + Math.min(8, distance) + 'px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: time }));
    return;
  }
  return playMotion(
    element,
    smooth ? [
      { opacity: .3, transform: 'translateY(' + distance + 'px) scale(.985)', filter: 'blur(' + blur + 'px)' },
      { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
    ] : [
      {
        opacity: 0,
        transform: "translateY(" + Math.min(8, distance) + "px)",
        clipPath: "polygon(0 0, 92% 0, 100% 100%, 0 100%)",
      },
      { opacity: 1, transform: "translateY(0)", clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)" },
    ],
    { duration: time },
  );
}
function captureText(element) {
  if (
    !element?.animate ||
    !element.getBoundingClientRect ||
    motionPreference?.matches ||
    opening() ||
    document.hidden
  )
    return null;
  // Countdown width changes immediately (10 → 9, 1 → 即將). A body-positioned
  // copy of the old number or unit can cover its newly laid-out neighbour.
  // Keep the incoming animation, with one visible countdown in its own layout.
  if (element.matches?.('.wait strong, .wait > span')) return null;
  // P5R direction labels invert against the moving plate. A detached copy
  // would lose that contrast and briefly paint white text on the pale track.
  if (!classic() && element.closest?.('.direction-control.has-lens')) return null;
  // Do not resurrect a half-visible incoming label as a fully opaque ghost.
  for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
    if (runningAnimations.has(ancestor)) return null;
  }
  const range = document.createRange?.();
  range?.selectNodeContents(element);
  const rect =
    range?.getBoundingClientRect?.() || element.getBoundingClientRect();
  if (
    !rect.width ||
    !rect.height ||
    rect.bottom < 0 ||
    rect.top > window.innerHeight
  )
    return null;
  const style = window.getComputedStyle(element);
  const ghost = document.createElement("span");
  ghost.className = "motion-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.textContent = element.textContent;
  motionOwners.set(ghost, element.closest("#hero") || element);
  for (const key of [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "color",
    "fontVariantNumeric",
    "whiteSpace",
  ])
    ghost.style[key] = style[key];
  Object.assign(ghost.style, {
    left: rect.left + window.scrollX + "px",
    top: rect.top + window.scrollY + "px",
    width: rect.width + "px",
    height: rect.height + "px",
  });
  return ghost;
}
function dissolveText(element, ghost) {
  const smooth = classic();
  if (ghost) {
    document.body.append(ghost);
    playMotion(
      ghost,
      smooth ? [
        { opacity: .85, filter: 'blur(0px)', transform: 'translateY(0)' },
        { opacity: 0, filter: 'blur(4px)', transform: 'translateY(-5px)' },
      ] : [
        { opacity: 0.65, transform: "translateX(0)" },
        { opacity: 0, transform: "translateX(-7px)" },
      ],
      { duration: smooth ? 230 : 150 },
      () => ghost.remove(),
    );
  }
  if (element.matches?.(".wait strong")) {
    playMotion(
      element,
      smooth ? [
        { opacity: 0, filter: 'blur(6px)', transform: 'translateY(32%) scale(.94)', clipPath: 'inset(-40% 0)' },
        { opacity: 1, filter: 'blur(0px)', transform: 'translateY(-2%) scale(1.01)', clipPath: 'inset(-40% 0)', offset: .76 },
        { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0) scale(1)', clipPath: 'inset(-40% 0)' },
      ] : [
        {
          opacity: 0,
          transform: "translateY(12px)",
          clipPath: "inset(0 0 90% 0)",
        },
        {
          opacity: 1,
          transform: "translateY(-1px)",
          clipPath: "inset(0 0 0 0)",
          offset: 0.72,
        },
        {
          opacity: 1,
          transform: "translateY(0)",
          clipPath: "inset(0 0 0 0)",
        },
      ],
      { duration: smooth ? 580 : 270 },
    );
  } else
    playMotion(
      element,
      smooth ? [
        { opacity: 0, filter: 'blur(4px)', transform: 'translateY(5px)' },
        { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0)' },
      ] : [
        { opacity: 0, transform: "translateX(7px)", clipPath: "inset(0 72% 0 0)" },
        { opacity: 1, transform: "translateX(0)", clipPath: "inset(0 0 0 0)" },
      ],
      { duration: smooth ? 460 : 220 },
    );
}
const quietText = new Set(["clock", "date", "nextRefresh", "updated", "alert"]);
const text = (id, value) => {
  const element = $(id);
  if (element.textContent === String(value)) return;
  if (quietText.has(id)) {
    element.textContent = value;
    return;
  }
  const ghost = captureText(element.firstElementChild || element);
  runningAnimations.get(element.firstElementChild)?.cancel();
  const span = document.createElement("span");
  span.className = "motion-text";
  span.textContent = value;
  element.replaceChildren(span);
  dissolveText(span, ghost);
};

// One solid selection plate cuts between commands, retargeted from its current position.
const segmentLenses = new Map();
// ETA content can introduce a scrollbar without a window resize. Track the grid
// itself so an early-created plate stays aligned throughout the opening.
const segmentResizeObserver = window.ResizeObserver ? new window.ResizeObserver(entries => {
  for (const { target: group } of entries) {
    const lens = segmentLenses.get(group);
    if (lens) selectSegment(
      group.matches('.route-tabs') ? '.route-tabs' : '.direction-control',
      Number(lens.dataset.index), false,
    );
  }
}) : null;
function selectSegment(selector, index, animate = true) {
  const group = document.querySelector(selector);
  group.style.setProperty("--active-index", String(index));
  if (!group.getBoundingClientRect || !group.animate) return;
  let lens = segmentLenses.get(group);
  const button = group.querySelectorAll("button")[index];
  if (!button) return;
  const same = lens?.dataset.index === String(index);
  const left = button.offsetLeft;
  const width = button.offsetWidth;
  // setupJourney and ResizeObserver may repeat the same target while a plate
  // is in flight. Compare its destination, not its animated screen position.
  if (same && parseFloat(lens.style.left) === left && parseFloat(lens.style.width) === width) return;
  const continuing = same && runningAnimations.has(lens);
  const before = lens?.getBoundingClientRect();
  if (!lens) {
    lens = document.createElement("span");
    lens.className = "segment-lens";
    lens.setAttribute("aria-hidden", "true");
    group.prepend(lens);
    group.classList.add("has-lens");
    segmentLenses.set(group, lens);
    segmentResizeObserver?.observe(group);
  }
  runningAnimations.get(lens)?.cancel();
  lens.dataset.index = String(index);
  lens.style.left = left + "px";
  lens.style.width = width + "px";
  if (!before || (!animate && !continuing) || !width) return;
  const after = lens.getBoundingClientRect();
  const dx = before.left - after.left + (before.width - after.width) / 2;
  const smooth = classic();
  const scale = before.width / after.width;
  const stretch = Math.min(.16, (Math.abs(dx) / after.width) * .13);
  playMotion(
    lens,
    smooth ? [
      { transform: 'translateX(' + dx + 'px) scaleX(' + scale + ')', offset: 0 },
      { transform: 'translateX(' + dx * .45 + 'px) scaleX(' + (1 + stretch) + ') scaleY(.94)', offset: .28 },
      { transform: 'translateX(' + -dx * .035 + 'px) scaleX(.975) scaleY(1.018)', offset: .64 },
      { transform: 'translateX(' + dx * .006 + 'px) scaleX(1.007) scaleY(.997)', offset: .84 },
      { transform: 'translateX(0) scale(1)', offset: 1 },
    ] : [
      // One continuous deceleration: separate per-segment easings previously
      // braked to zero midway, then restarted and reversed at the destination.
      { transform: `translateX(${dx}px) scaleX(${scale})`, offset: 0 },
      { transform: "translateX(0) scaleX(1)", offset: 1 },
    ],
    { duration: continuing ? (smooth ? 380 : 220) : (smooth ? 620 : 360),
      easing: smooth ? 'cubic-bezier(.22,.68,.32,1)' : 'cubic-bezier(.22,.8,.26,1)' },
  );
}
function realignSegments() {
  for (const [group, lens] of segmentLenses) {
    selectSegment(
      group.matches(".route-tabs") ? ".route-tabs" : ".direction-control",
      Number(lens.dataset.index),
      false,
    );
  }
}
window.addEventListener('resize', realignSegments);
// Theme padding can move buttons without resizing the group observed above.
document.addEventListener('bus:themeapplied', realignSegments);
function lightSweep(element) {
  if (!element?.animate || motionPreference?.matches || document.hidden || opening()) return;
  const smooth = classic();
  element.querySelectorAll(".motion-sheen").forEach((node) => {
    runningAnimations.get(node)?.cancel();
    node.remove();
  });
  const sheen = document.createElement("span");
  sheen.className = "motion-sheen";
  sheen.setAttribute("aria-hidden", "true");
  element.append(sheen);
  playMotion(
    sheen,
    smooth ? [
      { transform: 'translateX(-120%) skewX(-18deg)', opacity: 0, offset: 0 },
      { transform: 'translateX(-30%) skewX(-18deg)', opacity: .7, offset: .35 },
      { transform: 'translateX(160%) skewX(-18deg)', opacity: 0, offset: 1 },
    ] : [
      { transform: "translateX(-160%) skewX(-22deg)", opacity: 0, offset: 0 },
      {
        transform: "translateX(300%) skewX(-22deg)",
        opacity: 0.65,
        offset: 0.45,
      },
      { transform: "translateX(900%) skewX(-22deg)", opacity: 0, offset: 1 },
    ],
    { duration: smooth ? 850 : 320, easing: smooth ? 'cubic-bezier(.2,.65,.3,1)' : 'cubic-bezier(.35,0,.6,1)' },
    () => sheen.remove(),
  );
}
function morphIsland(element, before) {
  const after = element.offsetHeight;
  if (before && after && Math.abs(before - after) > 1) {
    playMotion(element, [{ height: before + "px" }, { height: after + "px" }], {
      duration: classic() ? 560 : 280,
    });
  }
  lightSweep(element);
}
const pressTargets =
  ".route-tabs button, .direction-control button, .refresh, .estimate-input button";
document.addEventListener("click", (event) => {
  const button = event.target.closest?.(pressTargets);
  if (!button) return;
  playMotion(
    button,
    classic() ? [
      { transform: 'scale(.963)', offset: 0 },
      { transform: 'scale(1.015)', offset: .5 },
      { transform: 'scale(.998)', offset: .78 },
      { transform: 'scale(1)', offset: 1 },
    ] : [
      { transform: "translate(2px, 2px)", offset: 0 },
      { transform: "translate(0, 0)", offset: 1 },
    ],
    { duration: classic() ? 480 : 120 },
  );
  if (button.id === "refresh") lightSweep($("hero"));
});
let pendingHeroHeight = null;
let journeyTransition = false;
let journeyDrift = 1;
function rowKey(row) {
  return (
    (row.querySelector(".route-badge")?.textContent || "") +
    "/" +
    (row.querySelector(".trip-info strong")?.textContent ||
      row.querySelector("span:nth-child(2)")?.textContent ||
      "empty")
  );
}

const renderedMarkup = new Map();
const heroText =
  ".island-eyebrow, .source-pill, .route-badge, .route-meta, .platform-note, .wait strong, .wait > span, .time-block strong, .ride-tag, h3, .empty-island > p";
function setMarkup(id, html) {
  if (renderedMarkup.get(id) === html) return;
  const smooth = classic();
  const element = $(id);
  const beforeHeight =
    id === "hero"
      ? (pendingHeroHeight ?? element.offsetHeight)
      : element.offsetHeight;
  if (id === "hero") {
    pendingHeroHeight = null;
    runningAnimations.get(element)?.cancel();
  }
  const previousRows =
    id !== "hero"
      ? new Map(
          [...element.children].map((row) => [
            rowKey(row),
            { top: row.getBoundingClientRect?.().top, text: row.textContent },
          ]),
        )
      : null;
  const previousLoading = !!element.querySelector(
    ".loading-track, .pending-arrival",
  );
  const previousRoute =
    id === "hero" ? element.querySelector(".route-badge")?.textContent : null;
  const oldText =
    id === "hero"
      ? [...element.querySelectorAll(heroText)].map((node) => ({
          text: node.textContent,
          ghost: captureText(node),
        }))
      : [];
  // Retire descendant animations and ghosts before replacing their source DOM.
  for (const entry of [...activeMotion]) {
    if (
      element.contains(entry.element) ||
      motionOwners.get(entry.element) === element
    )
      entry.cancel();
  }
  element.innerHTML = html;
  renderedMarkup.set(id, html);
  if (id === "hero") {
    const route = element.querySelector(".route-badge")?.textContent;
    const nextLoading = !!element.querySelector(
      ".loading-track, .pending-arrival",
    );
    if (
      route !== previousRoute ||
      journeyTransition ||
      previousLoading !== nextLoading
    ) {
      journeyTransition = false;
      morphIsland(element, beforeHeight);
      element
        .querySelectorAll(
          ".island-top, .island-main, .island-bottom, .empty-island > .island-eyebrow, h3, .empty-island > p",
        )
        .forEach((node, index) => {
          playMotion(
            node,
            smooth ? [
              { opacity: 0, filter: 'blur(7px)', transform: 'translate(' + journeyDrift * 16 + 'px, 9px) scale(.985)' },
              { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0)' },
            ] : [
              {
                opacity: 0,
                transform:
                  "translate(" + journeyDrift * 10 + "px, 4px)",
                clipPath: "polygon(0 0, 82% 0, 90% 100%, 0 100%)",
              },
              { opacity: 1, transform: "translate(0, 0)", clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)" },
            ],
            { duration: smooth ? 570 : 260, delay: index * (smooth ? 45 : 30), fill: "backwards" },
          );
        });
    } else {
      element.querySelectorAll(heroText).forEach((node, index) => {
        if (node.textContent !== oldText[index]?.text)
          dissolveText(node, oldText[index]?.ghost);
      });
    }
  } else if (id === "trips" || id === "arrivals") {
    [...element.children].slice(0, 6).forEach((node, index) => {
      const previous = previousRows.get(rowKey(node));
      const top = node.getBoundingClientRect?.().top;
      if (
        previous &&
        Number.isFinite(top) &&
        Math.abs(previous.top - top) > 1
      ) {
        playMotion(
          node,
          [
            { transform: "translateY(" + (previous.top - top) + "px)" },
            { transform: "translateY(0)" },
          ],
          { duration: smooth ? 520 : 260 },
        );
      } else if (!previous) {
        playMotion(
          node,
          smooth ? [
            { opacity: 0, filter: 'blur(4px)', transform: 'translateY(14px) scale(.98)' },
            { opacity: 1, filter: 'blur(0px)', transform: 'translateY(0) scale(1)' },
          ] : [
            {
              opacity: 0,
              transform: "translate(" + (index % 2 ? -8 : 8) + "px, 5px)",
            },
            {
              opacity: 1,
              transform: "translate(0, 0)",
            },
          ],
          { duration: smooth ? 540 : 200, delay: index * (smooth ? 45 : 30), fill: "backwards" },
        );
      } else if (node.textContent !== previous.text) {
        animateIn(
          node.querySelector(".trip-wait strong") ||
            node.querySelector("strong"),
          smooth ? 7 : 5,
          smooth ? 400 : 220,
          smooth ? 3 : 0,
        );
      }
    });
  }
}

// Animate both opening and closing while preserving native summary keyboard controls.
document.querySelectorAll("details").forEach((details) => {
  const summary = details.querySelector("summary");
  let expanded = details.open;
  summary.addEventListener("click", (event) => {
    if (motionPreference?.matches || !details.animate) return;
    event.preventDefault();
    const from = details.getBoundingClientRect().height;
    const inFlight = runningAnimations.get(details);
    expanded = inFlight ? !expanded : !details.open;
    inFlight?.cancel();
    details.open = true;
    const detailStyle = window.getComputedStyle(details);
    const to = expanded
      ? details.getBoundingClientRect().height
      : summary.getBoundingClientRect().height +
        parseFloat(detailStyle.borderTopWidth || 0) +
        parseFloat(detailStyle.borderBottomWidth || 0) +
        parseFloat(detailStyle.paddingTop || 0) +
        parseFloat(detailStyle.paddingBottom || 0);
    details.dataset.expanded = String(expanded);
    details.style.overflow = "hidden";
    playMotion(
      details,
      [{ height: from + "px" }, { height: to + "px" }],
      { duration: classic() ? 420 : 260 },
      () => {
        details.open = expanded;
        details.style.overflow = "";
        delete details.dataset.expanded;
      },
    );
  });
});

export function beginJourneyMotion() {
  stopContentMotion();
  journeyTransition = true;
}
export function setJourneyDrift(direction) {
  journeyDrift = direction;
}
export function animateJourneyPath() {
  const line = document.querySelector(".station-line-progress");
  if (!line) return;
  playMotion(line, [
    { transform: "scaleY(0)", opacity: 0 },
    { transform: "scaleY(1)", opacity: 0.85, offset: 0.65 },
    { transform: "scaleY(1)", opacity: 0 },
  ], { duration: classic() ? 760 : 260 });
  document.querySelectorAll(".station-dot").forEach((dot, index) => {
    playMotion(dot, [
      { transform: "scale(1)" },
      { transform: classic() ? 'scale(1.25)' : 'scale(1.18)', offset: 0.4 },
      { transform: "scale(1)" },
    ], { duration: classic() ? 440 : 180, delay: index * (classic() ? 240 : 70) });
  });
}
export function captureHeroHeight() {
  pendingHeroHeight = $("hero").offsetHeight;
}
export { text, setMarkup, animateIn, selectSegment, lightSweep };
