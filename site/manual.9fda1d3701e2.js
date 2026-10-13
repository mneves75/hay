// ── scrollspy: aria-current drives TOC highlight; IO because scroll handlers jank ──
const links = [...document.querySelectorAll("#toc a")];
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) {
    links.forEach((a) => a.setAttribute("aria-current", String(a.hash === `#${e.target.id}`)));
  }
}, { rootMargin: "-20% 0px -70% 0px" });
document.querySelectorAll("main section[id]").forEach((s) => spy.observe(s));

// ── copy buttons: secure-context API first, local-file fallback, accessible status ──
const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch {}
  }
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.cssText = "position:fixed;inset:0;opacity:0;pointer-events:none";
  document.body.append(box);
  box.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } finally { box.remove(); }
  if (!copied) throw new Error("clipboard unavailable");
};
for (const b of document.querySelectorAll(".copy")) {
  const code = b.previousElementSibling?.querySelector("code");
  if (!code) continue;
  const feedback = document.createElement("p");
  feedback.className = "copy-feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  b.parentElement.append(feedback);
  b.hidden = false;
  b.setAttribute("aria-label", "Copy command to clipboard");
  b.addEventListener("click", async () => {
    if (b.disabled) return;
    b.disabled = true;
    feedback.textContent = "Copying…";
    try {
      await copyText(code.textContent ?? "");
      feedback.textContent = "Command copied.";
    } catch {
      feedback.textContent = "Could not copy. Select the command and copy it manually.";
    } finally {
      b.disabled = false;
    }
  });
}

// ── live search: hide non-matching sections, mark hits, report counts ──
const q = document.getElementById("q"), meta = document.getElementById("search-meta");
document.querySelector(".searchbar").hidden = false;
for (const link of links) link.addEventListener("click", () => {
  if (q.value) { q.value = ""; q.dispatchEvent(new Event("input")); }
});
const sections = [...document.querySelectorAll("main section[id]")];
const plain = (el) => el.textContent.toLowerCase();
q.addEventListener("input", () => {
  const needle = q.value.trim().toLowerCase();
  document.body.classList.toggle("searching", !!needle);
  let hits = 0;
  for (const s of sections) {
    const hit = !needle || plain(s).includes(needle);
    s.classList.toggle("hit", hit);
    if (needle && hit) hits++;
    // strip previous marks, then mark the first occurrence per heading-ish element
    for (const m of s.querySelectorAll("mark")) m.replaceWith(...m.childNodes);
    s.normalize();
    if (needle && hit && hits <= 50) {
      const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      const targets = [];
      for (let n; (n = walker.nextNode());) {
        if (n.parentElement.closest("button, .copy-feedback")) continue;
        const i = n.data.toLowerCase().indexOf(needle);
        if (i >= 0) targets.push([n, i]);
      }
      // splitText twice isolates the match as its own node; swap it for <mark>.
      for (const [n, i] of targets.slice(0, 8)) {
        const mid = n.splitText(i);
        mid.splitText(needle.length);
        const el = document.createElement("mark");
        el.textContent = mid.data;
        mid.replaceWith(el);
      }
    }
  }
  document.body.classList.toggle("no-search-results", !!needle && hits === 0);
  meta.textContent = needle ? `${hits} section${hits === 1 ? "" : "s"} match “${q.value.trim()}”` : "";
});

// ── "/" focuses search from anywhere; Escape clears ──
addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
  if (e.key === "Escape" && document.activeElement === q) { q.value = ""; q.dispatchEvent(new Event("input")); q.blur(); }
});
