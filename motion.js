const $ = (id) => document.getElementById(id);

// Motion is presentation only: data and accessible text update immediately.
const motionPreference = window.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
);
const runningAnimations = new WeakMap();
const activeMotion = new Set();
const motionOwners = new WeakMap();
const motionEase = "cubic-bezier(.22,1,.36,1)";
function playMotion(element, frames, options = {}, cleanup = () => {}) {
  runningAnimations.get(element)?.cancel();
  if (!element?.animate || motionPreference?.matches || document.hidden) {
    cleanup();
    return;
  }
  const animation = element.animate(frames, {
    duration: 440,
    easing: motionEase,
    ...options,
  });
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
motionPreference?.addEventListener?.("change", () => {
  if (motionPreference.matches) stopMotion();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopMotion();
});
window.addEventListener("resize", stopMotion);
window.addEventListener("scroll", stopMotion, { passive: true });
function animateIn(element, distance = 8, duration = 440, blur = 0) {
  return playMotion(
    element,
    [
      {
        opacity: 0.3,
        transform: "translateY(" + distance + "px) scale(.985)",
        filter: "blur(" + blur + "px)",
      },
      { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0px)" },
    ],
    { duration },
  );
}
function captureText(element) {
  if (
    !element?.animate ||
    !element.getBoundingClientRect ||
    motionPreference?.matches ||
    document.hidden
  )
    return null;
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
  if (ghost) {
    document.body.append(ghost);
    playMotion(
      ghost,
      [
        { opacity: 0.85, filter: "blur(0px)", transform: "translateY(0)" },
        { opacity: 0, filter: "blur(4px)", transform: "translateY(-5px)" },
      ],
      { duration: 230 },
      () => ghost.remove(),
    );
  }
  if (element.matches?.(".wait strong")) {
    playMotion(
      element,
      [
        {
          opacity: 0,
          filter: "blur(6px)",
          transform: "translateY(32%) scale(.94)",
        },
        {
          opacity: 1,
          filter: "blur(0px)",
          transform: "translateY(-2%) scale(1.01)",
          offset: 0.76,
        },
        {
          opacity: 1,
          filter: "blur(0px)",
          transform: "translateY(0) scale(1)",
        },
      ],
      { duration: 580 },
    );
  } else
    playMotion(
      element,
      [
        { opacity: 0, filter: "blur(4px)", transform: "translateY(5px)" },
        { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
      ],
      { duration: 460 },
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

// A physical spring moves the selected lens. Retarget from the displayed position.
const segmentLenses = new Map();
function selectSegment(selector, index, animate = true) {
  const group = document.querySelector(selector);
  group.style.setProperty("--active-index", String(index));
  if (!group.getBoundingClientRect || !group.animate) return;
  let lens = segmentLenses.get(group);
  const button = group.querySelectorAll("button")[index];
  if (!button) return;
  const same = lens?.dataset.index === String(index);
  const before = lens?.getBoundingClientRect();
  if (!lens) {
    lens = document.createElement("span");
    lens.className = "segment-lens";
    lens.setAttribute("aria-hidden", "true");
    group.prepend(lens);
    group.classList.add("has-lens");
    segmentLenses.set(group, lens);
  }
  runningAnimations.get(lens)?.cancel();
  lens.dataset.index = String(index);
  lens.style.left = button.offsetLeft + "px";
  lens.style.width = button.offsetWidth + "px";
  if (!before || same || !animate || !button.offsetWidth) return;
  const after = lens.getBoundingClientRect();
  const dx = before.left - after.left;
  const scale = before.width / after.width;
  const stretch = Math.min(0.16, (Math.abs(dx) / after.width) * 0.13);
  playMotion(
    lens,
    [
      {
        transform: "translateX(" + dx + "px) scaleX(" + scale + ")",
        offset: 0,
      },
      {
        transform:
          "translateX(" +
          dx * 0.45 +
          "px) scaleX(" +
          (1 + stretch) +
          ") scaleY(.94)",
        offset: 0.28,
      },
      {
        transform:
          "translateX(" + -dx * 0.035 + "px) scaleX(.975) scaleY(1.018)",
        offset: 0.64,
      },
      {
        transform:
          "translateX(" + dx * 0.006 + "px) scaleX(1.007) scaleY(.997)",
        offset: 0.84,
      },
      { transform: "translateX(0) scale(1)", offset: 1 },
    ],
    { duration: 620, easing: "cubic-bezier(.22,.68,.32,1)" },
  );
}
window.addEventListener("resize", () => {
  for (const [group, lens] of segmentLenses) {
    selectSegment(
      group.matches(".route-tabs") ? ".route-tabs" : ".direction-control",
      Number(lens.dataset.index),
      false,
    );
  }
});
function lightSweep(element) {
  if (!element?.animate || motionPreference?.matches || document.hidden) return;
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
    [
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.35 },
      { opacity: 0, offset: 1 },
    ],
    { duration: 850, easing: "cubic-bezier(.2,.65,.3,1)" },
    () => sheen.remove(),
  );
}
function morphIsland(element, before) {
  const after = element.offsetHeight;
  if (before && after && Math.abs(before - after) > 1) {
    playMotion(element, [{ height: before + "px" }, { height: after + "px" }], {
      duration: 560,
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
    [
      { transform: "scale(.963)", offset: 0 },
      { transform: "scale(1.015)", offset: 0.5 },
      { transform: "scale(.998)", offset: 0.78 },
      { transform: "scale(1)", offset: 1 },
    ],
    { duration: 480 },
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
            [
              {
                opacity: 0,
                filter: "blur(7px)",
                transform:
                  "translate(" + journeyDrift * 16 + "px, 9px) scale(.985)",
              },
              { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
            ],
            { duration: 570, delay: index * 45, fill: "backwards" },
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
          { duration: 520 },
        );
      } else if (!previous) {
        playMotion(
          node,
          [
            {
              opacity: 0,
              filter: "blur(4px)",
              transform: "translateY(14px) scale(.98)",
            },
            {
              opacity: 1,
              filter: "blur(0px)",
              transform: "translateY(0) scale(1)",
            },
          ],
          { duration: 540, delay: index * 45, fill: "backwards" },
        );
      } else if (node.textContent !== previous.text) {
        animateIn(
          node.querySelector(".trip-wait strong") ||
            node.querySelector("strong"),
          7,
          400,
          3,
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
      { duration: 420 },
      () => {
        details.open = expanded;
        details.style.overflow = "";
        delete details.dataset.expanded;
      },
    );
  });
});

export function beginJourneyMotion() {
  [...activeMotion]
    .filter((entry) => !entry.element.classList?.contains("segment-lens"))
    .forEach((entry) => entry.cancel());
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
  ], { duration: 760 });
  document.querySelectorAll(".station-dot").forEach((dot, index) => {
    playMotion(dot, [
      { transform: "scale(1)" },
      { transform: "scale(1.25)", offset: 0.4 },
      { transform: "scale(1)" },
    ], { duration: 440, delay: index * 240 });
  });
}
export function captureHeroHeight() {
  pendingHeroHeight = $("hero").offsetHeight;
}
export { text, setMarkup, animateIn, selectSegment, lightSweep };
