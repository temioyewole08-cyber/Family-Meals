/* ---------------------------------------------------------
   Family Meals — app logic (vanilla JS, no build step)
   --------------------------------------------------------- */

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAY_FULL = { Sun:"Sunday", Mon:"Monday", Tue:"Tuesday", Wed:"Wednesday",
                   Thu:"Thursday", Fri:"Friday", Sat:"Saturday" };
const SCHOOL_DAYS = ["Mon","Tue","Wed","Thu","Fri"];

const BENEFIT_LABELS = {
  "blood-pressure":    { klass: "bp",   text: "BP"   },
  "prediabetes":       { klass: "pre",  text: "Pre-D"},
  "anti-inflammatory": { klass: "anti", text: "Anti-inflam" },
};

// ---------- State ----------
const state = {
  view: "planner",
  meals: loadMeals(),
  plan: loadPlan(),
  grocery: loadGrocery(),   // { itemKey: checked }
  batch:   loadBatch(),     // { taskId: done }
  vaultFilter: { search: "", category: "all", stephenOnly: false },
  swap: null,
};

// ---------- Persistence ----------
function loadMeals() {
  const saved = localStorage.getItem("fm.meals");
  if (saved) { try { return JSON.parse(saved); } catch {} }
  return structuredClone(DEFAULT_MEALS);
}
function saveMeals() { localStorage.setItem("fm.meals", JSON.stringify(state.meals)); }

function loadPlan() {
  const saved = localStorage.getItem("fm.plan");
  if (saved) { try { return JSON.parse(saved); } catch {} }
  return structuredClone(DEFAULT_PLAN);
}
function savePlan() { localStorage.setItem("fm.plan", JSON.stringify(state.plan)); }

function loadGrocery() {
  // URL override first (shareable link)
  const urlState = new URLSearchParams(location.search).get("g");
  if (urlState) {
    try {
      const decoded = JSON.parse(atob(decodeURIComponent(urlState)));
      localStorage.setItem("fm.grocery", JSON.stringify(decoded));
      return decoded;
    } catch {}
  }
  const saved = localStorage.getItem("fm.grocery");
  return saved ? JSON.parse(saved) : {};
}
function saveGrocery() { localStorage.setItem("fm.grocery", JSON.stringify(state.grocery)); }

function loadBatch() {
  const saved = localStorage.getItem("fm.batch");
  return saved ? JSON.parse(saved) : {};
}
function saveBatch() { localStorage.setItem("fm.batch", JSON.stringify(state.batch)); }

// ---------- Helpers ----------
const getMeal = id => state.meals.find(m => m.id === id);
const mealsByCat = cat => state.meals.filter(m => m.category === cat);

function isSchoolDay(day) { return SCHOOL_DAYS.includes(day); }

function badgesFor(meal, ctx = {}) {
  const out = [];
  if (ctx.nutAlertContext && meal.nutAlert) out.push({ klass: "nut", text: "⚠ Nut" });
  for (const b of (meal.stephenBenefits || [])) {
    const info = BENEFIT_LABELS[b];
    if (info) out.push({ klass: info.klass, text: info.text });
  }
  return out;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.add("hidden"), 2200);
}

// ---------- View switch ----------
document.getElementById("tabs").addEventListener("click", e => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b === btn));
  state.view = btn.dataset.view;
  render();
});

function render() {
  const main = document.getElementById("main");
  if      (state.view === "planner") main.innerHTML = renderPlanner();
  else if (state.view === "grocery") main.innerHTML = renderGrocery();
  else if (state.view === "batch")   main.innerHTML = renderBatch();
  else if (state.view === "vault")   main.innerHTML = renderVault();
  bindViewEvents();
}

// =============================================================================
// PLANNER
// =============================================================================
function renderPlanner() {
  return `
    <div class="planner-toolbar">
      <div>
        <h2>Week of ${weekOfLabel()}</h2>
        <p class="muted">Sunday → Saturday · tap any meal to swap it</p>
      </div>
      <div class="legend">
        <span><span class="dot family"></span>Family shares</span>
        <span><span class="dot adults"></span>Adults only</span>
        <span><span class="dot kids"></span>Kids only</span>
        <span>↻ repeat · 🔥 fresh cook · ✨ flex</span>
      </div>
    </div>
    <div class="week-grid">
      ${DAYS.map(renderDay).join("")}
    </div>
  `;
}

function weekOfLabel() {
  const d = new Date();
  const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
  const sat = new Date(sun); sat.setDate(sun.getDate()+6);
  const opts = { month: "short", day: "numeric" };
  return `${sun.toLocaleDateString(undefined, opts)} – ${sat.toLocaleDateString(undefined, opts)}`;
}

function renderDay(day) {
  const p = state.plan[day];
  const tag = day === "Sat" ? "✨ flex cook"
            : day === "Sun" ? "🔥 batch cook"
            : isSchoolDay(day) ? "school day" : "";
  return `
    <div class="day">
      <div class="day-head"><h3>${DAY_FULL[day]}</h3><span class="tag">${tag}</span></div>
      ${renderSlot(day, "breakfast", p.breakfast)}
      ${renderSlot(day, "lunch",     p.lunch)}
      ${renderSlot(day, "dinner",    p.dinner)}
    </div>
  `;
}

function renderSlot(day, slot, entry) {
  if (!entry) return "";
  if (entry.type === "family") {
    return slotCard({
      klass: "family",
      slot, day,
      side: "family",
      mealId: entry.adultMealId,
      sideId: entry.adultSideId,
      entry,
    });
  }
  // split
  return `<div class="split-card">
    ${slotCard({ klass: "adults", slot, day, side: "adult",
      mealId: entry.adultMealId, sideId: entry.adultSideId, entry })}
    ${slotCard({ klass: "kids",   slot, day, side: "kid",
      mealId: entry.kidMealId,   sideId: entry.kidSideId,   entry })}
  </div>`;
}

function slotCard({ klass, slot, day, side, mealId, sideId, entry }) {
  const meal = getMeal(mealId);
  if (!meal) return `<div class="card"><em>Missing meal</em></div>`;
  const sideMeal = sideId ? getMeal(sideId) : null;

  const nutContext = side === "kid" && slot === "lunch" && isSchoolDay(day);
  const badges = badgesFor(meal, { nutAlertContext: nutContext });
  if (entry.repeat && side === "family") badges.unshift({ klass: "repeat", text: "↻ repeat" });
  if (entry.freshCook && side === "family") badges.unshift({ klass: "fresh", text: "🔥 fresh" });
  if (entry.flex && side === "family") badges.unshift({ klass: "flex", text: "✨ flex" });

  const adultCal = (meal.caloriesAdult || 0) + (sideMeal ? sideMeal.caloriesAdult : 0);
  const kidCal   = (meal.caloriesKid || 0)   + (sideMeal ? sideMeal.caloriesKid   : 0);

  let calLine;
  if (klass === "family") {
    calLine = `<span>Adults <b>${adultCal}</b> cal</span><span>Kids <b>${kidCal}</b> cal</span>`;
  } else if (klass === "adults") {
    calLine = `<span>Adult <b>${adultCal}</b> cal</span>`;
  } else {
    calLine = `<span>Kid <b>${kidCal}</b> cal</span>`;
  }

  const subline = sideMeal
    ? `with <b>${sideMeal.name}</b>`
    : meal.notes ? meal.notes : "";

  const slotLabel = side === "adult" ? `Adult · ${slot}`
                 : side === "kid"   ? `Kid · ${slot}`
                 : slot;

  return `
    <div class="card ${klass}"
         data-day="${day}" data-slot="${slot}" data-side="${side}">
      <div class="slot-label">${slotLabel}${nutContext && meal.nutAlert ? " · ⚠ NUT" : ""}</div>
      <div class="meal-name">${meal.name}</div>
      ${subline ? `<div class="sub-line">${subline}</div>` : ""}
      <div class="cal-row">${calLine}</div>
      ${badges.length ? `<div class="badges">${badges.map(b => `<span class="badge ${b.klass}">${b.text}</span>`).join("")}</div>` : ""}
    </div>
  `;
}

// =============================================================================
// GROCERY
// =============================================================================
function buildGrocery() {
  // Aggregate unique (item, section) across the full week plan
  const set = new Map(); // key = item|section
  for (const day of DAYS) {
    const p = state.plan[day];
    for (const slot of ["breakfast","lunch","dinner"]) {
      const entry = p[slot];
      if (!entry) continue;
      const ids = new Set();
      if (entry.adultMealId) ids.add(entry.adultMealId);
      if (entry.adultSideId) ids.add(entry.adultSideId);
      if (entry.kidMealId)   ids.add(entry.kidMealId);
      if (entry.kidSideId)   ids.add(entry.kidSideId);
      for (const id of ids) {
        const items = MEAL_INGREDIENTS[id] || [];
        for (const [name, section] of items) {
          const key = `${section}::${name}`;
          set.set(key, { name, section });
        }
      }
    }
  }
  const SECTION_ORDER = ["Proteins","Carbs & Staples","Vegetables","Fruits","Dairy","Pantry"];
  const bySection = {};
  for (const sec of SECTION_ORDER) bySection[sec] = [];
  for (const { name, section } of set.values()) {
    if (!bySection[section]) bySection[section] = [];
    bySection[section].push(name);
  }
  for (const sec of Object.keys(bySection)) bySection[sec].sort();
  return { bySection, sectionOrder: SECTION_ORDER };
}

function renderGrocery() {
  const { bySection, sectionOrder } = buildGrocery();
  let total = 0, done = 0;
  const sections = sectionOrder.map(sec => {
    const items = bySection[sec] || [];
    if (!items.length) return "";
    const itemsHtml = items.map(name => {
      const key = `${sec}::${name}`;
      total++;
      const checked = !!state.grocery[key];
      if (checked) done++;
      return `
        <label class="grocery-item ${checked ? "done" : ""}">
          <input type="checkbox" data-key="${encodeURIComponent(key)}" ${checked ? "checked" : ""}>
          <span>${name}</span>
        </label>
      `;
    }).join("");
    return `
      <div class="grocery-section">
        <h3>${sec}</h3>
        <div class="grocery-items">${itemsHtml}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="grocery-toolbar">
      <button id="gr-copy" class="primary">📋 Copy unchecked</button>
      <button id="gr-share">🔗 Shareable link</button>
      <button id="gr-reset" class="ghost">Reset ticks</button>
      <span class="count-pill">${total - done} of ${total} left</span>
    </div>
    <div class="grocery-layout">
      <div>${sections}</div>
      <aside class="sticky-side">
        <h3>Share with Stephen</h3>
        <p>Copy the link below — whoever opens it sees the same tick state. Update the link whenever the list changes.</p>
        <button id="gr-make-link" class="primary">Generate link</button>
        <div id="gr-link-box"></div>
      </aside>
    </div>
  `;
}

// =============================================================================
// BATCH COOK
// =============================================================================
function renderBatch() {
  const tasks = BATCH_TASKS;
  const done = tasks.filter(t => state.batch[t.id]).length;
  const pct = Math.round((done / tasks.length) * 100);

  const byDay = {};
  for (const t of tasks) (byDay[t.day] ||= []).push(t);

  const dayBlocks = ["Saturday","Sunday"].map(day => {
    const list = byDay[day] || [];
    return `
      <h3 class="batch-day-head">${day} — ${list.length} task${list.length === 1 ? "" : "s"}</h3>
      ${list.map(renderBatchTask).join("")}
    `;
  }).join("");

  return `
    <div class="batch-toolbar">
      <h2>Batch cook guide</h2>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <span class="muted">${done}/${tasks.length} · ${pct}%</span>
      <button id="batch-reset" class="ghost">Reset</button>
    </div>
    ${dayBlocks}
  `;
}

function renderBatchTask(t) {
  const done = !!state.batch[t.id];
  return `
    <label class="batch-task ${done ? "done" : ""}">
      <input type="checkbox" data-task="${t.id}" ${done ? "checked" : ""}>
      <div style="flex:1">
        <div class="title">${t.title}</div>
        <div class="meta">
          <span>⏱ ${t.minutes} min</span>
          <span>🍽 Feeds: ${t.feeds}</span>
        </div>
        <div class="storage">📦 ${t.storage}</div>
      </div>
    </label>
  `;
}

// =============================================================================
// VAULT
// =============================================================================
function renderVault() {
  const { search, category, stephenOnly } = state.vaultFilter;
  const s = search.toLowerCase();
  const filtered = state.meals.filter(m => {
    if (category !== "all" && m.category !== category) return false;
    if (stephenOnly && !m.stephenFriendly) return false;
    if (s && !m.name.toLowerCase().includes(s)) return false;
    return true;
  });

  const cats = [...new Set(state.meals.map(m => m.category))].sort();

  return `
    <div class="vault-toolbar">
      <h2>Meal vault <span class="muted">(${filtered.length})</span></h2>
      <span class="spacer"></span>
      <input id="vault-search" placeholder="Search meals…" value="${escapeHtml(search)}">
      <select id="vault-cat">
        <option value="all">All categories</option>
        ${cats.map(c => `<option value="${c}" ${c===category?"selected":""}>${c}</option>`).join("")}
      </select>
      <label class="row" style="gap:6px;">
        <input type="checkbox" id="vault-stephen" style="width:auto" ${stephenOnly?"checked":""}>
        Stephen-friendly only
      </label>
      <button id="vault-add" class="primary">+ Add meal</button>
    </div>
    <div class="vault-grid">
      ${filtered.map(renderVaultCard).join("")}
    </div>
  `;
}

function renderVaultCard(m) {
  const badges = badgesFor(m, { nutAlertContext: true });
  return `
    <div class="vault-card">
      <div class="cat">${m.category} · ${m.cuisine}</div>
      <div class="name">${m.name}</div>
      <div class="calrow">Adult <b>${m.caloriesAdult}</b> · Kid <b>${m.caloriesKid}</b> cal · ⏱ ${m.prepTime}m</div>
      <div class="tagrow">
        ${m.kidsFriendly ? `<span class="pill">kids ok</span>` : ""}
        ${m.stephenFriendly ? `<span class="pill">Stephen ok</span>` : ""}
        <span class="pill">${m.proteinType}</span>
        ${badges.map(b => `<span class="badge ${b.klass}">${b.text}</span>`).join("")}
      </div>
      ${m.notes ? `<div class="muted" style="font-size:12px">${escapeHtml(m.notes)}</div>` : ""}
      <div class="actions">
        <button data-edit="${m.id}">Edit</button>
        <button class="danger" data-del="${m.id}">Delete</button>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return (s||"").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// =============================================================================
// Event binding per view
// =============================================================================
function bindViewEvents() {
  if (state.view === "planner") bindPlanner();
  if (state.view === "grocery") bindGrocery();
  if (state.view === "batch")   bindBatch();
  if (state.view === "vault")   bindVault();
}

function bindPlanner() {
  document.querySelectorAll(".card[data-day]").forEach(el => {
    el.addEventListener("click", () => openSwap(el.dataset.day, el.dataset.slot, el.dataset.side));
  });
}

function bindGrocery() {
  document.querySelectorAll(".grocery-item input").forEach(cb => {
    cb.addEventListener("change", () => {
      const key = decodeURIComponent(cb.dataset.key);
      if (cb.checked) state.grocery[key] = true;
      else delete state.grocery[key];
      saveGrocery();
      render();
    });
  });
  document.getElementById("gr-copy")?.addEventListener("click", () => {
    const { bySection, sectionOrder } = buildGrocery();
    const lines = [];
    for (const sec of sectionOrder) {
      const items = (bySection[sec] || []).filter(n => !state.grocery[`${sec}::${n}`]);
      if (!items.length) continue;
      lines.push(sec.toUpperCase());
      items.forEach(i => lines.push(`  • ${i}`));
      lines.push("");
    }
    const text = lines.join("\n");
    navigator.clipboard.writeText(text).then(
      () => toast("Unchecked items copied"),
      () => toast("Copy failed — try the share link")
    );
  });
  document.getElementById("gr-reset")?.addEventListener("click", () => {
    state.grocery = {}; saveGrocery(); render();
  });
  document.getElementById("gr-share")?.addEventListener("click", () => makeShareLink(true));
  document.getElementById("gr-make-link")?.addEventListener("click", () => makeShareLink(false));
}

function makeShareLink(copyToo) {
  const encoded = btoa(JSON.stringify(state.grocery));
  const url = `${location.origin}${location.pathname}?view=grocery&g=${encodeURIComponent(encoded)}`;
  const box = document.getElementById("gr-link-box");
  if (box) box.innerHTML = `<span class="share-link">${url}</span>`;
  if (copyToo || true) {
    navigator.clipboard.writeText(url).then(
      () => toast("Share link copied"),
      () => toast("Link generated (copy manually)")
    );
  }
}

function bindBatch() {
  document.querySelectorAll("[data-task]").forEach(cb => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.task;
      if (cb.checked) state.batch[id] = true; else delete state.batch[id];
      saveBatch(); render();
    });
  });
  document.getElementById("batch-reset")?.addEventListener("click", () => {
    state.batch = {}; saveBatch(); render();
  });
}

function bindVault() {
  document.getElementById("vault-search").addEventListener("input", e => {
    state.vaultFilter.search = e.target.value;
    renderVaultGridOnly();
  });
  document.getElementById("vault-cat").addEventListener("change", e => {
    state.vaultFilter.category = e.target.value; renderVaultGridOnly();
  });
  document.getElementById("vault-stephen").addEventListener("change", e => {
    state.vaultFilter.stephenOnly = e.target.checked; renderVaultGridOnly();
  });
  document.getElementById("vault-add").addEventListener("click", () => openMealEditor(null));
  document.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openMealEditor(b.dataset.edit)));
  document.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.del;
    const meal = getMeal(id);
    if (!meal) return;
    if (!confirm(`Delete "${meal.name}" from the vault?`)) return;
    state.meals = state.meals.filter(m => m.id !== id);
    saveMeals();
    toast(`Deleted ${meal.name}`);
    render();
  }));
}

function renderVaultGridOnly() {
  // Re-render just the grid for responsiveness
  const { search, category, stephenOnly } = state.vaultFilter;
  const s = search.toLowerCase();
  const filtered = state.meals.filter(m => {
    if (category !== "all" && m.category !== category) return false;
    if (stephenOnly && !m.stephenFriendly) return false;
    if (s && !m.name.toLowerCase().includes(s)) return false;
    return true;
  });
  document.querySelector(".vault-grid").innerHTML = filtered.map(renderVaultCard).join("");
  document.querySelector(".vault-toolbar .muted").textContent = `(${filtered.length})`;
  document.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openMealEditor(b.dataset.edit)));
  document.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.del;
    if (!confirm(`Delete "${getMeal(id).name}" from the vault?`)) return;
    state.meals = state.meals.filter(m => m.id !== id); saveMeals(); render();
  }));
}

// =============================================================================
// SWAP DRAWER
// =============================================================================
function openSwap(day, slot, side) {
  state.swap = { day, slot, side };
  const entry = state.plan[day][slot];
  const currentId = side === "kid" ? entry.kidMealId : entry.adultMealId;
  const currentMeal = getMeal(currentId);

  const candidates = candidateMeals(slot, side, day, currentMeal);

  const body = document.getElementById("drawer-body");
  document.getElementById("drawer-title").textContent =
    `Swap ${side === "kid" ? "kid" : side === "adult" ? "adult" : "family"} ${slot} — ${DAY_FULL[day]}`;

  body.innerHTML = `
    <p class="muted">Currently: <b>${currentMeal ? currentMeal.name : "—"}</b></p>
    <p class="muted">Rules: no repeat protein within 2 days · no same meal at lunch & dinner same day · no same soup within 4 days${side==="kid" && slot==="lunch" && isSchoolDay(day) ? " · school = nut-free" : ""}</p>
    <div class="swap-list">
      ${candidates.map(({ meal, blocked, reason }) => `
        <div class="swap-option ${blocked ? "blocked" : ""}" data-id="${meal.id}">
          <div>
            <div><b>${meal.name}</b></div>
            <div class="meta">${meal.category} · A ${meal.caloriesAdult} / K ${meal.caloriesKid} cal · ${meal.proteinType}</div>
            ${blocked ? `<div class="reason">${reason}</div>` : ""}
          </div>
          <div>${meal.stephenFriendly ? "💚" : ""} ${meal.nutAlert ? "⚠" : ""}</div>
        </div>
      `).join("")}
    </div>
  `;
  document.getElementById("drawer").classList.remove("hidden");

  body.querySelectorAll(".swap-option").forEach(el => {
    if (el.classList.contains("blocked")) return;
    el.addEventListener("click", () => doSwap(el.dataset.id));
  });
}

function candidateMeals(slot, side, day, currentMeal) {
  let cats;
  if (slot === "breakfast") {
    cats = side === "kid" ? ["breakfast-kid","breakfast-adult"]
         : side === "adult" ? ["breakfast-adult"]
         : ["breakfast-adult","breakfast-kid"];
  } else if (slot === "lunch") {
    if (side === "kid") cats = isSchoolDay(day) ? ["kids-lunch"] : ["kids-lunch","lunch-adult","rice"];
    else if (side === "adult") cats = ["lunch-adult","rice"];
    else cats = ["rice","lunch-adult","protein"];
  } else { // dinner
    cats = ["soup","rice","protein"];
  }
  const list = state.meals.filter(m => cats.includes(m.category));

  // Apply rules
  return list.map(meal => {
    if (currentMeal && meal.id === currentMeal.id) return { meal, blocked: true, reason: "Already planned here" };

    // school nut-free rule
    if (side === "kid" && slot === "lunch" && isSchoolDay(day) && meal.nutAlert)
      return { meal, blocked: true, reason: "Contains nuts — not school-safe" };

    // no same meal at lunch and dinner same day
    const p = state.plan[day];
    const otherSlot = slot === "lunch" ? "dinner" : slot === "dinner" ? "lunch" : null;
    if (otherSlot) {
      const other = p[otherSlot];
      if (other && (other.adultMealId === meal.id || other.kidMealId === meal.id))
        return { meal, blocked: true, reason: "Same meal already scheduled the other part of the day" };
    }

    // no repeat protein within 2 days (only if meal has a real protein)
    if (meal.proteinType && meal.proteinType !== "none" && meal.proteinType !== "mixed") {
      const dayIdx = DAYS.indexOf(day);
      for (let delta = -2; delta <= 2; delta++) {
        if (delta === 0) continue;
        const di = dayIdx + delta;
        if (di < 0 || di > 6) continue;
        const dayKey = DAYS[di];
        const dp = state.plan[dayKey];
        for (const slotKey of ["breakfast","lunch","dinner"]) {
          const e = dp[slotKey];
          if (!e) continue;
          const ids = [e.adultMealId, e.kidMealId];
          for (const id of ids) {
            const m = getMeal(id);
            if (m && m.proteinType === meal.proteinType)
              return { meal, blocked: true, reason: `${meal.proteinType} protein already on ${DAY_FULL[dayKey]}` };
          }
        }
      }
    }

    // no same soup within 4 days (only for soups, only when slotting into dinner)
    if (meal.category === "soup" && slot === "dinner") {
      const dayIdx = DAYS.indexOf(day);
      for (let delta = -4; delta <= 4; delta++) {
        if (delta === 0) continue;
        const di = dayIdx + delta;
        if (di < 0 || di > 6) continue;
        const dayKey = DAYS[di];
        const dp = state.plan[dayKey];
        const e = dp.dinner;
        if (!e) continue;
        if (e.adultMealId === meal.id || e.kidMealId === meal.id)
          return { meal, blocked: true, reason: `Same soup on ${DAY_FULL[dayKey]} (within 4 days)` };
      }
    }

    return { meal, blocked: false };
  });
}

function doSwap(newId) {
  const { day, slot, side } = state.swap;
  const entry = state.plan[day][slot];
  if (side === "family") {
    entry.adultMealId = newId; entry.kidMealId = newId;
  } else if (side === "kid") {
    entry.kidMealId = newId;
    // kid and adult may diverge → convert family → split if different
    if (entry.type === "family" && entry.adultMealId !== newId) entry.type = "split";
  } else {
    entry.adultMealId = newId;
    if (entry.type === "family" && entry.kidMealId !== newId) entry.type = "split";
  }
  savePlan();
  closeSwap();
  render();
  toast("Meal swapped");
}

function closeSwap() {
  document.getElementById("drawer").classList.add("hidden");
  state.swap = null;
}
document.getElementById("drawer-close").addEventListener("click", closeSwap);
document.getElementById("drawer").addEventListener("click", e => {
  if (e.target.id === "drawer") closeSwap();
});

// =============================================================================
// MEAL EDITOR MODAL
// =============================================================================
function openMealEditor(id) {
  const isNew = !id;
  const meal = isNew ? {
    id: "", name: "", category: "rice", cuisine: "mixed",
    caloriesAdult: 400, caloriesKid: 450, proteinType: "mixed",
    kidsFriendly: true, nutAlert: false, stephenFriendly: false,
    stephenBenefits: [], prepTime: 30, notes: ""
  } : structuredClone(getMeal(id));

  document.getElementById("modal-title").textContent = isNew ? "Add meal" : "Edit meal";
  const body = document.getElementById("modal-body");
  body.innerHTML = `
    <div class="form-grid">
      <div class="full"><label>Name</label><input id="f-name" value="${escapeHtml(meal.name)}"></div>
      <div><label>Category</label>
        <select id="f-cat">
          ${["soup","rice","swallow","protein","breakfast-adult","breakfast-kid","kids-lunch","lunch-adult"]
            .map(c => `<option ${c===meal.category?"selected":""}>${c}</option>`).join("")}
        </select>
      </div>
      <div><label>Cuisine</label>
        <select id="f-cuisine">
          ${["nigerian","western","mixed"].map(c => `<option ${c===meal.cuisine?"selected":""}>${c}</option>`).join("")}
        </select>
      </div>
      <div><label>Calories (adult)</label><input id="f-ca" type="number" value="${meal.caloriesAdult}"></div>
      <div><label>Calories (kid)</label><input id="f-ck" type="number" value="${meal.caloriesKid}"></div>
      <div><label>Protein type</label>
        <select id="f-pt">
          ${["chicken","beef","goat","fish","shrimp","turkey","egg","bean","mixed","none"]
            .map(p => `<option ${p===meal.proteinType?"selected":""}>${p}</option>`).join("")}
        </select>
      </div>
      <div><label>Prep time (min)</label><input id="f-prep" type="number" value="${meal.prepTime}"></div>
      <div class="full checkrow">
        <label><input id="f-kids" type="checkbox" ${meal.kidsFriendly?"checked":""}> Kids-friendly</label>
        <label><input id="f-nut" type="checkbox" ${meal.nutAlert?"checked":""}> Contains nuts</label>
        <label><input id="f-steph" type="checkbox" ${meal.stephenFriendly?"checked":""}> Stephen-friendly</label>
      </div>
      <div class="full"><label>Stephen benefits</label>
        <div class="checkrow">
          ${["blood-pressure","prediabetes","anti-inflammatory"].map(b =>
            `<label><input type="checkbox" class="f-benefit" value="${b}" ${meal.stephenBenefits?.includes(b)?"checked":""}> ${b}</label>`
          ).join("")}
        </div>
      </div>
      <div class="full"><label>Notes</label><textarea id="f-notes" rows="3">${escapeHtml(meal.notes||"")}</textarea></div>
    </div>
    <div class="modal-actions">
      <button id="f-cancel">Cancel</button>
      <button id="f-save" class="primary">${isNew ? "Add meal" : "Save changes"}</button>
    </div>
  `;
  document.getElementById("modal").classList.remove("hidden");

  document.getElementById("f-cancel").addEventListener("click", closeModal);
  document.getElementById("f-save").addEventListener("click", () => {
    const name = document.getElementById("f-name").value.trim();
    if (!name) { toast("Name required"); return; }
    const m = {
      id: isNew ? slugify(name) + "-" + Date.now().toString(36) : meal.id,
      name,
      category: document.getElementById("f-cat").value,
      cuisine:  document.getElementById("f-cuisine").value,
      caloriesAdult: +document.getElementById("f-ca").value || 0,
      caloriesKid:   +document.getElementById("f-ck").value || 0,
      proteinType:   document.getElementById("f-pt").value,
      kidsFriendly:   document.getElementById("f-kids").checked,
      nutAlert:       document.getElementById("f-nut").checked,
      stephenFriendly:document.getElementById("f-steph").checked,
      stephenBenefits:[...document.querySelectorAll(".f-benefit:checked")].map(x => x.value),
      prepTime:      +document.getElementById("f-prep").value || 0,
      notes:         document.getElementById("f-notes").value.trim(),
    };
    if (isNew) state.meals.push(m);
    else {
      const idx = state.meals.findIndex(x => x.id === meal.id);
      state.meals[idx] = m;
    }
    saveMeals();
    closeModal();
    toast(isNew ? "Meal added" : "Meal saved");
    render();
  });
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0, 30);
}

function closeModal() { document.getElementById("modal").classList.add("hidden"); }
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal").addEventListener("click", e => {
  if (e.target.id === "modal") closeModal();
});

// Initial URL view routing
const initialView = new URLSearchParams(location.search).get("view");
if (initialView && ["planner","grocery","batch","vault"].includes(initialView)) {
  state.view = initialView;
  document.querySelectorAll("#tabs button").forEach(b =>
    b.classList.toggle("active", b.dataset.view === initialView));
}

render();
