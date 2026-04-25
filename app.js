/* ---------------------------------------------------------
   Family Meals — app logic (Paprika-style, multi-week)
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

const CATEGORY_EMOJI = {
  "soup":            "🍲",
  "rice":            "🍚",
  "swallow":         "🍡",
  "protein":         "🍗",
  "breakfast-adult": "🍳",
  "breakfast-kid":   "🥞",
  "kids-lunch":      "🥪",
  "lunch-adult":     "🥗",
};

// =============================================================================
// Date / week helpers
// =============================================================================
function startOfWeek(d) {
  const x = new Date(d); x.setHours(0,0,0,0);
  x.setDate(x.getDate() - x.getDay()); // back to Sunday
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function weekKey(d) { return startOfWeek(d).toISOString().slice(0,10); }
function fmtDate(d, opts={month:"short",day:"numeric"}) { return d.toLocaleDateString(undefined, opts); }
function fmtDateLong(d) { return d.toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric", year:"numeric" }); }

// =============================================================================
// State + persistence
// =============================================================================
const state = {
  view: "planner",
  meals: loadMeals(),
  plans:    loadPlans(),    // { weekKey: { Sun: {...}, ... } }
  groceries: loadGroceries(),// { weekKey: { itemKey: true } }
  batches:   loadBatches(), // { weekKey: { taskId: true } }
  weekStart: weekKey(new Date()), // current viewed week
  vaultFilter: { search: "", category: "all", stephenOnly: false },
  swap: null,
  recipeDetailId: null,
};

function loadMeals() {
  const saved = localStorage.getItem("fm.meals");
  let arr;
  if (saved) { try { arr = JSON.parse(saved); } catch {} }
  if (!arr) arr = structuredClone(DEFAULT_MEALS);
  // Backfill new fields on existing data
  for (const m of arr) {
    if (!m.image) m.image = CATEGORY_EMOJI[m.category] || "🍽";
    if (m.servings == null) m.servings = m.category === "kids-lunch" ? 3 : 5;
    if (m.instructions == null) m.instructions = "";
  }
  return arr;
}
function saveMeals() { localStorage.setItem("fm.meals", JSON.stringify(state.meals)); }

function loadPlans() {
  const saved = localStorage.getItem("fm.plans");
  if (saved) { try { return JSON.parse(saved); } catch {} }
  // Migrate from v1 single-plan storage
  const oldPlan = localStorage.getItem("fm.plan");
  if (oldPlan) {
    try {
      const obj = {};
      obj[weekKey(new Date())] = JSON.parse(oldPlan);
      localStorage.setItem("fm.plans", JSON.stringify(obj));
      return obj;
    } catch {}
  }
  return {};
}
function savePlans() { localStorage.setItem("fm.plans", JSON.stringify(state.plans)); }

function loadGroceries() {
  const urlState = new URLSearchParams(location.search).get("g");
  const urlWeek  = new URLSearchParams(location.search).get("gw");
  const saved = localStorage.getItem("fm.groceries");
  let map = {};
  if (saved) { try { map = JSON.parse(saved); } catch {} }
  else {
    // migrate
    const oldG = localStorage.getItem("fm.grocery");
    if (oldG) try { map[weekKey(new Date())] = JSON.parse(oldG); } catch {}
  }
  if (urlState && urlWeek) {
    try {
      const decoded = JSON.parse(atob(decodeURIComponent(urlState)));
      map[urlWeek] = decoded;
      localStorage.setItem("fm.groceries", JSON.stringify(map));
    } catch {}
  }
  return map;
}
function saveGroceries() { localStorage.setItem("fm.groceries", JSON.stringify(state.groceries)); }

function loadBatches() {
  const saved = localStorage.getItem("fm.batches");
  if (saved) { try { return JSON.parse(saved); } catch {} }
  const oldB = localStorage.getItem("fm.batch");
  if (oldB) {
    try { const o = {}; o[weekKey(new Date())] = JSON.parse(oldB); return o; } catch {}
  }
  return {};
}
function saveBatches() { localStorage.setItem("fm.batches", JSON.stringify(state.batches)); }

// =============================================================================
// Per-week accessors (auto-seeded with rotation)
// =============================================================================
function currentPlan() {
  if (!state.plans[state.weekStart]) {
    // First-ever week → use the curated default. Subsequent new weeks → auto-generate variety.
    state.plans[state.weekStart] = (Object.keys(state.plans).length === 0)
      ? structuredClone(DEFAULT_PLAN)
      : generateWeek(state.weekStart);
    savePlans();
  }
  return state.plans[state.weekStart];
}
// -------- Auto-rotation engine --------
function seededRandom(seed) {
  return function() {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickN(arr, n, rand) { return shuffle(arr, rand).slice(0, n); }

function collectRecentMeals(beforeWk, lookback) {
  const keys = Object.keys(state.plans).filter(k => k < beforeWk).sort().slice(-lookback);
  const out = { soup:new Set(), bAdult:new Set(), bKid:new Set(), kLunch:new Set(), aLunch:new Set() };
  for (const k of keys) {
    const p = state.plans[k];
    for (const day of DAYS) {
      const dp = p[day]; if (!dp) continue;
      for (const slot of ["breakfast","lunch","dinner"]) {
        const e = dp[slot]; if (!e) continue;
        for (const id of [e.adultMealId, e.kidMealId, e.adultSideId, e.kidSideId]) {
          if (!id) continue;
          const m = getMeal(id); if (!m) continue;
          if (m.category === "soup")            out.soup.add(id);
          if (m.category === "breakfast-adult") out.bAdult.add(id);
          if (m.category === "breakfast-kid")   out.bKid.add(id);
          if (m.category === "kids-lunch")      out.kLunch.add(id);
          if (m.category === "lunch-adult")     out.aLunch.add(id);
        }
      }
    }
  }
  return out;
}

function preferUnused(pool, recentSet, minNeeded) {
  const fresh = pool.filter(m => !recentSet.has(m.id));
  return fresh.length >= minNeeded ? fresh : pool;
}

// Build a varied week from the vault. Deterministic per weekKey unless `shuffle:true`.
function generateWeek(wk, opts = {}) {
  const seed = opts.shuffle ? Date.now() : seedFromString(wk);
  const rand = seededRandom(seed);
  const recent = collectRecentMeals(wk, 4);

  const byCat = c => state.meals.filter(m => m.category === c);

  // 3 soups, prefer not used in last 4 weeks
  const soups = pickN(preferUnused(byCat("soup"), recent.soup, 3), 3, rand);
  if (soups.length < 3) return structuredClone(DEFAULT_PLAN);

  // For each soup pick 2 different carbs from swallow pool
  const swallows = byCat("swallow");
  const carbPairs = soups.map(() => pickN(swallows, Math.min(2, swallows.length), rand));

  // Adult breakfasts: pick 2 distinct (Stephen-friendly preferred for one slot)
  const adultBfasts = pickN(preferUnused(byCat("breakfast-adult"), recent.bAdult, 2), 2, rand);
  while (adultBfasts.length < 2) adultBfasts.push(adultBfasts[0]);

  // Kid breakfasts: 2 distinct
  const kidBfasts = pickN(preferUnused(byCat("breakfast-kid"), recent.bKid, 2), 2, rand);
  while (kidBfasts.length < 2) kidBfasts.push(kidBfasts[0]);

  // Adult weekday lunches: 5
  const aLunchPool = preferUnused(byCat("lunch-adult"), recent.aLunch, 3);
  const aLunches = [];
  for (let i = 0; i < 5; i++) aLunches.push(aLunchPool[Math.floor(rand() * aLunchPool.length)]);

  // Kids school lunches: 5 distinct, school-safe (no nuts)
  const slPool0 = byCat("kids-lunch").filter(m => !m.nutAlert);
  const slPool = preferUnused(slPool0, recent.kLunch, 5);
  let kLunches = pickN(slPool, 5, rand);
  if (kLunches.length < 5) kLunches = pickN(slPool0, 5, rand);

  // Saturday flex: pick a protein meal + a swallow
  const protein = pickN(byCat("protein"), 1, rand)[0];
  const satCarb = pickN(swallows, 1, rand)[0];

  // Sunday & Saturday family lunch: a rice meal
  const riceFam = pickN(byCat("rice"), 2, rand);
  const sunLunch = riceFam[0];
  const satLunch = riceFam[1] || riceFam[0];

  const fam = mealId => ({ type:"family", adultMealId:mealId, kidMealId:mealId });
  const split = (a, k) => ({ type:"split", adultMealId:a, kidMealId:k });
  const dinnerEntry = (soupIdx, dayIdx, fresh) => {
    const s = soups[soupIdx], c = carbPairs[soupIdx][dayIdx];
    return { type:"family", adultMealId:s.id, kidMealId:s.id,
             adultSideId:c.id, kidSideId:c.id,
             freshCook: fresh, repeat: !fresh, soupKey: s.id };
  };

  return {
    Sun: {
      breakfast: fam(adultBfasts[0].id),
      lunch:     fam(sunLunch.id),
      dinner:    dinnerEntry(0, 0, true),
    },
    Mon: {
      breakfast: split(adultBfasts[1].id, kidBfasts[0].id),
      lunch:     split(aLunches[0].id, kLunches[0].id),
      dinner:    dinnerEntry(1, 0, true),
    },
    Tue: {
      breakfast: split(adultBfasts[0].id, kidBfasts[1].id),
      lunch:     split(aLunches[1].id, kLunches[1].id),
      dinner:    dinnerEntry(2, 0, true),
    },
    Wed: {
      breakfast: split(adultBfasts[1].id, kidBfasts[0].id),
      lunch:     split(aLunches[2].id, kLunches[2].id),
      dinner:    dinnerEntry(0, 1, false),
    },
    Thu: {
      breakfast: split(adultBfasts[0].id, kidBfasts[1].id),
      lunch:     split(aLunches[3].id, kLunches[3].id),
      dinner:    dinnerEntry(1, 1, false),
    },
    Fri: {
      breakfast: split(adultBfasts[1].id, kidBfasts[0].id),
      lunch:     split(aLunches[4].id, kLunches[4].id),
      dinner:    dinnerEntry(2, 1, false),
    },
    Sat: {
      breakfast: fam(adultBfasts[0].id),
      lunch:     fam(satLunch.id),
      dinner:    { type:"family", adultMealId:protein.id, kidMealId:protein.id,
                   adultSideId:satCarb.id, kidSideId:satCarb.id, flex:true },
    },
  };
}

function currentGrocery() {
  if (!state.groceries[state.weekStart]) state.groceries[state.weekStart] = {};
  return state.groceries[state.weekStart];
}
function currentBatch() {
  if (!state.batches[state.weekStart]) state.batches[state.weekStart] = {};
  return state.batches[state.weekStart];
}

// =============================================================================
// Helpers
// =============================================================================
const getMeal = id => state.meals.find(m => m.id === id);
const isSchoolDay = day => SCHOOL_DAYS.includes(day);

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

function escapeHtml(s) {
  return (s||"").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// =============================================================================
// View switch
// =============================================================================
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
// PLANNER (with week navigation)
// =============================================================================
function renderPlanner() {
  const sun = startOfWeek(new Date(state.weekStart + "T00:00:00"));
  const sat = addDays(sun, 6);
  const todayKey = weekKey(new Date());
  const isThisWeek = state.weekStart === todayKey;

  const plan = currentPlan();

  return `
    <div class="planner-toolbar">
      <div class="week-nav">
        <button id="wk-prev" title="Previous week">‹</button>
        <div class="week-label">
          <h2>${fmtDate(sun)} – ${fmtDate(sat, {month:"short",day:"numeric",year:"numeric"})}</h2>
          <p class="muted">${isThisWeek ? "This week" : (state.weekStart < todayKey ? "Past week" : "Upcoming week")} · tap any meal to swap</p>
        </div>
        <button id="wk-next" title="Next week">›</button>
        ${!isThisWeek ? `<button id="wk-today">Jump to today</button>` : ""}
        <button id="wk-shuffle" class="primary" title="Re-roll this week from the recipe vault">🎲 Shuffle week</button>
        <button id="wk-clone" class="ghost" title="Replace this week with the original default template">Reset to template</button>
      </div>
      <div class="legend">
        <span><span class="dot family"></span>Family shares</span>
        <span><span class="dot adults"></span>Adults only</span>
        <span><span class="dot kids"></span>Kids only</span>
        <span>↻ repeat · 🔥 fresh cook · ✨ flex</span>
      </div>
    </div>
    <div class="week-grid">
      ${DAYS.map((d, i) => renderDay(d, addDays(sun, i), plan)).join("")}
    </div>
  `;
}

function renderDay(day, dateObj, plan) {
  const p = plan[day] || {};
  const tag = day === "Sat" ? "✨ flex cook"
            : day === "Sun" ? "🔥 batch cook"
            : isSchoolDay(day) ? "school day" : "";
  const dateLabel = `${dateObj.getMonth()+1}/${dateObj.getDate()}`;
  return `
    <div class="day">
      <div class="day-head">
        <h3>${DAY_FULL[day]} <span class="day-num">${dateLabel}</span></h3>
        <span class="tag">${tag}</span>
      </div>
      ${renderSlot(day, "breakfast", p.breakfast)}
      ${renderSlot(day, "lunch",     p.lunch)}
      ${renderSlot(day, "dinner",    p.dinner)}
    </div>
  `;
}

function renderSlot(day, slot, entry) {
  if (!entry) {
    return `<div class="card empty" data-day="${day}" data-slot="${slot}" data-side="family">
              <div class="slot-label">${slot}</div>
              <div class="empty-text">+ tap to add</div>
            </div>`;
  }
  if (entry.type === "family") {
    return slotCard({ klass: "family", slot, day, side: "family",
      mealId: entry.adultMealId, sideId: entry.adultSideId, entry });
  }
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
  if (klass === "family")     calLine = `<span>Adults <b>${adultCal}</b></span><span>Kids <b>${kidCal}</b></span>`;
  else if (klass === "adults")calLine = `<span>Adult <b>${adultCal}</b> cal</span>`;
  else                         calLine = `<span>Kid <b>${kidCal}</b> cal</span>`;

  const subline = sideMeal ? `with <b>${sideMeal.name}</b>` : (meal.notes || "");
  const slotLabel = side === "adult" ? `Adult · ${slot}`
                  : side === "kid"   ? `Kid · ${slot}` : slot;

  return `
    <div class="card ${klass}" data-day="${day}" data-slot="${slot}" data-side="${side}">
      <div class="card-top">
        <div class="card-img">${meal.image || CATEGORY_EMOJI[meal.category] || "🍽"}</div>
        <div class="card-info">
          <div class="slot-label">${slotLabel}${nutContext && meal.nutAlert ? " · ⚠ NUT" : ""}</div>
          <div class="meal-name">${meal.name}</div>
        </div>
      </div>
      ${subline ? `<div class="sub-line">${subline}</div>` : ""}
      <div class="cal-row">${calLine}</div>
      ${badges.length ? `<div class="badges">${badges.map(b => `<span class="badge ${b.klass}">${b.text}</span>`).join("")}</div>` : ""}
    </div>
  `;
}

// =============================================================================
// GROCERY (per-week)
// =============================================================================
function buildGrocery() {
  const plan = currentPlan();
  const set = new Map();
  for (const day of DAYS) {
    const p = plan[day] || {};
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
  const grocery = currentGrocery();
  let total = 0, done = 0;
  const sections = sectionOrder.map(sec => {
    const items = bySection[sec] || [];
    if (!items.length) return "";
    const itemsHtml = items.map(name => {
      const key = `${sec}::${name}`;
      total++;
      const checked = !!grocery[key];
      if (checked) done++;
      return `
        <label class="grocery-item ${checked ? "done" : ""}">
          <input type="checkbox" data-key="${encodeURIComponent(key)}" ${checked ? "checked" : ""}>
          <span>${name}</span>
        </label>
      `;
    }).join("");
    return `<div class="grocery-section"><h3>${sec}</h3><div class="grocery-items">${itemsHtml}</div></div>`;
  }).join("");

  const sun = startOfWeek(new Date(state.weekStart + "T00:00:00"));
  const sat = addDays(sun, 6);

  return `
    <div class="grocery-toolbar">
      <h2>Grocery list — ${fmtDate(sun)} – ${fmtDate(sat)}</h2>
      <span class="spacer"></span>
      <button id="gr-copy" class="primary">📋 Copy unchecked</button>
      <button id="gr-share">🔗 Shareable link</button>
      <button id="gr-reset" class="ghost">Reset ticks</button>
      <span class="count-pill">${total - done} of ${total} left</span>
    </div>
    <div class="grocery-layout">
      <div>${sections}</div>
      <aside class="sticky-side">
        <h3>Share with Stephen</h3>
        <p>Generates a link with this week's tick state baked in. Whoever opens it sees the same checks.</p>
        <button id="gr-make-link" class="primary">Generate link</button>
        <div id="gr-link-box"></div>
      </aside>
    </div>
  `;
}

// =============================================================================
// BATCH COOK (per-week)
// =============================================================================
function renderBatch() {
  const tasks = BATCH_TASKS;
  const batch = currentBatch();
  const done = tasks.filter(t => batch[t.id]).length;
  const pct = Math.round((done / tasks.length) * 100);

  const byDay = {};
  for (const t of tasks) (byDay[t.day] ||= []).push(t);

  const dayBlocks = ["Saturday","Sunday"].map(day => {
    const list = byDay[day] || [];
    return `<h3 class="batch-day-head">${day} — ${list.length} task${list.length === 1 ? "" : "s"}</h3>
            ${list.map(t => renderBatchTask(t, batch)).join("")}`;
  }).join("");

  const sun = startOfWeek(new Date(state.weekStart + "T00:00:00"));
  const sat = addDays(sun, 6);

  return `
    <div class="batch-toolbar">
      <h2>Batch cook — ${fmtDate(sun)} – ${fmtDate(sat)}</h2>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <span class="muted">${done}/${tasks.length} · ${pct}%</span>
      <button id="batch-reset" class="ghost">Reset</button>
    </div>
    ${dayBlocks}
  `;
}

function renderBatchTask(t, batch) {
  const done = !!batch[t.id];
  return `
    <label class="batch-task ${done ? "done" : ""}">
      <input type="checkbox" data-task="${t.id}" ${done ? "checked" : ""}>
      <div style="flex:1">
        <div class="title">${t.title}</div>
        <div class="meta"><span>⏱ ${t.minutes} min</span><span>🍽 Feeds: ${t.feeds}</span></div>
        <div class="storage">📦 ${t.storage}</div>
      </div>
    </label>
  `;
}

// =============================================================================
// VAULT (Paprika-style cards)
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
      <h2>Recipes <span class="muted">(${filtered.length})</span></h2>
      <span class="spacer"></span>
      <input id="vault-search" placeholder="Search recipes…" value="${escapeHtml(search)}">
      <select id="vault-cat">
        <option value="all">All categories</option>
        ${cats.map(c => `<option value="${c}" ${c===category?"selected":""}>${c}</option>`).join("")}
      </select>
      <label class="row" style="gap:6px;">
        <input type="checkbox" id="vault-stephen" style="width:auto" ${stephenOnly?"checked":""}>
        Stephen-friendly only
      </label>
      <button id="vault-add" class="primary">+ Add recipe</button>
    </div>
    <div class="vault-grid">
      ${filtered.map(renderVaultCard).join("")}
    </div>
  `;
}

function renderVaultCard(m) {
  const badges = badgesFor(m, { nutAlertContext: true });
  return `
    <div class="vault-card" data-detail="${m.id}">
      <div class="vault-img">${m.image || CATEGORY_EMOJI[m.category] || "🍽"}</div>
      <div class="vault-body">
        <div class="cat">${m.category} · ${m.cuisine}</div>
        <div class="name">${m.name}</div>
        <div class="calrow">A <b>${m.caloriesAdult}</b> · K <b>${m.caloriesKid}</b> · ⏱ ${m.prepTime}m · serves ${m.servings || 5}</div>
        <div class="tagrow">
          ${m.kidsFriendly ? `<span class="pill">kids</span>` : ""}
          ${m.stephenFriendly ? `<span class="pill">Stephen</span>` : ""}
          <span class="pill">${m.proteinType}</span>
          ${badges.map(b => `<span class="badge ${b.klass}">${b.text}</span>`).join("")}
        </div>
      </div>
    </div>
  `;
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
  document.getElementById("wk-prev")?.addEventListener("click", () => navWeek(-7));
  document.getElementById("wk-next")?.addEventListener("click", () => navWeek(+7));
  document.getElementById("wk-today")?.addEventListener("click", () => {
    state.weekStart = weekKey(new Date()); render();
  });
  document.getElementById("wk-shuffle")?.addEventListener("click", () => {
    state.plans[state.weekStart] = generateWeek(state.weekStart, { shuffle: true });
    savePlans(); render(); toast("Fresh meals shuffled in 🎲");
  });
  document.getElementById("wk-clone")?.addEventListener("click", () => {
    if (!confirm("Replace this week with the original default template?")) return;
    state.plans[state.weekStart] = structuredClone(DEFAULT_PLAN);
    savePlans(); render(); toast("Week reset to template");
  });
}

function navWeek(deltaDays) {
  const d = new Date(state.weekStart + "T00:00:00");
  state.weekStart = weekKey(addDays(d, deltaDays));
  render();
}

function bindGrocery() {
  document.querySelectorAll(".grocery-item input").forEach(cb => {
    cb.addEventListener("change", () => {
      const key = decodeURIComponent(cb.dataset.key);
      const g = currentGrocery();
      if (cb.checked) g[key] = true; else delete g[key];
      saveGroceries();
      render();
    });
  });
  document.getElementById("gr-copy")?.addEventListener("click", () => {
    const { bySection, sectionOrder } = buildGrocery();
    const g = currentGrocery();
    const lines = [];
    for (const sec of sectionOrder) {
      const items = (bySection[sec] || []).filter(n => !g[`${sec}::${n}`]);
      if (!items.length) continue;
      lines.push(sec.toUpperCase());
      items.forEach(i => lines.push(`  • ${i}`));
      lines.push("");
    }
    navigator.clipboard.writeText(lines.join("\n")).then(
      () => toast("Unchecked items copied"),
      () => toast("Copy failed — try the share link")
    );
  });
  document.getElementById("gr-reset")?.addEventListener("click", () => {
    state.groceries[state.weekStart] = {}; saveGroceries(); render();
  });
  document.getElementById("gr-share")?.addEventListener("click", () => makeShareLink());
  document.getElementById("gr-make-link")?.addEventListener("click", () => makeShareLink());
}

function makeShareLink() {
  const encoded = btoa(JSON.stringify(currentGrocery()));
  const url = `${location.origin}${location.pathname}?view=grocery&gw=${state.weekStart}&g=${encodeURIComponent(encoded)}`;
  const box = document.getElementById("gr-link-box");
  if (box) box.innerHTML = `<span class="share-link">${url}</span>`;
  navigator.clipboard.writeText(url).then(
    () => toast("Share link copied"),
    () => toast("Link generated (copy manually)")
  );
}

function bindBatch() {
  document.querySelectorAll("[data-task]").forEach(cb => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.task;
      const b = currentBatch();
      if (cb.checked) b[id] = true; else delete b[id];
      saveBatches(); render();
    });
  });
  document.getElementById("batch-reset")?.addEventListener("click", () => {
    state.batches[state.weekStart] = {}; saveBatches(); render();
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
  document.querySelectorAll("[data-detail]").forEach(c => {
    c.addEventListener("click", () => openRecipeDetail(c.dataset.detail));
  });
}

function renderVaultGridOnly() {
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
  document.querySelectorAll("[data-detail]").forEach(c => {
    c.addEventListener("click", () => openRecipeDetail(c.dataset.detail));
  });
}

// =============================================================================
// RECIPE DETAIL (Paprika-style)
// =============================================================================
function openRecipeDetail(id) {
  const m = getMeal(id);
  if (!m) return;
  state.recipeDetailId = id;

  const ingredients = MEAL_INGREDIENTS[id] || [];
  const ingBySection = {};
  for (const [name, section] of ingredients) (ingBySection[section] ||= []).push(name);

  const badges = badgesFor(m, { nutAlertContext: true });

  document.getElementById("recipe-modal").innerHTML = `
    <div class="recipe-inner">
      <button class="icon-btn recipe-close" id="recipe-close" aria-label="Close">✕</button>
      <div class="recipe-hero">
        <div class="recipe-img">${m.image || CATEGORY_EMOJI[m.category] || "🍽"}</div>
        <div class="recipe-meta">
          <div class="cat">${m.category} · ${m.cuisine}</div>
          <h1>${m.name}</h1>
          <div class="recipe-stats">
            <span>⏱ <b>${m.prepTime}</b> min</span>
            <span>🍽 Serves <b>${m.servings || 5}</b></span>
            <span>Adult <b>${m.caloriesAdult}</b> cal</span>
            <span>Kid <b>${m.caloriesKid}</b> cal</span>
          </div>
          <div class="tagrow">
            ${m.kidsFriendly ? `<span class="pill">kids ok</span>` : ""}
            ${m.stephenFriendly ? `<span class="pill">Stephen ok</span>` : ""}
            <span class="pill">${m.proteinType}</span>
            ${badges.map(b => `<span class="badge ${b.klass}">${b.text}</span>`).join("")}
          </div>
          ${m.notes ? `<p class="muted">${escapeHtml(m.notes)}</p>` : ""}
          <div class="recipe-actions">
            <button id="recipe-schedule" class="primary">📅 Schedule on plan</button>
            <button id="recipe-edit">✏️ Edit recipe</button>
            <button id="recipe-delete" class="danger">Delete</button>
          </div>
        </div>
      </div>

      <div class="recipe-body">
        <section>
          <h2>Ingredients</h2>
          ${Object.keys(ingBySection).length === 0
            ? `<p class="muted">No ingredients listed yet — edit the recipe to add some.</p>`
            : Object.entries(ingBySection).map(([sec, items]) => `
              <h4>${sec}</h4>
              <ul class="ing-list">${items.map(n => `<li>${n}</li>`).join("")}</ul>
            `).join("")}
        </section>
        <section>
          <h2>Directions</h2>
          ${m.instructions
            ? `<div class="directions">${escapeHtml(m.instructions).split(/\n+/).map((p,i) => `<p><span class="step-num">${i+1}</span>${p}</p>`).join("")}</div>`
            : `<p class="muted">No directions yet — click <b>Edit recipe</b> to add cooking steps.</p>`}
        </section>
      </div>
    </div>
  `;
  document.getElementById("recipe-modal").classList.remove("hidden");
  document.getElementById("recipe-close").onclick = closeRecipe;
  document.getElementById("recipe-edit").onclick = () => { closeRecipe(); openMealEditor(id); };
  document.getElementById("recipe-delete").onclick = () => {
    if (!confirm(`Delete "${m.name}" from the vault?`)) return;
    state.meals = state.meals.filter(x => x.id !== id);
    saveMeals();
    closeRecipe();
    toast(`Deleted ${m.name}`);
    render();
  };
  document.getElementById("recipe-schedule").onclick = () => openScheduler(id);
}

function closeRecipe() {
  document.getElementById("recipe-modal").classList.add("hidden");
  state.recipeDetailId = null;
}
document.getElementById("recipe-modal").addEventListener("click", e => {
  if (e.target.id === "recipe-modal") closeRecipe();
});

// =============================================================================
// SCHEDULER (Schedule a recipe onto the plan)
// =============================================================================
function openScheduler(mealId) {
  const meal = getMeal(mealId);
  if (!meal) return;
  // Build next-14-day options
  const today = new Date(); today.setHours(0,0,0,0);
  const opts = [];
  for (let i = 0; i < 21; i++) {
    const d = addDays(today, i);
    const dayKey = DAYS[d.getDay()];
    opts.push({
      iso: d.toISOString().slice(0,10),
      wk:  weekKey(d),
      dayKey,
      label: `${DAY_FULL[dayKey]}, ${fmtDate(d, {month:"short", day:"numeric"})}`
    });
  }
  const slotChoices = (meal.category === "breakfast-adult" || meal.category === "breakfast-kid")
    ? ["breakfast"]
    : meal.category === "kids-lunch" || meal.category === "lunch-adult"
      ? ["lunch"]
      : ["breakfast","lunch","dinner"];
  const sideChoices = (meal.category === "kids-lunch" || meal.category === "breakfast-kid") ? ["kid"]
                    : (meal.category === "lunch-adult" || meal.category === "breakfast-adult") ? ["adult"]
                    : ["family","adult","kid"];

  const body = document.getElementById("modal-body");
  document.getElementById("modal-title").textContent = `Schedule: ${meal.name}`;
  body.innerHTML = `
    <div class="form-grid">
      <div class="full"><label>Day</label>
        <select id="sch-day">${opts.map(o => `<option value="${o.iso}|${o.wk}|${o.dayKey}">${o.label}</option>`).join("")}</select>
      </div>
      <div><label>Slot</label>
        <select id="sch-slot">${slotChoices.map(s => `<option>${s}</option>`).join("")}</select>
      </div>
      <div><label>Who</label>
        <select id="sch-side">${sideChoices.map(s => `<option value="${s}">${s === "family" ? "Whole family" : s === "adult" ? "Adults only" : "Kids only"}</option>`).join("")}</select>
      </div>
    </div>
    <div class="modal-actions">
      <button id="sch-cancel">Cancel</button>
      <button id="sch-save" class="primary">Schedule</button>
    </div>
  `;
  document.getElementById("modal").classList.remove("hidden");

  document.getElementById("sch-cancel").onclick = closeModal;
  document.getElementById("sch-save").onclick = () => {
    const [iso, wk, dayKey] = document.getElementById("sch-day").value.split("|");
    const slot = document.getElementById("sch-slot").value;
    const side = document.getElementById("sch-side").value;

    if (!state.plans[wk]) {
      const earlier = Object.keys(state.plans).filter(k => k < wk).sort().pop();
      state.plans[wk] = earlier ? structuredClone(state.plans[earlier]) : structuredClone(DEFAULT_PLAN);
    }
    const dayPlan = (state.plans[wk][dayKey] ||= {});
    const existing = dayPlan[slot] || {};
    const next = { ...existing };
    if (side === "family") {
      next.type = "family";
      next.adultMealId = mealId;
      next.kidMealId   = mealId;
    } else if (side === "adult") {
      next.type = existing.kidMealId && existing.kidMealId !== mealId ? "split" : "family";
      next.adultMealId = mealId;
      if (!next.kidMealId) next.kidMealId = mealId;
    } else { // kid
      next.type = existing.adultMealId && existing.adultMealId !== mealId ? "split" : "family";
      next.kidMealId = mealId;
      if (!next.adultMealId) next.adultMealId = mealId;
    }
    if (next.adultMealId === next.kidMealId) next.type = "family";
    dayPlan[slot] = next;
    savePlans();
    closeModal();
    state.weekStart = wk;
    state.view = "planner";
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === "planner"));
    render();
    toast(`${meal.name} scheduled`);
  };
}

// =============================================================================
// SWAP DRAWER
// =============================================================================
function openSwap(day, slot, side) {
  state.swap = { day, slot, side };
  const plan = currentPlan();
  const entry = (plan[day] && plan[day][slot]) || {};
  const currentId = side === "kid" ? entry.kidMealId : entry.adultMealId;
  const currentMeal = currentId ? getMeal(currentId) : null;

  const candidates = candidateMeals(slot, side, day, currentMeal);

  const body = document.getElementById("drawer-body");
  document.getElementById("drawer-title").textContent =
    `Swap ${side === "kid" ? "kid" : side === "adult" ? "adult" : "family"} ${slot} — ${DAY_FULL[day]}`;

  body.innerHTML = `
    <p class="muted">Currently: <b>${currentMeal ? currentMeal.name : "— empty —"}</b></p>
    <p class="muted">Rules: no repeat protein within 2 days · no same meal at lunch & dinner same day · no same soup within 4 days${side==="kid" && slot==="lunch" && isSchoolDay(day) ? " · school = nut-free" : ""}</p>
    <div class="swap-list">
      ${candidates.map(({ meal, blocked, reason }) => `
        <div class="swap-option ${blocked ? "blocked" : ""}" data-id="${meal.id}">
          <div class="swap-img">${meal.image || CATEGORY_EMOJI[meal.category] || "🍽"}</div>
          <div style="flex:1">
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
  } else {
    cats = ["soup","rice","protein"];
  }
  const list = state.meals.filter(m => cats.includes(m.category));
  const plan = currentPlan();

  return list.map(meal => {
    if (currentMeal && meal.id === currentMeal.id) return { meal, blocked: true, reason: "Already planned here" };

    if (side === "kid" && slot === "lunch" && isSchoolDay(day) && meal.nutAlert)
      return { meal, blocked: true, reason: "Contains nuts — not school-safe" };

    const otherSlot = slot === "lunch" ? "dinner" : slot === "dinner" ? "lunch" : null;
    if (otherSlot) {
      const other = plan[day] && plan[day][otherSlot];
      if (other && (other.adultMealId === meal.id || other.kidMealId === meal.id))
        return { meal, blocked: true, reason: "Same meal already scheduled the other part of the day" };
    }

    if (meal.proteinType && meal.proteinType !== "none" && meal.proteinType !== "mixed") {
      const dayIdx = DAYS.indexOf(day);
      for (let delta = -2; delta <= 2; delta++) {
        if (delta === 0) continue;
        const di = dayIdx + delta;
        if (di < 0 || di > 6) continue;
        const dayKey = DAYS[di];
        const dp = plan[dayKey] || {};
        for (const slotKey of ["breakfast","lunch","dinner"]) {
          const e = dp[slotKey];
          if (!e) continue;
          for (const id of [e.adultMealId, e.kidMealId]) {
            const m = getMeal(id);
            if (m && m.proteinType === meal.proteinType)
              return { meal, blocked: true, reason: `${meal.proteinType} protein already on ${DAY_FULL[dayKey]}` };
          }
        }
      }
    }

    if (meal.category === "soup" && slot === "dinner") {
      const dayIdx = DAYS.indexOf(day);
      for (let delta = -4; delta <= 4; delta++) {
        if (delta === 0) continue;
        const di = dayIdx + delta;
        if (di < 0 || di > 6) continue;
        const dayKey = DAYS[di];
        const dp = plan[dayKey] || {};
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
  const plan = currentPlan();
  const entry = (plan[day][slot] ||= { type: "family" });
  if (side === "family") { entry.adultMealId = newId; entry.kidMealId = newId; entry.type = "family"; }
  else if (side === "kid") {
    entry.kidMealId = newId;
    if (entry.adultMealId !== newId) entry.type = "split";
    else entry.type = "family";
  } else {
    entry.adultMealId = newId;
    if (entry.kidMealId !== newId) entry.type = "split";
    else entry.type = "family";
  }
  savePlans();
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
    stephenBenefits: [], prepTime: 30, notes: "",
    image: "🍽", servings: 5, instructions: ""
  } : structuredClone(getMeal(id));

  document.getElementById("modal-title").textContent = isNew ? "Add recipe" : "Edit recipe";
  const body = document.getElementById("modal-body");
  body.innerHTML = `
    <div class="form-grid">
      <div class="full row" style="align-items:flex-end; gap:14px;">
        <div style="flex:0 0 auto;">
          <label>Photo (emoji)</label>
          <input id="f-img" value="${escapeHtml(meal.image)}" maxlength="4" style="font-size:32px; width:80px; text-align:center;">
        </div>
        <div style="flex:1;">
          <label>Name</label>
          <input id="f-name" value="${escapeHtml(meal.name)}">
        </div>
      </div>
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
      <div><label>Servings</label><input id="f-serv" type="number" value="${meal.servings}"></div>
      <div></div>
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
      <div class="full"><label>Notes</label><textarea id="f-notes" rows="2">${escapeHtml(meal.notes||"")}</textarea></div>
      <div class="full"><label>Directions (one step per line)</label>
        <textarea id="f-instructions" rows="6" placeholder="1. Step one&#10;2. Step two">${escapeHtml(meal.instructions||"")}</textarea>
      </div>
    </div>
    <div class="modal-actions">
      <button id="f-cancel">Cancel</button>
      <button id="f-save" class="primary">${isNew ? "Add recipe" : "Save changes"}</button>
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
      image: document.getElementById("f-img").value || CATEGORY_EMOJI[document.getElementById("f-cat").value] || "🍽",
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
      servings:      +document.getElementById("f-serv").value || 5,
      notes:         document.getElementById("f-notes").value.trim(),
      instructions:  document.getElementById("f-instructions").value.trim(),
    };
    if (isNew) state.meals.push(m);
    else state.meals[state.meals.findIndex(x => x.id === meal.id)] = m;
    saveMeals();
    closeModal();
    toast(isNew ? "Recipe added" : "Recipe saved");
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

// =============================================================================
// Initial routing
// =============================================================================
const params = new URLSearchParams(location.search);
const initialView = params.get("view");
if (initialView && ["planner","grocery","batch","vault"].includes(initialView)) {
  state.view = initialView;
  document.querySelectorAll("#tabs button").forEach(b =>
    b.classList.toggle("active", b.dataset.view === initialView));
}
const initialWeek = params.get("gw") || params.get("wk");
if (initialWeek) state.weekStart = initialWeek;

render();
