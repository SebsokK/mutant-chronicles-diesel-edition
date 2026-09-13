// module/mcde.mjs
const SYSTEM_ID = "mutant-chronicles-diesel-edition";
const SOCKET_NS = `system.${SYSTEM_ID}`;

// =========================================================
// Rollcards: style injection + DSD face mapping (DSN JPGs)
// =========================================================
function dsdJpgForFace(face) {
  const base = `systems/${SYSTEM_ID}/assets/dice`;
  const f = Number(face) || 0;
  if (f === 1) return `${base}/dsd1.jpg`;
  if (f === 2) return `${base}/dsd2.jpg`;
  if (f === 6) return `${base}/dsd6.jpg`;
  return `${base}/dsdblank.jpg`; // 3/4/5 + fallback
}

import { MCDEVehicleSheet } from "./vehicule/vehicle-sheet.mjs";

// Small helper: enrich HTML for "read mode" display of {{editor ...}}
async function _enrich(content) {
  const html = String(content ?? "");
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(html, {
    async: true,
    secrets: game.user.isGM
  });
}

/* =========================================================
   Helpers
========================================================= */

function clampInt(v, min = 0, max = 999) {
  v = Number(v);
  if (!Number.isFinite(v)) v = 0;
  v = Math.round(v);
  return Math.min(max, Math.max(min, v));
}

function clamp(v, min, max) {
  v = Number(v);
  if (!Number.isFinite(v)) v = min;
  return Math.min(max, Math.max(min, v));
}

function mcHitLocation(n) {
  const r = Number(n) || 0;
  if (r <= 2) return "HEAD";
  if (r <= 8) return "TORSO";
  if (r <= 11) return "RIGHT ARM";
  if (r <= 14) return "LEFT ARM";
  if (r <= 17) return "RIGHT LEG";
  return "LEFT LEG";
}

// =========================================
 // MCDE — Item Sorting
 // =========================================

function enableMcdeItemSortingNative(actor, root, ulSelector, itemSelector) {
  const rootEl = root?.jquery ? root[0] : root;
  if (!(rootEl instanceof HTMLElement)) {
    console.warn("MCDE | DnD | bad root", root);
    return;
  }

  const uls = Array.from(rootEl.querySelectorAll(ulSelector));
  if (!uls.length) {
    console.warn("MCDE | DnD | no list found", { ulSelector, itemSelector });
    return;
  }

  for (const ul of uls) {
    // Avoid double-binding (use attribute; per-UL)
    const boundKey = `bound:${ulSelector}`;
    if (ul.getAttribute("data-mcde-sort-bound") === boundKey) continue;
    ul.setAttribute("data-mcde-sort-bound", boundKey);

    console.log("MCDE | DnD | init", { ulSelector, itemSelector, ul });

    let draggingLi = null;
    let didReorder = false;
    let didPersistThisDrag = false;

    const isSortDrag = (ev) => {
      try {
        const dt = ev.dataTransfer;
        if (!dt) return false;
        const types = Array.from(dt.types || []);
        if (types.includes("text/mcde-sort") || types.includes("application/mcde-sort")) return true;
        return dt.getData("text/plain") === "mcde-sort";
      } catch (_) {
        return false;
      }
    };

    const getAfterElement = (container, y) => {
      const els = Array.from(container.querySelectorAll(`${itemSelector}:not(.mcde-dragging)`));
      let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

      for (const child of els) {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset, element: child };
      }
      return closest.element;
    };

    const persist = async () => {
      const ids = Array.from(ul.querySelectorAll(itemSelector))
        .map(li => li?.dataset?.itemId)
        .filter(Boolean);

      console.log("MCDE | DnD | persist order", ids);

      const updates = ids.map((id, i) => ({ _id: id, sort: (i + 1) * 10 }));
      await actor.updateEmbeddedDocuments("Item", updates);
      console.log("MCDE | DnD | persist OK");
      try { actor.sheet?.render(false); } catch (_) {}
    };

    // Ensure items are draggable
    for (const li of ul.querySelectorAll(itemSelector)) {
      li.setAttribute("draggable", "true");
    }

    ul.addEventListener("dragstart", (ev) => {
      const li = ev.target?.closest?.(itemSelector);
      if (!li || li.parentElement !== ul) return;

      draggingLi = li;
      li.classList.add("mcde-dragging");
      didReorder = false;
      didPersistThisDrag = false;

      try {
        ev.dataTransfer.setData("text/mcde-sort", li.dataset.itemId || "");
        ev.dataTransfer.setData("application/mcde-sort", li.dataset.itemId || "");
        ev.dataTransfer.setData("text/plain", "mcde-sort");
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.dropEffect = "move";
      } catch (_) {}
    }, true);

    ul.addEventListener("dragover", (ev) => {
      if (!draggingLi) return;
      if (!isSortDrag(ev)) return;

      ev.preventDefault();
      ev.stopPropagation();
      try { ev.stopImmediatePropagation(); } catch (_) {}

      const after = getAfterElement(ul, ev.clientY);
      if (!after) ul.appendChild(draggingLi);
      else ul.insertBefore(draggingLi, after);

      didReorder = true;
    }, true);

    ul.addEventListener("drop", async (ev) => {
      if (!isSortDrag(ev)) return;

      ev.preventDefault();
      ev.stopPropagation();
      try { ev.stopImmediatePropagation(); } catch (_) {}

      await persist();
      didPersistThisDrag = true;
    }, true);

    ul.addEventListener("dragend", async () => {
      if (draggingLi) draggingLi.classList.remove("mcde-dragging");
      draggingLi = null;

      if (didReorder && !didPersistThisDrag) {
        await persist();
      }

      didReorder = false;
      didPersistThisDrag = false;
    }, true);
  }
}

// Expose for other sheet modules (vehicle-sheet.mjs, etc.) without imports
try {
  globalThis.enableMcdeItemSortingNative = enableMcdeItemSortingNative;
} catch (_) {}

 // =========================================
 // MCDE — Confirm dialog helper (Foundry v13)
 // Ensures: title is shown + mcde-dialog class + returns boolean
 // =========================================
 async function mcdeConfirmV13({ title, content }) {
   const dlg = new foundry.applications.api.DialogV2({
     window: { title },
     content,
     buttons: [
       { action: "yes", label: "Yes", icon: "fas fa-check", default: true },
       { action: "no",  label: "No",  icon: "fas fa-times" }
     ]
   });

   await dlg.render(true);
   dlg.element?.classList.add("mcde-dialog");

   return await new Promise((resolve) => {
     const el = dlg.element; // <dialog>
     if (!el) return resolve(false);

     let done = false;
     const finish = (val) => {
       if (done) return;
       done = true;
       el.removeEventListener("click", onClick, true);
       el.removeEventListener("close", onClose, true);
       resolve(val);
     };

     const onClick = (ev) => {
       const btn = ev.target?.closest?.("button[data-action]");
       if (!btn) return;
       finish(btn.dataset.action === "yes");
       dlg.close();
     };

     const onClose = () => finish(false);

     el.addEventListener("click", onClick, true);
     el.addEventListener("close", onClose, true);
   });
 }
// Alias: keep calls short everywhere
const mcdeConfirm = mcdeConfirmV13;

// =========================================
// MCDE — Generic form dialog helper (DialogV2)
// Drop-in replacement for the legacy `new Dialog({...}).render(true)` (AppV1)
// call sites. Mirrors the old `buttons` map shape, but every callback
// (including the optional post-render `render` hook) receives the dialog's
// native root HTMLElement instead of a jQuery object — callers must use
// querySelector/addEventListener/.value/.dataset instead of .find/.on/.val/.data.
//
// buttons: { [action]: { label, icon, callback(rootEl, event) } }
// render: optional (rootEl) => void, called once right after the dialog renders
// =========================================
function mcdeDialogV2({ title, content, buttons, defaultAction, width, extraClasses = [], render } = {}) {
  const actions = Object.keys(buttons ?? {});

  const dlg = new foundry.applications.api.DialogV2({
    window: { title },
    content,
    position: width ? { width } : undefined,
    buttons: actions.map((action) => {
      const b = buttons[action];
      return {
        action,
        label: b.label,
        icon: b.icon,
        default: action === (defaultAction ?? actions[0]),
        callback: async (event, _button, dialog) => {
          if (typeof b.callback === "function") await b.callback(dialog.element, event);
        }
      };
    })
  });

  dlg.render(true).then(() => {
    dlg.element?.classList.add("mcde-dialog", ...extraClasses);
    if (typeof render === "function") render(dlg.element);
  });

  return dlg;
}

// =========================================
// MCDE — Shared ApplicationV2 "editImage" action
// Wire via `static DEFAULT_OPTIONS.actions = { editImage: mcdeEditImageAction }`
// on any AppV2 sheet. `this` is bound to the sheet instance by Foundry's
// action-dispatch, `target` is the element carrying data-action="editImage"
// (its data-field attribute names the document field to edit, default "img").
// =========================================
async function mcdeEditImageAction(event, target) {
  const field = target.dataset.field || "img";
  const current = foundry.utils.getProperty(this.document, field);
  const FilePickerImpl = foundry.applications.apps.FilePicker.implementation;
  const fp = new FilePickerImpl({
    type: "image",
    current,
    callback: (path) => this.document.update({ [field]: path })
  });
  fp.render(true);
}

// =========================================
// MCDE — Preserve focus across a sheet re-render.
//
// Every actor sheet uses `form: { submitOnChange: true }`, so any "change"
// event on a named field saves the document and triggers a full re-render
// (PARTS markup regenerated from scratch — the focused element is
// destroyed and a new one takes its place). For most inputs this is
// invisible because "change" only fires on blur, after focus has already
// left. But a number input's up/down spinner — including the keyboard's
// Up/Down arrow keys — fires "change" immediately on every step, while
// the field is still focused: the resulting re-render then yanks focus
// out to <body>, so a second arrow-key press does nothing (users reported
// this as arrow keys "kicking them out of the field").
//
// Call mcdeCaptureFocusedField(this.element) in _preRender (before the
// render destroys anything) and mcdeRestoreFocusedField(this.element,
// saved) in _onRender (after the new markup exists) to put focus — and
// the caret/selection, and the just-typed digit — right back where the
// user left it, so repeated arrow presses keep incrementing normally.
// =========================================
function mcdeCaptureFocusedField(rootEl) {
  try {
    const el = document.activeElement;
    if (!el || !rootEl || !rootEl.contains(el)) return null;

    const name = el.getAttribute?.("name");
    let selector;
    if (name) {
      selector = `[name="${CSS.escape(name)}"]`;
    } else if (el.classList.length) {
      // Fallback for fields with no `name` (e.g. the Wounds "max" inputs,
      // which are translated into a derived boxes array rather than saved
      // directly, so submitOnChange never names them). Scope by the
      // closest ancestor carrying a stable identifying data attribute —
      // several look-alike fields share the same class (Serious/Critical/
      // Mental Wounds all use `.mcde-wound-max`), so the plain class alone
      // would restore focus onto the wrong one.
      const cls = "." + Array.from(el.classList).map(c => CSS.escape(c)).join(".");
      const scoped = el.closest("[data-track]");
      selector = scoped ? `[data-track="${CSS.escape(scoped.getAttribute("data-track"))}"] ${cls}` : cls;
    } else {
      return null;
    }

    const saved = { selector };
    if (typeof el.selectionStart === "number") {
      saved.selectionStart = el.selectionStart;
      saved.selectionEnd = el.selectionEnd;
    }
    return saved;
  } catch (_) {
    return null;
  }
}

function mcdeRestoreFocusedField(rootEl, saved) {
  if (!saved || !rootEl) return;
  try {
    const el = rootEl.querySelector(saved.selector);
    if (!el) return;
    el.focus();
    if (typeof saved.selectionStart === "number" && typeof el.setSelectionRange === "function") {
      try { el.setSelectionRange(saved.selectionStart, saved.selectionEnd); } catch (_) {}
    }
  } catch (_) {}
}


function computeTestSuccesses(dice, tn, focus, repercussionFrom = 20, autoSuccesses = 0) {
  let total = 0;
  let repercussions = 0;

  const perDie = dice.map((v) => {
    let s = 0;

    if (v <= tn) s = 1;
    if (focus > 0 && v <= focus) s = 2;

    if (v >= repercussionFrom) repercussions += 1;

    total += s;
    return { value: v, successes: s };
  });

  total += Number(autoSuccesses) || 0;

  return { total, perDie, repercussions };
}

 // -------------------------------------------------------
 // Damage Bonus helper (PCs): supports both data paths
 // - NEW (character sheet): system.damageBonus.ranged / melee
 // - OLD/other sheets:      system.damage_bonus.ranged.value / melee.value
 // -------------------------------------------------------
 function getDamageBonus(actor, mode = "ranged") {
   const sys = actor?.system ?? {};
 
   const vNew = mode === "melee"
     ? sys.damageBonus?.melee
     : sys.damageBonus?.ranged;
 
   const vOld = mode === "melee"
     ? sys.damage_bonus?.melee?.value
     : sys.damage_bonus?.ranged?.value;
 
   return Number(vNew ?? vOld ?? 0) || 0;
 }

 // -------------------------------------------------------
 // Verifier les DMGs de base pour qu'on ne se plante pas.
 // -------------------------------------------------------

 // Robust: weapons have had multiple schemas over time.
 // Goal: return the BASE number of Dark Symmetry Damage Dice the weapon provides (DSD count).
 function getWeaponBaseDSD(weapon) {
   const d = weapon?.system?.damage ?? {};
 
   // Most recent / intended
   const a = d.dsd;
   // Legacy used in some versions
   const b = d.dsy;
   // Sometimes stored as { value: n }
   const av = (a && typeof a === "object") ? a.value : a;
   const bv = (b && typeof b === "object") ? b.value : b;
 
   // Pick the first finite number we find
   const n =
     (Number.isFinite(Number(av)) ? Number(av) : null) ??
     (Number.isFinite(Number(bv)) ? Number(bv) : null) ??
     0;
 
   return Math.max(0, Math.trunc(n));
 }


// Defaults for the DSP editor (HTML is fine for ProseMirror)
function defaultDSPHtml(npcType) {
  switch (npcType) {
    case "trooper":
      return `
<p><b>Interrupt (1):</b> The creature may interrupt the player characters’ turns, acting earlier than usual that turn.</p>
<p><b>Reinforcement (1+):</b> Add another Trooper per Dark Symmetry Point spent to the combat at the end of the current round.</p>
<p><b>Ammunition (1):</b> The creature gains the benefits of spending a reload for one of its weapons or attacks. NPCs do not track reloads normally, but rather spend Dark Symmetry Points to gain the same effects.</p>
`;
    case "elite":
      return `
<p><b>Reinforcement (2+):</b> Add another elite enemy to the combat at the end of the current round for every two Dark Symmetry points spent.</p>
<p><b>Interrupt (2):</b> The creature may interrupt the player characters’ turns, acting earlier than usual that turn.</p>
<p><b>Ammunition (1):</b> The creature gains the benefits of spending reload for one of its weapons. NPCs do not track reloads normally, but rather spend Dark Symmetry points to gain the same effects.</p>
`;
    case "horde_squad":
      return `
<p><b>Interpose (1):</b> Force a ranged attack made against an allied creature within five metres, or a melee attack made against an allied creature within two metres, to be directed against the group instead.</p>
<p><b>Special Weaponry (2):</b> Some groups include special weapons, armaments carried by a single creature within the horde in addition to their standard weaponry. Using these special weapons costs two Dark Symmetry points, and reduces the horde’s normal attack by 1d20, in exchange for a normal attack with the special weapon. This attack may target the same enemy as the rest of the group, or a different one, as desired.</p>
`;
    case "nemesis":
      return `
<p><b>Dark Chronicle (3):</b> By spending three Dark Symmetry points, the Nemesis gains the benefits of spending a single Chronicle point.</p>
<p><b>Ammunition (2):</b> The creature gains the benefits of spending a reload for one of its weapons or attacks. NPCs do not track reloads normally, but rather spend Dark Symmetry points to gain the same effects.</p>
<p><b>Interrupt (3):</b> The creature may interrupt the player characters’ turns, acting earlier than usual that turn.</p>
`;
    default:
      return ``;
  }
}

/* =========================================================
   Labels (PC sheet)
========================================================= */

const ATTR_LABELS = {
  agility: "Agility",
  awareness: "Awareness",
  coordination: "Coordination",
  intelligence: "Intelligence",
  mental_strength: "Mental Strength",
  personality: "Personality",
  physique: "Physique",
  strength: "Strength"
};

const SKILL_LABELS = {
  acrobatics: "Acrobatics",
  close_combat: "Close Combat",
  unarmed_combat: "Unarmed Combat",
  stealth: "Stealth",

  observation: "Observation",
  insight: "Insight",
  thievery: "Thievery",

  ranged_weapons: "Ranged Weapons",
  heavy_weapons: "Heavy Weapons",
  gunnery: "Gunnery",
  pilot: "Pilot",
  space: "Space",

  education: "Education",
  linguistics: "Linguistics",
  science: "Science",
  mechanics: "Mechanics",
  survival: "Survival",
  vacuum: "Vacuum",
  treatment: "Treatment",
  medicine: "Medicine",
  psychotherapy: "Psychotherapy",

  willpower: "Willpower",
  mysticism: "Mysticism",

  animal_handling: "Animal Handling",
  lifestyle: "Lifestyle",
  persuade: "Persuade",
  command: "Command",

  resistance: "Resistance",
  athletics: "Athletics"
};

const ATTR_ORDER = [
  "agility","awareness","coordination","intelligence",
  "mental_strength","personality","physique","strength"
];


/* =========================================================
   Chat Card Rendering (minimal, templates later)
========================================================= */

function renderTestCard(state) {
  const {
    tn,
    focus,
    dice,
    rerolled,
    chronicleIndex,
    label,
    repercussionFrom,
    autoSuccesses
  } = state;

  const calc = computeTestSuccesses(
    dice,
    tn,
    focus,
    repercussionFrom,
    autoSuccesses ?? 0
  );

  // 1) DICE HTML d'abord (sinon diceHtml undefined)
  const diceHtml = `
    <div class="mcde-dice-row" data-kind="test">
      ${(dice ?? []).map((v, i) => {
        const s = Number(calc?.perDie?.[i]?.successes ?? 0) || 0;
        const isComp = (Number(v) || 0) >= (Number(repercussionFrom) || 20);

        const cls = [
          "mcde-die",
          s >= 2 ? "is-crit" : s === 1 ? "is-success" : "is-fail",
          isComp ? "is-comp" : null,
          i === chronicleIndex ? "is-auto1" : null,
          rerolled?.[i] ? "is-rerolled" : null
        ].filter(Boolean).join(" ");

        const tt = [
          s >= 2 ? "2 successes (≤ Focus)" : s === 1 ? "1 success (≤ TN)" : "No success",
          isComp ? `Complication (≥ ${repercussionFrom})` : null,
          i === chronicleIndex ? "AUTO-1 die" : null,
          rerolled?.[i] ? "Rerolled" : null
        ].filter(Boolean).join(" · ");

        return `
          <button type="button"
                  class="${cls}"
                  title="${foundry.utils.escapeHTML(tt)}"
                  data-action="reroll"
                  data-kind="test"
                  data-index="${i}">
            <span class="mcde-die-face">${v}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;

  // 2) Résultats ensuite
  const difficulty = Number(state.difficulty) || 1;
  const total = Number(calc.total) || 0;
  const net = total - difficulty;
  const complications = Number(calc.repercussions) || 0;

  const resultsHtml = `
  <div class="mcde-results">
    <span class="mcde-results-successes">Successes: <strong>${total}</strong></span>
    ${complications > 0 ? `
      <span class="mcde-results-comp">
        Complications: <strong>${complications}</strong>
        <span class="mcde-results-rep">(Repercussion ${repercussionFrom}–20)</span>
      </span>
    ` : ""}
  </div>
`;

  // 3) Boutons (tes blocs existants)
  const actorType = String(state.actorType ?? "");
  const npcType = String(state.npcType ?? "");
  const isCharacter = (actorType === "character");
  const isNemesis = (npcType === "nemesis"); // 👈 chez toi, nemesis = npcType

  const canAddAuto1 = (!state.chronicleUsed) && (isCharacter || isNemesis);
  const add1Label = isNemesis ? "Add a 1 (6 DSP)" : "Add a 1 (2 CP)";
  // Attack state
const atk = state.attack ?? null;
  // 3B) Gain Momentum (PC only, if Net >= 1, only once)
const isPC = state.actorType === "character";
const canGainMomentum = isPC && net >= 1 && !state.momentumGranted;

  // 3) Actions (grouped)
const actionsHtml = (canAddAuto1 || (atk && !atk.damageRolled) || canGainMomentum)
  ? `<div class="mcde-actions">
      ${canAddAuto1
        ? `<button type="button"
                   class="mcde-btn mcde-btn-secondary"
                   data-action="chronicle-add1">${add1Label}</button>`
        : ""}

      ${canGainMomentum
        ? `<button type="button"
                   class="mcde-btn mcde-btn-secondary"
                   data-action="gain-momentum"
                   data-amount="${net}">
             Gain Momentum (+${net})
           </button>`
        : ""}

      ${(atk && !atk.damageRolled)
        ? `<button type="button"
                   class="mcde-btn mcde-btn-primary mcde-btn-roll-damage"
                   data-action="roll-damage">Roll Damage</button>`
        : ""}
     </div>`
  : "";


  // 4) Return à la fin
  return `
  <div class="mcde-card" data-mcde-card="1">
    <header class="mcde-card-header">
  <div class="mcde-card-kind">TEST</div>
  ${label ? `<div class="mcde-card-title">${foundry.utils.escapeHTML(label)}</div>` : ""}
  </header>

    <div>
      TN: <strong>${tn}</strong>
      | Focus: <strong>${focus}</strong>
      | Difficulty: <strong>D${difficulty}</strong>
      ${state.autoSuccesses ? ` <span style="opacity:0.7;">(+${state.autoSuccesses} auto)</span>` : ""}
    </div>

    <div class="mcde-dice">${diceHtml}</div>
    ${resultsHtml}
    ${actionsHtml}
    <small>Click a die to reroll (AUTO-1 die cannot be rerolled).</small>
  </div>`;
}




/* =========================================================
   Apply Damage (GM QoL)
   - Uses existing MCDE DSD rules:
     1 => 1 dmg, 2 => 2 dmg, 3/4/5 => 0 dmg, 6 => Effect (0 dmg)
========================================================= */

// Map the hit-location d20 to both a label and a data key used in actor.system.combat.locations
function mcHitLocationKey(n) {
  const r = Number(n) || 0;
  if (r <= 2) return { key: "head", label: "HEAD" };
  if (r <= 8) return { key: "torso", label: "TORSO" };
  if (r <= 11) return { key: "rightArm", label: "RIGHT ARM" };
  if (r <= 14) return { key: "leftArm", label: "LEFT ARM" };
  if (r <= 17) return { key: "rightLeg", label: "RIGHT LEG" };
  return { key: "leftLeg", label: "LEFT LEG" };
}

function _dsdDamageFromFaces(dsdFaces) {
  if (!Array.isArray(dsdFaces)) return 0;
  let sum = 0;
  for (const v of dsdFaces) {
    if (v === 1) sum += 1;
    else if (v === 2) sum += 2;
    // 3/4/5 => 0
    // 6 => effect only
  }
  return sum;
}

function getTargetSoak(actor, locKey) {
  const sys = actor?.system ?? {};
  const isNpc = (actor.type === "npc");

  // Character/Nemesis: prefer location soak if present
  // NPC: ignore location soak entirely (global soak applies everywhere)
  if (!isNpc && locKey && sys?.combat?.locations?.[locKey]?.soak != null) {
    const v = Number(sys.combat.locations[locKey].soak);
    return Number.isFinite(v) ? v : 0;
  }

  // NPC: no location track → treat soak as global
  if (isNpc) {
    // 1) If it exists as soak.value (older schema)
    const vValue = Number(sys?.soak?.value ?? NaN);
    if (Number.isFinite(vValue)) return vValue;

    // 2) If sys.soak is a plain number
    const vNum = Number(sys?.soak ?? NaN);
    if (Number.isFinite(vNum)) return vNum;

        // 3) If sys.soak is an object, extract any numeric "value" from it (even nested one level)
    const soakObj = sys?.soak;
    if (soakObj && typeof soakObj === "object") {
      // Prefer torso if present (as number OR {value})
      const torsoRaw = soakObj.torso ?? soakObj.TORSO;
      const torsoNum = Number(
        (torsoRaw && typeof torsoRaw === "object") ? (torsoRaw.value ?? torsoRaw.soak ?? NaN) : torsoRaw
      );
      if (Number.isFinite(torsoNum)) return torsoNum;

      const vals = [];
      for (const raw of Object.values(soakObj)) {
        if (raw == null) continue;
        if (typeof raw === "number" || typeof raw === "string") {
          const n = Number(raw);
          if (Number.isFinite(n)) vals.push(n);
          continue;
        }
        if (typeof raw === "object") {
          // Common patterns: {value:4} or {soak:4}
          const n = Number(raw.value ?? raw.soak ?? NaN);
          if (Number.isFinite(n)) vals.push(n);
        }
      }
      if (vals.length) return Math.max(...vals);
    }
  }

  return 0;
}

async function setDeadStatus(token, dead) {
  try {
    // Prefer actor-level status (Foundry v12+)
    const actor = token?.actor ?? token?.document?.actor;
    if (actor?.toggleStatusEffect) {
      await actor.toggleStatusEffect("dead", { active: !!dead });
      return;
    }

    // Fallback (older APIs)
    if (token?.document?.toggleStatusEffect) {
      await token.document.toggleStatusEffect("dead", { active: !!dead });
      return;
    }

    // Last resort (very old)
    if (token?.toggleEffect) {
      await token.toggleEffect("dead", { active: !!dead });
    }
  } catch (e) {
    console.warn("MCDE | setDeadStatus failed", e);
  }
}

function _fillBoxes(arr, n) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  let added = 0;
  for (let i = 0; i < a.length && added < n; i++) {
    if (!a[i]) {
      a[i] = true;
      added += 1;
    }
  }
  return { next: a, added, remaining: Math.max(0, n - added) };
}

async function rollCriticalInjury({ actor, criticalChecked }) {
  const mod = Number(criticalChecked) || 0;
  const formula = mod ? `1d20 + ${mod}` : "1d20";

  // Roll with modifier so the 3D dice (if any) matches what we actually use
  const r = await new Roll(formula).evaluate({ async: true });
  try { await game.dice3d?.showForRoll?.(r, game.user, true); } catch (e) {}

  // Find the RollTable by name
  const tableName = "Critical Injuries";
  const table = game.tables?.getName?.(tableName) ?? null;

  // If the table exists, draw using our pre-rolled result (no automatic chat)
  let drawnText = null;
  let drawnImg = null;
  if (table) {
    try {
      const finalTotal = Math.floor(Number(r.total) || 0);
      const tableRoll = await new Roll(String(finalTotal)).evaluate({ async: true });
      const draw = await table.draw({ roll: tableRoll, displayChat: false });
      const res = draw?.results?.[0] ?? null;
      drawnText = res?.text ?? res?.documentCollection ?? null;
      drawnImg = res?.img ?? null;
    } catch (e) {
      console.warn(`[MCDE] Failed to draw from table "${tableName}"`, e);
    }
  }

  const content = `
    <div class="mcde-card" data-mcde-card="1">
      <header><strong>CRITICAL INJURY</strong></header>
      <div>Roll: <strong>${r.total}</strong> ${mod ? `(includes +${mod})` : ""}</div>
      <div style="opacity:.7; font-size:12px;">Table key: ${Math.floor(Number(r.total)||0)}</div>
      ${
        table && drawnText
          ? `<div style="margin-top:6px; display:flex; gap:8px; align-items:center;">
               ${drawnImg ? `<img src="${drawnImg}" style="width:32px; height:32px; object-fit:cover; border-radius:4px;">` : ""}
               <div><strong>Result:</strong> ${drawnText}</div>
             </div>`
          : `<small>${table ? "Table draw failed." : `RollTable "${tableName}" not found.`}</small>`
      }
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });
}

async function applyLocationDamage({ actor, token, dmg, locKey }) {
  const sys = actor.system ?? {};
  const loc = sys?.combat?.locations?.[locKey] ?? {};

  // Location wounds schema can vary; support common shapes:
  // - combat.locations.head.wounds.current / .wounds.total
  // - combat.locations.head.current / .max
  const curCandidates = [
    `system.combat.locations.${locKey}.wounds.current`,
    `system.combat.locations.${locKey}.current`,
    `system.combat.locations.${locKey}.woundsCur`
  ];
  const maxCandidates = [
    `system.combat.locations.${locKey}.wounds.total`,
    `system.combat.locations.${locKey}.max`,
    `system.combat.locations.${locKey}.woundsMax`
  ];

  const getFirst = (paths, fallback) => {
    for (const p of paths) {
      const v = foundry.utils.getProperty(actor, p);
      if (v != null) return { path: p, value: v };
    }
    return { path: fallback, value: foundry.utils.getProperty(actor, fallback) };
  };

  const curInfo = getFirst(curCandidates, curCandidates[0]);
  const maxInfo = getFirst(maxCandidates, maxCandidates[0]);

  const cur = Number(curInfo.value ?? 0) || 0;
  const max = Math.max(0, Number(maxInfo.value ?? 0) || 0);

  let remaining = dmg;
  let newCur = cur;

  if (max > 0) {
    const space = Math.max(0, max - cur);
    const toLoc = Math.min(space, remaining);
    newCur = cur + toLoc;
    remaining -= toLoc;
  } else {
    // No max defined => just accumulate
    newCur = cur + remaining;
    remaining = 0;
  }

  const updates = { [curInfo.path]: newCur };

  // Overflow => Serious then Critical (arrays of booleans)
  if (remaining > 0) {
    const combat = sys.combat ?? {};
    const serious = Array.isArray(combat.seriousWounds) ? combat.seriousWounds : [];
    const critical = Array.isArray(combat.criticalWounds) ? combat.criticalWounds : [];

    const sFill = _fillBoxes(serious, remaining);
    updates["system.combat.seriousWounds"] = sFill.next;

    const afterSerious = sFill.remaining;

    let cAdded = 0;
    let cNext = critical;

    if (afterSerious > 0) {
      const cFill = _fillBoxes(critical, afterSerious);
      cNext = cFill.next;
      cAdded += cFill.added;
      updates["system.combat.criticalWounds"] = cNext;
      remaining = cFill.remaining;
    } else {
      remaining = 0;
    }

    // Massive damage rule: if (damage after soak) > Physique, add +1 critical
    const physique = Number(sys?.attributes?.physique?.value ?? 0) || 0;
    const massiveTriggered = (physique > 0 && dmg > physique);
    let massiveAdded = 0;
    if (massiveTriggered && critical.length > 0) {
      const cFill = _fillBoxes(cNext, 1);
      cNext = cFill.next;
      massiveAdded = cFill.added;
      cAdded += massiveAdded;
      updates["system.combat.criticalWounds"] = cNext;
      remaining = cFill.remaining + remaining; // if can't add, it effectively overflows to "worse"
    }

    // One Critical Injury roll if at least one new critical box was checked
        if (cAdded > 0 || massiveTriggered) {
      // Use the *final* checked count (after any massive-damage extra box)
      const finalCritTrack = (updates["system.combat.criticalWounds"] ?? cNext ?? critical);
      const checkedAfter = Array.isArray(finalCritTrack) ? finalCritTrack.filter(Boolean).length : 0;
      const mod = (Array.isArray(critical) && critical.length > 0) ? checkedAfter : 0; // NPC => 0
      await rollCriticalInjury({ actor, criticalChecked: mod });
    }

    // Dead if critical track is full (and exists)
    if (critical.length > 0) {
      const isDead = (updates["system.combat.criticalWounds"] ?? critical).every(Boolean);
      if (isDead) await setDeadStatus(token, true);
    }
  }

  await actor.update(updates);
}

async function applyDamageToActor({ actor, token, dmg, locKey }) {
  if (dmg <= 0) return;

  // NPC: simplified wounds
  if (actor.type === "npc") {
    const cur = Number(actor.system?.wounds?.current ?? 0) || 0;
    const tot = Number(actor.system?.wounds?.total ?? 0) || 0;
    const next = cur + dmg;

    await actor.update({ "system.wounds.current": (tot > 0 ? Math.min(next, tot) : next) });

    if (tot > 0 && next >= tot) await setDeadStatus(token, true);

    // Massive damage rule for NPCs:
    // If damage after soak > Physique, roll on Critical Injuries (NPC has no critical track, mod = 0)
    const physique = Number(actor.system?.attributes?.physique?.value ?? 0) || 0;
    if (physique > 0 && dmg > physique) {
      await rollCriticalInjury({ actor, criticalChecked: 0 });
    }

    return;
  }

  // Character / Nemesis: per-location tracks + serious/critical overflow
  await applyLocationDamage({ actor, token, dmg, locKey });
}

async function handleApplyDamage(message, state) {
  try {
    const targets = game?.user?.targets ? Array.from(game.user.targets) : [];
    if (!targets.length) {
      ui.notifications?.warn?.("No target selected.");
      return;
    }
    const token = targets[0];
    const actor = token?.actor;
    if (!actor) {
      ui.notifications?.warn?.("Target has no Actor.");
      return;
    }

    const flatBonus = Number(state?.flatBonus ?? 0) || 0;
    const dsdFaces = Array.isArray(state?.dsd) ? state.dsd : [];
    const dmgFromDice = _dsdDamageFromFaces(dsdFaces);
    const rolledDamage = Math.max(0, flatBonus + dmgFromDice);

    // Location key from the location d20
    const locInfo = mcHitLocationKey(state?.locationD20);
    const locKey = locInfo?.key ?? null;

    const soak = getTargetSoak(actor, locKey);
    const suggested = Math.max(0, rolledDamage - soak);

    const content = `
      <form class="mcde-roll-dialog">
        <p><strong>Target:</strong> ${token?.name ?? actor.name}</p>
        <p><strong>Rolled Damage:</strong> ${rolledDamage} <span style="opacity:0.7;">(Flat ${flatBonus} + Dice ${dmgFromDice})</span></p>
        <p><strong>Soak used:</strong> ${soak} <span style="opacity:0.7;">(Location: ${String(locInfo?.label ?? "").toUpperCase()})</span></p>

        <div class="form-group">
          <label>Damage to apply (after soak)</label>
          <input type="number" name="applyDamage" min="0" value="${suggested}" />
        </div>

        <div class="form-group" style="opacity:0.85;">
          <label><input type="checkbox" name="skipSoak" /> Ignore soak (use Rolled Damage)</label>
        </div>
      </form>
    `;

    return new Promise((resolve) => {
      mcdeDialogV2({
        title: "Apply Damage",
        content,
        width: 520,
        extraClasses: ["mcde-applydamage-dialog"],
        defaultAction: "apply",
        buttons: {
          apply: {
            label: "Apply",
            callback: async (root) => {
              const skipSoak = !!root.querySelector("[name='skipSoak']")?.checked;
              const val = Number(root.querySelector("[name='applyDamage']")?.value ?? 0) || 0;
              const final = Math.max(0, skipSoak ? rolledDamage : val);

              await applyDamageToActor({ actor, token, dmg: final, locKey });

              try {
                await message.update({ [`flags.${SYSTEM_ID}.rollState.damageApplied`]: true });
              } catch (e) {}

              resolve(true);
            }
          },
          cancel: { label: "Cancel", callback: () => resolve(false) }
        }
      });
    });
  } catch (e) {
    console.error(e);
    ui.notifications?.error?.("Apply Damage failed. See console.");
  }
}

async function renderDamageCard(state) {
   const qualities = Array.isArray(state?.attack?.qualities) ? state.attack.qualities : [];

   const qualitiesHtml = qualities.length
     ? `<div class="mcde-traits" style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px;">
         ${qualities.map((q) => {
           const name = foundry.utils.escapeHTML(String(q?.name ?? "Quality"));
           const descRaw = String(q?.description ?? "");

           // Foundry VTT: enrichHTML peut retourner un Promise => on fait ça async + await plus bas
           // Ici on met un placeholder, remplacé juste après par la version enrichie.
           return `<span class="mcde-trait" data-mcde-qdesc="${foundry.utils.escapeHTML(descRaw)}">${name}</span>`;
         }).join("")}
       </div>`
     : "";
  const { flatBonus, dsd, dsdRerolled, locationD20, locationRerolled, mode, weaponName } = state;

  let dmgFromDice = 0;
  let effects = 0;
  for (const v of dsd) {
    if (v === 1) dmgFromDice += 1;
    else if (v === 2) dmgFromDice += 2;
    else if (v === 6) effects += 1;
  }
  const totalDamage = (Number(flatBonus) || 0) + dmgFromDice;

  const locInfo = mcHitLocationKey(locationD20);
  const locLabel = locInfo.label;

  const dsdHtml = `
    <div class="mcde-dice-row" data-kind="dsd">
      ${dsd.map((v, i) => {
        const face = Number(v) || 0;
        const img = dsdJpgForFace(face);
        const tt = [
          `DSD face: ${face}`,
          dsdRerolled?.[i] ? "Rerolled" : null
        ].filter(Boolean).join(" · ");
        return `
          <button type="button"
                  class="mcde-die mcde-dsd is-face-${face} ${dsdRerolled?.[i] ? "is-rerolled" : ""}"
                  title="${foundry.utils.escapeHTML(tt)}"
                  data-action="reroll"
                  data-kind="dsd"
                  data-index="${i}">
            <img class="mcde-dsd-face" src="${img}" alt="${face}" />
          </button>
        `;
      }).join("")}
    </div>
  `;

  const locTag = locationRerolled ? ` <span class="tags">(Rerolled)</span>` : "";

  const hasTarget = !!(game?.user?.targets && game.user.targets.size);
  const applyDamageHtml = (game?.user?.isGM && hasTarget)
    ? `<div class="mcde-actions" style="margin-top:6px;">
         <button type="button" class="mcde-btn" data-action="apply-damage">Apply Damage</button>
       </div>`
    : "";

// --- Build tooltip HTML once (async), then inject as data-tooltip
   // On enrichit le HTML (icônes, liens, etc.) puis on rend ça sûr pour un attribut HTML.
   let qualitiesHtmlFinal = qualitiesHtml;
   if (qualities.length) {
     // Remplace chaque span data-mcde-qdesc="..." par data-tooltip="(html enrichi)"
     // Note: data-tooltip accepte du HTML dans Foundry, mais il faut échapper les guillemets pour l'attribut.
     const tmp = document.createElement("div");
     tmp.innerHTML = qualitiesHtmlFinal;
     const spans = Array.from(tmp.querySelectorAll(".mcde-trait[data-mcde-qdesc]"));

     for (const s of spans) {
       const raw = s.getAttribute("data-mcde-qdesc") ?? "";
       // raw est déjà escapeHTML, donc on "dés-escape" minimalement pour enrichHTML
       const unescaped = raw
         .replaceAll("&lt;", "<")
         .replaceAll("&gt;", ">")
         .replaceAll("&amp;", "&")
         .replaceAll("&quot;", "\"")
         .replaceAll("&#39;", "'");

       const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(unescaped, { async: true });
       const attrSafe = String(enriched ?? "").replace(/"/g, "&quot;");
       s.removeAttribute("data-mcde-qdesc");
       s.setAttribute("data-tooltip", attrSafe);
     }

     qualitiesHtmlFinal = tmp.innerHTML;
   }

  return `
  <div class="mcde-card" data-mcde-card="1">
    <header class="mcde-card-header">
      <div class="mcde-card-kind">DAMAGE</div>
      ${weaponName ? `<div class="mcde-card-title">${foundry.utils.escapeHTML(weaponName)}</div>` : ""}
    </header>

    <div class="mcde-dmg-mode">Mode: <strong>${mode}</strong></div>

    <div class="mcde-dmg-location">
  <span class="mcde-dmg-location-label">Location:</span>

  <button type="button"
          class="mcde-die"
          data-action="reroll"
          data-kind="location"
          data-index="0">
    ${locationD20}
  </button>

  <span class="mcde-dmg-location-result">
    ⇒ <strong>${locLabel}</strong>
  </span>
</div>

    <div class="mcde-dice">Dark Symmetry Dice: ${dsdHtml}</div>

   ${qualitiesHtmlFinal}

    <div class="mcde-dmg-summary">
      <span class="mcde-dmg-total">Damage: <strong>${totalDamage}</strong></span>
      <span class="mcde-dmg-effects">Effects: <strong>${effects}</strong></span>
    </div>

    ${applyDamageHtml}

    <small>Click a die (DSD or Location) to reroll.</small>
  </div>`;
}


/* =========================================================
   Rolls API
========================================================= */

function getRepercussionRange(actor) {
  const T = actor.system?.dread?.trackers ?? {};

  const hasAny = (arr) => Array.isArray(arr) && arr.some(v => v);

  if (hasAny(T.level4)) return 16; // 16-20
  if (hasAny(T.level3)) return 17; // 17-20
  if (hasAny(T.level2)) return 18; // 18-20
  if (hasAny(T.level1)) return 19; // 19-20
  return 20;                       // 20 only
}

async function rollTest({
  actor,
  label = "",
  tn,
  focus = 0,
  diceCount = 2,
  useChroniclePoint = false,
  autoSuccesses = 0,
  difficulty = 1,
  repercussionFrom = null,
  attackData = null
} = {}) {
  if (!actor) throw new Error("rollTest: actor is required");
  // NOTE (rules): A Chronicle Point does NOT change an existing die.
  // It ADDS an extra d20 set to the face "1".
  // - If spent BEFORE the roll: costs 1 CP, we include the extra die here.
  // - If spent AFTER the roll: costs 2 CP, handled by the chat button "Add a 1 (2 CP)".
  const HARD_CAP_D20 = 20; // same value as above (or define once globally)
  const baseDice = clamp(diceCount || 2, 1, HARD_CAP_D20);
  const totalDice = baseDice + (useChroniclePoint ? 1 : 0);

  const roll = await new Roll(`${totalDice}d20`).evaluate();
  const dice = roll.dice?.[0]?.results?.map(r => r.result) ?? [];

  // Auto-1 mechanic = the added die (last one)
  const chronicleIndex = useChroniclePoint ? (dice.length - 1) : -1;
  if (useChroniclePoint && dice.length) {
    dice[chronicleIndex] = 1;
    // Force the underlying Roll result to 1 so DSN shows it as 1
    const term = roll.dice?.[0];
    if (term?.results?.[chronicleIndex]) term.results[chronicleIndex].result = 1;
  }

  const rerolled = new Array(totalDice).fill(false);

const repFrom = (Number.isFinite(Number(repercussionFrom)) && Number(repercussionFrom) >= 1)
  ? Number(repercussionFrom)
  : getRepercussionRange(actor);

const state = {
    kind: "test",
    actorUuid: actor.uuid,
    actorType: actor.type,
    npcType: String(actor.system?.npcType ?? ""),
    actorType: actor.type, // ✅ AJOUT
    label,
    tn: Number(tn) || 0,
    focus: Number(focus) || 0,
    dice,
    rerolled,
    chronicleUsed: !!useChroniclePoint,
    chronicleIndex,
    autoSuccesses,
    repercussionFrom: repFrom,
    difficulty: Number(difficulty) || 1,
    attack: attackData ?? null
  };

  return ChatMessage.create({
    content: renderTestCard(state),
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [roll],
    flags: { [SYSTEM_ID]: { rollState: state } }
  });
}

async function rollDamage({ actor, weaponName = "", mode = "ranged", dsdCount, flatBonus = 0, attackData = null } = {}) {
  if (!actor) throw new Error("rollDamage: actor is required");
  const count = Math.max(0, Number(dsdCount) || 0);

  const dsdRoll = await new Roll(`${count}d6`).evaluate();
  const dsd = dsdRoll.dice?.[0]?.results?.map(r => r.result) ?? [];

  const dsdRerolled = new Array(count).fill(false);
  const locRoll = await new Roll("1d20").evaluate();
  const locationD20 = locRoll.total;

const repercussionFrom = getRepercussionRange(actor);

const state = {
  kind: "damage",
  actorUuid: actor.uuid,
  attack: attackData ?? null,
  weaponName,
  mode,
  flatBonus: Number(flatBonus) || 0,
  dsd,
  dsdRerolled,
  locationD20,
  locationRerolled: false
};


  return ChatMessage.create({
    content: await renderDamageCard(state),
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [dsdRoll, locRoll],
    flags: { [SYSTEM_ID]: { rollState: state } }
  });
}

// Spend Chronicle Points AFTER a roll: add an extra d20 set to "1" (cost: 2 CP)
async function handleChronicleAdd1(message) {
  const state = message.getFlag(SYSTEM_ID, "rollState");
  if (!state || state.kind !== "test") return;
  if (state.chronicleUsed) return;

  const actor = await fromUuid(state.actorUuid);
  if (!actor) return;

  const actorType = String(state.actorType ?? actor.type ?? "");
  const npcType = String(state.npcType ?? actor.system?.npcType ?? "");
  const isCharacter = (actorType === "character");
  const isNemesis = (npcType === "nemesis");

  // NPCs (non-nemesis) => no access
  if (!isCharacter && !isNemesis) return;

  // --- Pay cost
  if (isCharacter) {

  const cpCur = Number(actor.system?.chronicle_points?.current ?? 0) || 0;
  if (cpCur < 2) {
    ui.notifications?.warn?.("Not enough Chronicle Points (need 2).");
    return;
  }

  await actor.update({
    "system.chronicle_points.current": cpCur - 2
  });
    } else if (isNemesis) {
    // Nemesis pays 6 DSP (GM-only to spend DSP)
    if (!game.user.isGM) {
      ui.notifications?.warn?.("Only the GM can spend Dark Symmetry Pool.");
      return;
    }

    const dspNow = await getDSP();
    if (Number(dspNow) < 6) {
      ui.notifications?.warn?.(`Not enough Dark Symmetry Pool (need 6, have ${dspNow}).`);
      return;
    }
    await setDSP(Number(dspNow) - 6);
  }

  // Roll a d20 so Dice So Nice can display it, then force it to 1 (rule effect)
  const roll = await new Roll("1d20").evaluate({ async: true });
  const term = roll.dice?.[0];
  if (term?.results?.[0]) term.results[0].result = 1;
  roll._total = 1;

  if (game.dice3d) {
    await game.dice3d.showForRoll(roll, game.user, true);
  }

  state.dice.push(1);
  state.rerolled = Array.isArray(state.rerolled) ? state.rerolled : [];
  state.rerolled.push(false);
  state.chronicleUsed = true;
  state.chronicleIndex = state.dice.length - 1;

  await message.update({
    content: renderTestCard(state),
    flags: { [SYSTEM_ID]: { rollState: state } }
  });
}


/* =========================================================
   Roll Damage button (from a TEST card)
========================================================= */
async function handleRollDamage(message) {
  const state = message.getFlag(SYSTEM_ID, "rollState");
  if (!state || state.kind !== "test") return;

  const atk = state.attack;
  if (!atk) return;

  // Prevent double-click spamming
  if (atk.damageRolled) return;

  const actor = await fromUuid(state.actorUuid);
  if (!actor) return;

  // Try to resolve the weapon (optional, but useful for fallbacks)
  const weapon = atk.weaponId ? actor.items.get(atk.weaponId) : null;

  // Mode: trust atk.mode first, else infer from weapon
  const mode =
    atk.mode ??
    ((weapon?.system?.weaponType === "melee") ? "melee" : "ranged");

  // Prefer the precomputed values from the dialog (letRip/exploit already baked in)
  // If missing, compute a sensible fallback from weapon + actor
  let flatBonus = Number(atk.flatBonus);
  let dsdCount  = Number(atk.dsdCount);

  const needFallback = (!Number.isFinite(flatBonus) || !Number.isFinite(dsdCount));

  if (needFallback && weapon) {
    const dmgBonusDice = Number(getDamageBonus?.(actor, mode) ?? 0) || 0;

    const base = Number(weapon.system?.damage?.base ?? 0) || 0;
    const wFlat = Number(weapon.system?.damage?.flatBonus ?? 0) || 0;
    const dsy  = Number(weapon.system?.damage?.dsy  ?? 0) || 0;

    // Flat fallback = base de l’arme (+ flatBonus item). (Exploit/Let Rip sont déjà "baked in" quand ça vient du dialog)
    flatBonus = Number.isFinite(flatBonus) ? flatBonus : (base + wFlat);

    // DSD fallback = dés de l’arme + bonus de dégâts (en dés)
    dsdCount  = Number.isFinite(dsdCount)  ? dsdCount  : (dsy + dmgBonusDice);
  }

  // Still no good? Bail safely.
  flatBonus = Number(flatBonus) || 0;
  dsdCount  = Math.max(0, Number(dsdCount) || 0);

  await rollDamage({
    actor,
    weaponName: atk.weaponName ?? (weapon?.name ?? ""),
    mode,
    dsdCount,
    flatBonus,
    attackData: {
      ...atk,
      // Ensure qualities are present even if older attack state didn't store them
      qualities: Array.isArray(atk?.qualities)
        ? atk.qualities
        : (Array.isArray(weapon?.system?.qualities) ? weapon.system.qualities : [])
    }
  });

  // Mark as used and re-render the TEST card (hides the button)
  atk.damageRolled = true;
  state.attack = atk;

  await message.update({
    content: renderTestCard(state),
    flags: { [SYSTEM_ID]: { rollState: state } }
  });
}

/* =========================================================
   Gain Momentum
========================================================= */

async function handleGainMomentum(message, amount) {
  const state = message.getFlag(SYSTEM_ID, "rollState");
  if (!state || state.kind !== "test") return;

  // Only PCs
  if (state.actorType !== "character") return;

  // Prevent double-click spam
  if (state.momentumGranted) return;

  const n = Number(amount) || 0;
  if (n < 1) return;

  const cur = await getMomentum();
  const next = Math.min(6, (Number(cur) || 0) + n);

  await requestSetMomentum(next);

  // Mark as used + rerender to hide the button
  state.momentumGranted = true;

  await message.update({
    content: renderTestCard(state),
    flags: { [SYSTEM_ID]: { rollState: state } }
  });
}


/* =========================================================
   Rerolls (click a die in chat)
========================================================= */
async function handleReroll(message, kind, index) {
  const state = message.getFlag(SYSTEM_ID, "rollState");
  if (!state) return;

  // Test reroll (except AUTO-1)
if (state.kind === "test" && kind === "test") {
  const i = Number(index);
  if (i === state.chronicleIndex) return;

const roll = await new Roll("1d20").evaluate({ async: true });

// 🔥 Lancer Dice So Nice explicitement
if (game.dice3d) {
  await game.dice3d.showForRoll(roll, game.user, true);
}

state.dice[i] = roll.total;
state.rerolled[i] = true;

await message.update({
  content: renderTestCard(state),
  flags: { [SYSTEM_ID]: { rollState: state } }
});

  return;
}

// Damage rerolls
if (state.kind === "damage") {

  let roll = null;

  if (kind === "dsd") {
    const i = Number(index);
    roll = await new Roll("1d6").evaluate({ async: true });
    state.dsd[i] = roll.total;
    state.dsdRerolled[i] = true;

  } else if (kind === "location") {
    roll = await new Roll("1d20").evaluate({ async: true });
    state.locationD20 = roll.total;
    state.locationRerolled = true;

  } else return;

  // 🔥 Lance Dice So Nice explicitement
  if (game.dice3d) {
    await game.dice3d.showForRoll(roll, game.user, true);
  }

  await message.update({
    content: await renderDamageCard(state),
    flags: { [SYSTEM_ID]: { rollState: state } }
  });
}

}

/* =========================================================
   Global Trackers (Top-left)
========================================================= */

async function getDSP() { return game.settings.get(SYSTEM_ID, "darkSymmetryPool"); }
async function getMomentum() { return game.settings.get(SYSTEM_ID, "momentum"); }

async function setDSP(value) {
  if (!game.user.isGM) return;
  return game.settings.set(SYSTEM_ID, "darkSymmetryPool", clampInt(value));
}

async function requestSetMomentum(value) {
  value = clampInt(value, 0, 6); // ✅ cap à 6
  if (game.user.isGM) return game.settings.set(SYSTEM_ID, "momentum", value);
  game.socket.emit(SOCKET_NS, { type: "SET_MOMENTUM", value });
}

function ensureTrackersUI() {
  if (document.getElementById("mcde-trackers")) return;

  const wrap = document.createElement("div");
  wrap.id = "mcde-trackers";

  wrap.style.position = "fixed";
  wrap.style.top = "55px";
  wrap.style.left = "105px"; // avoids Foundry controls
  wrap.style.zIndex = "100";
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.gap = "8px";
  wrap.style.pointerEvents = "auto";

  const trackerBoxStyle =
    "min-width:210px; padding:6px 8px; border:1px; border-radius:6px;";
  const rowStyle =
    "margin-top:6px; display:flex; gap:6px; align-items:center; justify-content:flex-end;";
  const btnStyle = "width:32px;";
  const inputStyle = "width:64px; text-align:center;";

  wrap.innerHTML = `
    <div class="mcde-tracker" data-tracker="dsp" style="${trackerBoxStyle}">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:white;">Dark Symmetry Pool</strong>
        <span class="mcde-value" style="color:white; font-size:18px;">0</span>
      </div>
      <div style="${rowStyle}">
        <button type="button" data-action="dec" style="${btnStyle}">-</button>
        <input type="number" data-action="set" value="0" min="0" style="${inputStyle}">
        <button type="button" data-action="inc" style="${btnStyle}">+</button>
      </div>
      <div class="mcde-tracker-sub">GM only</div>
    </div>

    <div class="mcde-tracker" data-tracker="momentum" style="${trackerBoxStyle}">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <strong style="color:white;">Momentum</strong>
        <span class="mcde-value" style="color:white; font-size:18px;">0</span>
      </div>
      <div style="${rowStyle}">
        <button type="button" data-action="dec" style="${btnStyle}">-</button>
        <input type="number" data-action="set" value="0" min="0" style="${inputStyle}">
        <button type="button" data-action="inc" style="${btnStyle}">+</button>
      </div>
      <div class="mcde-tracker-sub">Everyone</div>
    </div>
  `;

  document.body.appendChild(wrap);

  wrap.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest("button");
    if (!btn) return;

    const trackerEl = ev.target.closest(".mcde-tracker");
    const which = trackerEl?.dataset?.tracker;
    const action = btn.dataset.action;
    if (!which || !action) return;

    if (which === "dsp" && !game.user.isGM) return;

    if (which === "dsp") {
      let v = await getDSP();
      v = clampInt(v + (action === "inc" ? 1 : -1));
      await setDSP(v);
    } else if (which === "momentum") {
      let v = await getMomentum();
      v = clampInt(v + (action === "inc" ? 1 : -1));
      await requestSetMomentum(v);
    }
  });

  wrap.addEventListener("change", async (ev) => {
    const input = ev.target?.closest("input[data-action='set']");
    if (!input) return;

    const trackerEl = ev.target.closest(".mcde-tracker");
    const which = trackerEl?.dataset?.tracker;
    if (!which) return;

    const v = clampInt(input.value);

    if (which === "dsp") {
      if (!game.user.isGM) return;
      await setDSP(v);
    } else if (which === "momentum") {
      await requestSetMomentum(v);
    }
  });

  if (!game.user.isGM) {
    const dspEl = wrap.querySelector(`.mcde-tracker[data-tracker="dsp"]`);
    dspEl.querySelectorAll("button,input").forEach((el) => (el.disabled = true));
    dspEl.style.opacity = "0.6";
  }
}

async function renderTrackersUI() {
  const wrap = document.getElementById("mcde-trackers");
  if (!wrap) return;

  const dsp = await getDSP();
  const mom = await getMomentum();

  const dspEl = wrap.querySelector(`.mcde-tracker[data-tracker="dsp"]`);

dspEl.dataset.level =
  dsp >= 20 ? "3" :
  dsp >= 10 ? "2" :
  dsp > 0  ? "1" : "0";

dspEl.querySelector(".mcde-value").textContent = dsp;
dspEl.querySelector("input[data-action='set']").value = dsp;

  const momEl = wrap.querySelector(`.mcde-tracker[data-tracker="momentum"]`);

momEl.dataset.level =
  mom >= 6 ? "3" :
  mom >= 3 ? "2" :
  mom > 0  ? "1" : "0";

momEl.querySelector(".mcde-value").textContent = mom;
momEl.querySelector("input[data-action='set']").value = mom;
}

/* =========================================================
   Actor Sheet
========================================================= */

class MCDECharacterSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {

  // Tabs are toggled manually (see _mcdeActivateTab in _onRender) rather
  // than via AppV2's static TABS system, to keep the existing single-file
  // template and minimize the diff during the AppV1 -> AppV2 conversion
  // (same approach as MCDENpcSheet / MCDEVehicleSheet).
  _mcdeActiveTab = "stats";

  _mcdeGetScrollEl(rootEl) {
    const root = rootEl ?? this.element ?? null;
    if (!root) return null;
    const byKey = root.querySelector(`.sheet-body .tab[data-tab="${CSS.escape(this._mcdeActiveTab ?? "stats")}"]`);
    return byKey ?? root.querySelector(".sheet-body .tab.active");
  }

  _mcdeActivateTab(tabId, root) {
    root = root ?? this.element;
    if (!root) return;
    this._mcdeActiveTab = tabId;
    root.querySelectorAll(".sheet-tabs [data-tab]").forEach(n => n.classList.toggle("active", n.dataset.tab === tabId));
    root.querySelectorAll(".sheet-body > .tab[data-tab]").forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mcde", "sheet", "actor", "character", "themed", "theme-light"],
    position: { width: 900, height: 800 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: mcdeEditImageAction
    }
  };

  static PARTS = {
    form: { template: `systems/${SYSTEM_ID}/templates/actor/character-sheet.html` }
  };

  get title() {
    return this.document.name;
  }

  async _preRender(context, options) {
    await super._preRender(context, options);
    try {
      const el = this._mcdeGetScrollEl();
      if (el) this._mcdeScrollTop = el.scrollTop ?? 0;
    } catch (_) {}
    this._mcdeSavedFocus = mcdeCaptureFocusedField(this.element);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.actor;

    context.system = this.actor.system ?? {};

context.owner = this.actor.isOwner;

    context.editable = this.isEditable;

    const items = this.actor.items?.contents ?? Array.from(this.actor.items ?? []);
    const bySort = (arr) => arr.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

    context.weaponsSorted   = bySort(items.filter(i => i.type === "weapon"));
    context.armorsSorted    = bySort(items.filter(i => i.type === "armor"));
    context.talentsSorted   = bySort(items.filter(i => i.type === "talent"));
    context.equipmentSorted = bySort(items.filter(i => i.type === "equipment"));
    context.spellsSorted    = bySort(items.filter(i => i.type === "spell"));

    // --------------------------
    // CHRONICLE POINTS (robust: supports legacy keys)
    // --------------------------
    const cp = foundry.utils.duplicate(context.system.chronicle_points ?? {});
    // legacy support: value -> current, total -> max
    const rawMax = cp.max ?? cp.total ?? 5;
    const rawCur = cp.current ?? cp.value ?? 0;

    let cpMax = Number(rawMax);
    if (!Number.isFinite(cpMax) || cpMax < 0) cpMax = 5;
    cpMax = Math.floor(cpMax);

    let cpCur = Number(rawCur);
    if (!Number.isFinite(cpCur) || cpCur < 0) cpCur = 0;
    cpCur = Math.floor(cpCur);
    cpCur = Math.min(cpCur, cpMax);

    context.system.chronicle_points = { ...cp, current: cpCur, max: cpMax };

    // Build boxes (like wounds)
    context.chronicleBoxes = Array.from({ length: cpMax }, (_, i) => ({
      index: i,
      filled: i < cpCur
    }));
  
    // --------------------------
    // DREAD (ensure structure + build rows for template)
    // --------------------------
    context.system.dread = context.system.dread ?? {};
    context.system.dread.value = Number(context.system.dread.value ?? 0) || 0;
    context.system.dread.trackers = context.system.dread.trackers ?? {};
    const T = context.system.dread.trackers;
    T.level0 = Array.isArray(T.level0) ? T.level0 : [false];
    T.level1 = Array.isArray(T.level1) ? T.level1 : [false, false];
    T.level2 = Array.isArray(T.level2) ? T.level2 : [false, false, false];
    T.level3 = Array.isArray(T.level3) ? T.level3 : [false, false, false, false];
    T.level4 = Array.isArray(T.level4) ? T.level4 : [false, false, false, false, false];

    const levels = [
      { key: "level0", num: 0, n: 1 },
      { key: "level1", num: 1, n: 2 },
      { key: "level2", num: 2, n: 3 },
      { key: "level3", num: 3, n: 4 },
      { key: "level4", num: 4, n: 5 }
    ];

    const dreadLabels = {
      0: "20",
      1: "19-20",
      2: "18-20",
      3: "17-20",
      4: "16-20"
    };

    // Affichage “pyramide” : 0 en haut -> 4 en bas
    const displayLevels = levels; // pas de reverse
    context.dreadRows = displayLevels.map((L) => {
      const arr = T[L.key];
      const boxes = Array.from({ length: L.n }, (_, i) => ({
        level: L.num,        // IMPORTANT : level = 0..4 (pas l’index d’affichage)
        index: i,
        filled: !!arr[i]
      }));

      // LED: D1..D4 pour les lignes 1..4 (pas de LED sur la ligne 0)
      const ledLabel = (L.num >= 1) ? `D${L.num}` : null;
      const ledOn = (L.num >= 1) ? boxes.every(b => b.filled) : false;

      return {
        label: dreadLabels[L.num] ?? String(L.num),
        boxes,
        ledLabel,
        ledOn
      };
    });

    // refresh dread.value from checkboxes (source of truth = trackers)
    const all = [T.level0, T.level1, T.level2, T.level3, T.level4].flat();
    context.system.dread.value = all.reduce((sum, v) => sum + (v ? 1 : 0), 0);

    // -------- XP: editable Current + Spent, Total = Current + Spent --------
    context.system.xp = context.system.xp ?? { current: 0, spent: 0, total: 0 };
    const currentXP = Number(context.system.xp.current ?? 0) || 0;
    const spentXP   = Number(context.system.xp.spent ?? 0) || 0;
    const totalXP   = Math.max(0, currentXP + spentXP);
    context.system.xp.current = currentXP;
    context.system.xp.spent = spentXP;
    context.system.xp.total = totalXP; // on garde total stocké aussi (utile ailleurs)
    context.xpTotal = totalXP;

    // --- Armor: compute summed soak (display-only) ---
    context.autoSoak = this._computeArmorAutoSoak();


    // -------- TRAITS (array of strings) --------
    context.system.traits = Array.isArray(context.system.traits) ? context.system.traits : [];

    /* ---------------------------------------------------------
    STATS TAB: attributes + skills table (grouped)
    --------------------------------------------------------- */
    context.system.attributes = context.system.attributes ?? {};
    context.system.skills = context.system.skills ?? {};

    const attributes = context.system.attributes;
    const skills = context.system.skills;

    const signatureCount = Object.values(skills).filter(s => !!s?.isSignature).length;
    context.signatureCount = signatureCount;

    // group skills by attribute
    const skillsByAttr = {};
    for (const [skillKey, sk] of Object.entries(skills)) {
      const aKey = sk?.attribute;
      if (!aKey) continue;
      (skillsByAttr[aKey] ??= []).push({ key: skillKey, ...sk });
    }

    context.statsBlocks = ATTR_ORDER
      .filter(aKey => attributes[aKey])
      .map(aKey => {
        const aVal = Number(attributes[aKey]?.value ?? 0) || 0;

        const rows = (skillsByAttr[aKey] ?? [])
          .sort((a, b) => {
            // general first, advanced after (optional)
            const aa = a.isAdvanced ? 1 : 0;
            const bb = b.isAdvanced ? 1 : 0;
            if (aa !== bb) return aa - bb;
            const la = SKILL_LABELS[a.key] ?? a.key;
            const lb = SKILL_LABELS[b.key] ?? b.key;
            return la.localeCompare(lb);
          })
          .map(sk => {
            const exp = Number(sk.expertise ?? 0) || 0;
            const foc = Number(sk.focus ?? 0) || 0;
            const isSig = !!sk.isSignature;
            const isAdv = !!sk.isAdvanced;

            return {
              key: sk.key,
              label: SKILL_LABELS[sk.key] ?? sk.key,
              attrKey: aKey,
              attrLabel: ATTR_LABELS[aKey] ?? aKey,
              expertise: exp,
              focus: foc,
              tn: (Number(aVal) || 0) + exp,
              isSignature: isSig,
              isAdvanced: isAdv,
              hasTraining: exp > 0,   // 👈 AJOUT IMPORTANT
              expMax: isSig ? 5 : 3,
              focusMax: isSig ? 5 : 3,
              sigDisabled: (!isSig && signatureCount >= 3)
            };
          });

        return {
          attribute: {
            key: aKey,
            label: ATTR_LABELS[aKey] ?? aKey,
            value: aVal
          },
          skills: rows
        };
      });
    // --- Masonry 2 columns: distribute blocks to minimize empty space ---
    const left = [];
    const right = [];
    let leftW = 0;
    let rightW = 0;
    for (const b of context.statsBlocks) {
      // poids simple = header(2) + nb skills (ça approxime bien la hauteur)
      const w = 2 + (b.skills?.length ?? 0);
      if (leftW <= rightW) { left.push(b); leftW += w; }
      else { right.push(b); rightW += w; }
    }
    context.statsLeft = left;
    context.statsRight = right;

    // ---------------------------------------------------------
    // Combat & Gear defaults (damage bonus + combat notes + wound tracks)
    // ---------------------------------------------------------
    context.system.damage_bonus ??= {};
    context.system.damage_bonus.ranged ??= { value: 0 };
    context.system.damage_bonus.melee ??= { value: 0 };
    context.system.damage_bonus.ranged.value = Number(context.system.damage_bonus.ranged.value ?? 0) || 0;
    context.system.damage_bonus.melee.value  = Number(context.system.damage_bonus.melee.value ?? 0) || 0;

    context.system.combatNotes ??= "";

    // Hit Locations tracks (used by the combat-locations partial)
    const safeArr = (v) => Array.isArray(v) ? v : [];
    const combat = context.system.combat ?? {};
    const serious  = safeArr(combat.seriousWounds);
    const critical = safeArr(combat.criticalWounds);
    const mental   = safeArr(combat.mentalWounds);
    context.woundTracks = {
      serious:  { boxes: serious,  max: serious.length },
      critical: { boxes: critical, max: critical.length },
      mental:   { boxes: mental,   max: mental.length }
    };

    // Enriched HTML for editor fields (combat notes)
    context.enriched = context.enriched ?? {};
    context.enriched.combatNotes = await foundry.applications.ux.TextEditor.implementation.enrichHTML(String(context.system.combatNotes ?? ""), {
      async: true,
      secrets: this.actor.isOwner,
      documents: true,
      relativeTo: this.actor
    });

    // Enriched HTML for editor fields (Notes + Background)
    context.enriched = context.enriched ?? {};

context.enriched.notes = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
  context.system.notes ?? "",
  {
    async: true,
    secrets: context.owner,
    documents: true,
    relativeTo: this.actor
  }
);

context.enriched.background = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
  context.system.background ?? "",
  {
    async: true,
    secrets: context.owner,
    documents: true,
    relativeTo: this.actor
  }
);


// -------------------------------------------------
// Compute automatic armor soak
// -------------------------------------------------
const armorItems = this.actor.items.filter(i => i.type === "armor");

const autoSoak = {
  head: 0,
  torso: 0,
  left_arm: 0,
  right_arm: 0,
  legs: 0
};

for (const armor of armorItems) {
  const soak = armor.system?.soak ?? {};

  autoSoak.head = Math.max(
    autoSoak.head,
    Number(soak.head ?? 0) || 0
  );

  autoSoak.torso = Math.max(
    autoSoak.torso,
    Number(soak.torso ?? 0) || 0
  );

  autoSoak.left_arm = Math.max(
    autoSoak.left_arm,
    Number(soak.left_arm ?? soak.leftArm ?? 0) || 0
  );

  autoSoak.right_arm = Math.max(
    autoSoak.right_arm,
    Number(soak.right_arm ?? soak.rightArm ?? 0) || 0
  );

  autoSoak.legs = Math.max(
    autoSoak.legs,
    Number(soak.legs ?? 0) || 0
  );
}

context.autoSoak = autoSoak;


    return context;
  }

  // -------------------------------------------------
  // Compute armor auto-soak (sum of all embedded armor items)
  // -------------------------------------------------
_computeArmorAutoSoak() {
  const armorItems = this.actor.items.filter(i => i.type === "armor");
  const autoSoak = { head: 0, torso: 0, left_arm: 0, right_arm: 0, legs: 0 };

  for (const armor of armorItems) {
    const soak = armor.system?.soak ?? {};

    autoSoak.head = Math.max(autoSoak.head, Number(soak.head ?? 0) || 0);
    autoSoak.torso = Math.max(autoSoak.torso, Number(soak.torso ?? 0) || 0);

    autoSoak.left_arm = Math.max(
      autoSoak.left_arm,
      Number(soak.left_arm ?? soak.leftArm ?? 0) || 0
    );

    autoSoak.right_arm = Math.max(
      autoSoak.right_arm,
      Number(soak.right_arm ?? soak.rightArm ?? 0) || 0
    );

    autoSoak.legs = Math.max(autoSoak.legs, Number(soak.legs ?? 0) || 0);
  }

  return autoSoak;
}

  
_onRender(context, options) {
  super._onRender(context, options);

  // MCDECharacterSheet's interaction logic (below) was written entirely
  // against jQuery (html.find/.on/.val/...). Rather than hand-convert
  // ~1600 lines of intricate, already-tested handlers to native DOM (high
  // transcription-error risk for no behavioral gain), we wrap the native
  // AppV2 root in a jQuery object and leave the body unchanged — jQuery
  // methods work identically on any DOM node regardless of which
  // framework created it. A full sheet re-render DOES regenerate the
  // PART's inner markup from scratch each time (verified live), but
  // `this.element` itself — the outer .application root this jQuery
  // object wraps — is NOT recreated between renders; it persists for the
  // sheet's whole lifetime. Any delegated handler bound with
  // `html.on(event, selector, fn)` therefore attaches to that same
  // never-destroyed node every render and stacks indefinitely (confirmed
  // live: e.g. "Set Damage Bonus" opened one confirmation dialog per
  // prior render of the sheet). `.off()` strips every jQuery-registered
  // handler from the root before the code below rebinds them fresh —
  // safe because Foundry's own window chrome (drag/resize/close) is
  // wired with native addEventListener, not jQuery, so it isn't touched.
  const html = $(this.element).off();

  // Restore scroll captured in _preRender (see _mcdeGetScrollEl above).
  try {
    const el = this._mcdeGetScrollEl(this.element);
    if (el && typeof this._mcdeScrollTop === "number") el.scrollTop = this._mcdeScrollTop;
  } catch (_) {}

  // Root DOM element of the sheet (reliable)
const $root = html;           // jQuery (see wrapping note above)
const rootEl = this.element;  // HTMLElement (native, AppV2)

const initSorting = () => {
  if (!rootEl) return;

  enableMcdeItemSortingNative(this.actor, rootEl, "ul.mcde-items",   "li.item[data-item-id]");
  enableMcdeItemSortingNative(this.actor, rootEl, "ul.mcde-armors",  "li.item[data-item-id]");
  enableMcdeItemSortingNative(this.actor, rootEl, "ul.mcde-ts-list", "li.mcde-ts-item[data-item-id]");
};

initSorting();

// Tabs are toggled manually under AppV2 (no more automatic `tabs:` option
// in DEFAULT_OPTIONS — same approach as MCDENpcSheet/MCDEVehicleSheet).
// Re-apply whichever tab was active before this render, and wire up
// manual tab switching (re-init sorting too, since a tab swap changes
// the visible DOM).
this._mcdeActivateTab(this._mcdeActiveTab, rootEl);
$root.find(".sheet-tabs [data-tab]").on("click", (ev) => {
  ev.preventDefault();
  this._mcdeActivateTab(ev.currentTarget.dataset.tab, rootEl);
  setTimeout(initSorting, 0);
});

// Restore focus captured in _preRender (see mcdeCaptureFocusedField
// above) — must run AFTER _mcdeActivateTab: until the active tab's
// `.active` class is re-applied, that tab's container is `display:none`,
// and browsers refuse to focus an element that isn't laid out/visible.
mcdeRestoreFocusedField(rootEl, this._mcdeSavedFocus);

    // --------------------------
    // DREAD clicks
    // --------------------------
    html.find(".mcde-dread-box").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

    const el = ev.currentTarget;
    const level = Number(el.dataset.level);
    const index = Number(el.dataset.index);
    if (!Number.isFinite(level) || !Number.isFinite(index)) return;

  const trackers = foundry.utils.duplicate(this.actor.system.dread?.trackers ?? {});

  const keys = ["level0", "level1", "level2", "level3", "level4"];
  const lens = [1, 2, 3, 4, 5];

  // sécurisation structure
  for (let l = 0; l <= 4; l++) {
    const k = keys[l];
    const n = lens[l];
    const arr = Array.isArray(trackers[k]) ? trackers[k] : [];
    trackers[k] = Array.from({ length: n }, (_, i) => !!arr[i]);
  }

// ordre logique voulu : haut → bas, gauche → droite
const order = [];
for (let l = 0; l <= 4; l++) {
  for (let i = 0; i < lens[l]; i++) {
    order.push({ level: l, index: i });
  }
}

  const pos = order.findIndex(o => o.level === level && o.index === index);
  if (pos < 0) return;

  // nombre actuel de cases remplies contiguës
  const isFilled = (o) => !!trackers[keys[o.level]][o.index];
  let curCount = 0;
  while (curCount < order.length && isFilled(order[curCount])) curCount++;

  let newCount;
  if (pos < curCount) newCount = pos;      // on retire
  else newCount = pos + 1;                 // on ajoute

  newCount = Math.max(0, Math.min(order.length, newCount));

  for (let p = 0; p < order.length; p++) {
    const o = order[p];
    trackers[keys[o.level]][o.index] = (p < newCount);
  }

  await this.actor.update({
    "system.dread.trackers": trackers,
    "system.dread.value": newCount
  });
});


    /* ---------------------------------------------------------
       COMBAT & GEAR TAB interactions (same behavior as Nemesis)
    --------------------------------------------------------- */

    // --- Hit Locations coloring (manual current/max) ---
    const applyLocColors = () => {
      const root = html[0];
      if (!root?.querySelectorAll) return;

      const wraps = root.querySelectorAll(".mcde-loc-wounds");
      wraps.forEach((wrap) => {
        const frame = wrap.closest(".mcde-loc-frame");
        if (!frame) return;

        const curEl = wrap.querySelector(".mcde-loc-current");
        const maxEl = wrap.querySelector(".mcde-loc-max");
        const cur = Number(curEl?.value ?? 0);
        const max = Math.max(1, Number(maxEl?.value ?? 0));
        const ratio = cur / max;

        frame.classList.remove("mcde-wound-ok", "mcde-wound-half", "mcde-wound-crit");
        if (ratio >= 0.75) frame.classList.add("mcde-wound-crit");
        else if (ratio >= 0.5) frame.classList.add("mcde-wound-half");
        else frame.classList.add("mcde-wound-ok");
      });
    };

    // Apply once on render + re-apply on edits
    applyLocColors();
    html.on("input", ".mcde-loc-current, .mcde-loc-max", () => applyLocColors());

    // --- Wound tracks (Serious/Critical/Mental): resize + click boxes ---
    const trackPath = (track) => `system.combat.${track}`;

    const resizeTrack = async (track, newMax) => {
      const cur = Array.isArray(this.actor.system.combat?.[track]) ? [...this.actor.system.combat[track]] : [];
      const max = Math.max(0, Number(newMax) || 0);

      const next = cur.slice(0, max);
      while (next.length < max) next.push(false);

      await this.actor.update({ [trackPath(track)]: next });
    };

    // ========================================
    // Set Wounds (from STR + PHY) helper
    // ========================================
    const mcdeWoundProfileFromTotal = (total) => {
      const t = Number(total) || 0;

      // NOTE: tes ranges se chevauchent à 20 (18-20 et 20-21).
      // On tranche: si t >= 20, on applique le palier 20-21 (plus "haut").
      if (t >= 30) return { head: 5, torso: 11, rightArm: 7, leftArm: 7, rightLeg: 9, leftLeg: 9, serious: 9, critical: 6 };
      if (t >= 28) return { head: 5, torso: 10, rightArm: 7, leftArm: 7, rightLeg: 8, leftLeg: 8, serious: 9, critical: 5 };
      if (t >= 26) return { head: 5, torso: 10, rightArm: 6, leftArm: 6, rightLeg: 8, leftLeg: 8, serious: 8, critical: 5 };
      if (t >= 24) return { head: 4, torso: 9,  rightArm: 6, leftArm: 6, rightLeg: 7, leftLeg: 7, serious: 8, critical: 5 };
      if (t >= 22) return { head: 4, torso: 9,  rightArm: 5, leftArm: 5, rightLeg: 7, leftLeg: 7, serious: 7, critical: 4 };
      if (t >= 20) return { head: 4, torso: 8,  rightArm: 5, leftArm: 5, rightLeg: 6, leftLeg: 6, serious: 7, critical: 4 };
      if (t >= 18) return { head: 3, torso: 8,  rightArm: 4, leftArm: 4, rightLeg: 6, leftLeg: 6, serious: 6, critical: 4 };
      if (t >= 16) return { head: 3, torso: 7,  rightArm: 4, leftArm: 4, rightLeg: 5, leftLeg: 5, serious: 6, critical: 3 };
      if (t >= 14) return { head: 3, torso: 7,  rightArm: 3, leftArm: 3, rightLeg: 5, leftLeg: 5, serious: 5, critical: 3 };
      if (t >= 12) return { head: 2, torso: 6,  rightArm: 3, leftArm: 3, rightLeg: 4, leftLeg: 4, serious: 5, critical: 3 };
      if (t >= 10) return { head: 2, torso: 6,  rightArm: 2, leftArm: 2, rightLeg: 4, leftLeg: 4, serious: 4, critical: 2 };
      return          { head: 2, torso: 5,  rightArm: 2, leftArm: 2, rightLeg: 3, leftLeg: 3, serious: 4, critical: 2 };
    };

    const mcdeClampLocCurrentToMax = (cur, max) => {
      const c = Number(cur ?? 0) || 0;
      const m = Math.max(0, Number(max ?? 0) || 0);
      return Math.max(0, Math.min(c, m));
    };

    // ========================================
    // REST helpers (display-only healing)
    // ========================================
    const mcdeHasAnyTrue = (arr) => Array.isArray(arr) && arr.some(Boolean);

    const mcdeGetSkillTNFocus = (actor, skillKey) => {
      const sys = actor?.system ?? {};
      const sk = sys.skills?.[skillKey] ?? {};
      const attrKey = sk.attribute;
      const attrVal = Number(sys.attributes?.[attrKey]?.value ?? 0) || 0;
      const exp = Number(sk.expertise ?? 0) || 0;
      const foc = Number(sk.focus ?? 0) || 0;
      return { tn: attrVal + exp, focus: foc, attrKey };
    };

    const mcdeRollRaw = async ({ actor, label, tn, focus, diceCount = 2, difficulty = 1 }) => {
      const roll = await (new Roll(`${diceCount}d20`)).evaluate({ async: true });
      const dice = roll?.dice?.[0]?.results?.map(r => Number(r.result))?.filter(n => Number.isFinite(n)) ?? [];
      const calc = computeTestSuccesses(dice, tn, focus, 20, 0);
      const html = renderTestCard({
        label,
        tn,
        focus,
        dice,
        difficulty,
        rerolled: false,
        chronicleIndex: null,
        repercussionFrom: 20,
        autoSuccesses: 0
      });
      return { roll, dice, calc, html };
    };

    // =====================================
// Damage Bonus: Set from attributes
// =====================================

const calcDamageBonusFromAttribute = (v) => {
  const val = Number(v ?? 0) || 0;

  if (val <= 8) return 0;
  if (val === 9) return 1;
  if (val <= 11) return 2;     // 10-11
  if (val <= 13) return 3;     // 12-13
  if (val <= 15) return 4;     // 14-15
  return 5;                    // 16+
};

html.on("click", ".mcde-set-damage-bonus", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const actor = this.actor;

  const awareness = Number(actor.system?.attributes?.awareness?.value ?? 0) || 0;
  const strength  = Number(actor.system?.attributes?.strength?.value ?? 0) || 0;

  const newRanged = calcDamageBonusFromAttribute(awareness);
  const newMelee  = calcDamageBonusFromAttribute(strength);

  const currentRanged = Number(actor.system?.damage_bonus?.ranged?.value ?? 0) || 0;
  const currentMelee  = Number(actor.system?.damage_bonus?.melee?.value ?? 0) || 0;

  const content = `
    <p>This will recalculate <b>Damage Bonuses</b> from attributes.</p>
    <hr/>
    <p>
      <b>Awareness</b>: ${awareness} → 
      <b>Ranged Bonus</b>: ${newRanged}
    </p>
    <p>
      <b>Strength</b>: ${strength} → 
      <b>Melee Bonus</b>: ${newMelee}
    </p>
    <hr/>
    <p style="opacity:.8">
      Current: Ranged ${currentRanged} | Melee ${currentMelee}
    </p>
  `;

  const ok = await mcdeConfirm({
  title: "Set Damage Bonus",
  content,
  classes: ["mcde-dialog"]
});

  if (!ok) return;

  await actor.update({
    "system.damage_bonus.ranged.value": newRanged,
    "system.damage_bonus.melee.value": newMelee
  });
});

    // =====================================
// Influence: manual value + "Set Influence"
// Personality -> bonus mapping
// =====================================
const calcInfluenceFromPersonality = (p) => {
  const v = Number(p ?? 0) || 0;
  if (v <= 8) return 0;
  if (v === 9) return 1;
  if (v <= 11) return 2;     // 10-11
  if (v <= 13) return 3;     // 12-13
  if (v <= 15) return 4;     // 14-15
  return 5;                  // >15
};

html.on("click", ".mcde-set-influence", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const actor = this.actor;

  // IMPORTANT: adapte la clé si ton attribut s'appelle autrement.
  const personality = Number(actor.system?.attributes?.personality?.value ?? 0) || 0;
  const next = calcInfluenceFromPersonality(personality);

  const current = Number(actor.system?.belongings?.influence ?? 0) || 0;

  const content = `
    <p>This will recalculate <b>Influence</b> from <b>Personality</b>.</p>
    <p>Personality: <b>${personality}</b> → Influence: <b>${next}</b></p>
    <p style="opacity:.8">Current stored value: <b>${current}</b></p>
  `;

  const ok = await mcdeConfirm({
  title: "Set Influence",
  content,
  classes: ["mcde-dialog"]
});

  if (!ok) return;

  await actor.update({ "system.belongings.influence": next });
});

html.on("change", "input[name='system.belongings.assets']", async (ev) => {
  // Stops Foundry's own `submitOnChange` (bound on the same root element)
  // from ALSO firing for this event: without this, a number input's
  // up/down-arrow spin (which fires "change" immediately, while still
  // focused — unlike typing, which waits for blur) triggers TWO
  // back-to-back re-renders instead of one, and the second one yanks
  // focus out of the field the user is still actively spinning. Safe
  // here because this handler already saves the field's own value below
  // — nothing native submitOnChange would have done is lost.
  ev.stopImmediatePropagation();
  const v = Math.max(0, Math.min(999, Math.floor(Number(ev.currentTarget.value ?? 0) || 0)));
  if (Number(ev.currentTarget.value) !== v) ev.currentTarget.value = v;
  await this.actor.update({ "system.belongings.assets": v });
});

    // Tainted de là
    const getTainted = () => {
  const t = Number(this.actor.system.combat?.tainted ?? 0);
  return Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0;
};

const applyTaintedMask = () => {
  const root = html[0];
  if (!root) return;

  const group = root.querySelector(`.mcde-wound-group[data-track="mentalWounds"]`);
  if (!group) return;

  const boxes = Array.from(group.querySelectorAll(".mcde-wound-box"));
  const tainted = Math.min(getTainted(), boxes.length);
  const allowed = Math.max(0, boxes.length - tainted);

  boxes.forEach((box, idx) => {
    box.classList.toggle("mcde-disabled", idx >= allowed);
  });
};

const sanitizeMentalWounds = async () => {
  const cur = Array.isArray(this.actor.system.combat?.mentalWounds)
    ? [...this.actor.system.combat.mentalWounds]
    : [];

  const tainted = Math.min(getTainted(), cur.length);
  const allowed = Math.max(0, cur.length - tainted);

  let changed = false;

  for (let i = allowed; i < cur.length; i++) {
    if (cur[i]) {
      cur[i] = false;
      changed = true;
    }
  }

  if (changed) {
    await this.actor.update({
      "system.combat.mentalWounds": cur
    });
  }
};
// Tainted jusque là

// Applique le masque une première fois au render
    applyTaintedMask();

    const setProgress = async (track, index) => {
      const cur = Array.isArray(this.actor.system.combat?.[track]) ? [...this.actor.system.combat[track]] : [];
      if (index < 0 || index >= cur.length) return;

      // --- TAINTED blocks the right-most mental boxes ---
      if (track === "mentalWounds") {
        const tainted = Math.min(getTainted(), cur.length);
        const allowed = Math.max(0, cur.length - tainted);
        if (index >= allowed) return; // click ignored on disabled zone
      }

      const clickedIsFilled = !!cur[index];
      const next = cur.slice();

      if (!clickedIsFilled) {
        for (let i = 0; i <= index; i++) next[i] = true;
      } else {
        for (let i = index; i < next.length; i++) next[i] = false;
      }

      await this.actor.update({ [`system.combat.${track}`]: next });
    };

    html.on("change", ".mcde-wound-group .mcde-wound-max", async (ev) => {
      // See the identical comment on the "system.belongings.assets" handler
      // above — same double-render/focus-loss fix. This input has no
      // `name` attribute at all (it's translated into a boxes array below,
      // not saved directly), so submitOnChange was never responsible for it.
      ev.stopImmediatePropagation();
      const group = ev.currentTarget.closest(".mcde-wound-group");
      const track = group?.dataset?.track;
      if (!track) return;
      await resizeTrack(track, ev.currentTarget.value);
      if (track === "mentalWounds") applyTaintedMask();
    });

    html.on("click", ".mcde-wound-group .mcde-wound-box", async (ev) => {
      const box = ev.currentTarget;
      const group = box.closest(".mcde-wound-group");
      const track = group?.dataset?.track;
      if (!track) return;
      const index = Number(box.dataset.index);
      await setProgress(track, index);
    });

html.on("change", ".mcde-tainted-input", async (ev) => {
  // See the identical comment on the "system.belongings.assets" handler
  // above — same double-render/focus-loss fix. Safe: this handler saves
  // "system.combat.tainted" itself, matching the input's own name.
  ev.stopImmediatePropagation();
  const t = Math.max(0, Math.floor(Number(ev.currentTarget.value ?? 0) || 0));
  await this.actor.update({ "system.combat.tainted": t });

  await sanitizeMentalWounds();
  applyTaintedMask();
});

    // ========================================
    // Loc Doll: Set Wounds button
    // ========================================
    html.off("click.mcdeSetWounds", "[data-action='loc-set-wounds']");
    html.on("click.mcdeSetWounds", "[data-action='loc-set-wounds']", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (!this.actor?.isOwner) return;

      const ok = await mcdeConfirm({
  title: "Set Wounds",
  content: `<p>Apply wound maximums from <b>Strength + Physique</b> and set <b>Mental Wounds</b> from <b>Mental Strength</b>?</p>`
});
if (!ok) return;

      const str = Number(this.actor.system?.attributes?.strength?.value ?? 0) || 0;
      const phy = Number(this.actor.system?.attributes?.physique?.value ?? 0) || 0;
      const total = str + phy;

      const ms = Number(this.actor.system?.attributes?.mental_strength?.value ?? 0) || 0;
      const prof = mcdeWoundProfileFromTotal(total);
      const mentalMax = Math.max(0, Math.floor(ms));

      const curLocs = this.actor.system?.combat?.locations ?? {};
      const nextLocs = foundry.utils.duplicate(curLocs);
      const ensure = (k) => {
        nextLocs[k] ??= {};
        nextLocs[k].current = mcdeClampLocCurrentToMax(nextLocs[k].current, nextLocs[k].max);
      };

      // ensure structure first
      ensure("head"); ensure("torso"); ensure("leftArm"); ensure("rightArm"); ensure("leftLeg"); ensure("rightLeg");

      // set max + clamp current
      nextLocs.head.max      = prof.head;      nextLocs.head.current      = mcdeClampLocCurrentToMax(nextLocs.head.current, prof.head);
      nextLocs.torso.max     = prof.torso;     nextLocs.torso.current     = mcdeClampLocCurrentToMax(nextLocs.torso.current, prof.torso);
      nextLocs.rightArm.max  = prof.rightArm;  nextLocs.rightArm.current  = mcdeClampLocCurrentToMax(nextLocs.rightArm.current, prof.rightArm);
      nextLocs.leftArm.max   = prof.leftArm;   nextLocs.leftArm.current   = mcdeClampLocCurrentToMax(nextLocs.leftArm.current, prof.leftArm);
      nextLocs.rightLeg.max  = prof.rightLeg;  nextLocs.rightLeg.current  = mcdeClampLocCurrentToMax(nextLocs.rightLeg.current, prof.rightLeg);
      nextLocs.leftLeg.max   = prof.leftLeg;   nextLocs.leftLeg.current   = mcdeClampLocCurrentToMax(nextLocs.leftLeg.current, prof.leftLeg);

      // Update locations first (single update)
      await this.actor.update({ "system.combat.locations": nextLocs });

      // Resize tracks
      await resizeTrack("seriousWounds", prof.serious);
      await resizeTrack("criticalWounds", prof.critical);
      await resizeTrack("mentalWounds", mentalMax);

      // mental taint safety + UI mask
      await sanitizeMentalWounds();
      applyTaintedMask();

      this.render(false);
      ui.notifications?.info?.("Wounds updated.");
    });

    // (R = Rest) : on branche juste un placeholder pour l’instant
    html.off("click.mcdeRest", "[data-action='loc-rest']");
    html.on("click.mcdeRest", "[data-action='loc-rest']", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.actor) return;

      const actor = this.actor;
      const combat = actor.system?.combat ?? {};

      // Determine worst physical wound level (Critical > Serious > Light)
      const hasCritical = mcdeHasAnyTrue(combat.criticalWounds);
      const hasSerious = mcdeHasAnyTrue(combat.seriousWounds);

      let physLevel = "Light";
      let physDelay = "1 Day";
      let physDiff = 1; // D1
      if (hasCritical) { physLevel = "Critical"; physDelay = "1 Month"; physDiff = 3; } // D3
      else if (hasSerious) { physLevel = "Serious"; physDelay = "1 Week"; physDiff = 2; } // D2

      // Momentum (for display only)
      const momentum = Number(game.settings.get(SYSTEM_ID, "momentum") ?? 0) || 0;

      // Mental Strength for healing + dread reduction
      const ms = Number(actor.system?.attributes?.mental_strength?.value ?? 0) || 0;
      const halfMS = Math.floor(ms / 2);
      const dreadLost = halfMS;

      // --- Physical Rest roll (Resistance)
      const resParams = mcdeGetSkillTNFocus(actor, "resistance");
      const phys = await mcdeRollRaw({
        actor,
        label: `Physical Rest — ${physLevel} (${physDelay})`,
        tn: resParams.tn,
        focus: resParams.focus,
        diceCount: 2,
        difficulty: physDiff
      });

      const physSucceeded = (phys.calc?.total ?? 0) >= physDiff;
      let physText = "";
      if (!physSucceeded) {
        physText = `<strong>Failure:</strong> no natural healing progress (try again after the required rest).`;
      } else {
        if (physLevel === "Light") {
          const base = Math.floor((Number(actor.system?.attributes?.physique?.value ?? 0) || 0) / 2);
          physText =
      `<strong>Success:</strong> recover <b>${base}</b> physical wounds (Physique/2, rounded down) ` +
      `+ <b>1 per Momentum</b> spent (currently ${momentum}).`;
        } else if (physLevel === "Serious") {
          physText =
      `<strong>Success:</strong> recover <b>1</b> serious wound ` +
      `+ <b>1 per 2 Momentum</b> spent (currently ${momentum} ⇒ +${Math.floor(momentum/2)} max).`;
        } else {
          physText =
      `<strong>Success:</strong> recover <b>1</b> critical wound and remove <b>1</b> critical wound effect.`;
        }
      }

      // --- Mental Rest roll (Willpower, D1)
      const willParams = mcdeGetSkillTNFocus(actor, "willpower");
      const mental = await mcdeRollRaw({
        actor,
        label: `Mental Rest — Willpower (D1)`,
        tn: willParams.tn,
        focus: willParams.focus,
        diceCount: 2,
        difficulty: 1
      });

      const mentalSucceeded = (mental.calc?.total ?? 0) >= 1;
      let mentalText = "";
      if (!mentalSucceeded) {
        mentalText = `<strong>Failure:</strong> no mental healing.`;
      } else {
        mentalText =
    `<strong>Success:</strong> recover <b>${halfMS}</b> mental wounds (Mental Strength/2, rounded down) ` +
    `+ <b>1 per Momentum</b> spent (currently ${momentum}).`;
      }

      // Dread reduction is automatic (no roll)
      const dreadText =
        `Natural rest: recover <b>${dreadLost}</b> Dread automatically (Mental Strength/2, rounded down).`;

      // --- Build a single rollcard with both rolls + text
      const content = `
        <div class="mcde-card-title" style="margin-bottom:6px;">
      Rest
    </div>

          <div style="margin-bottom:10px;">
            ${phys.html}
            <div style="margin-top:6px; opacity:.95;">${physText}</div>
          </div>

          <div style="margin-bottom:10px;">
            ${mental.html}
            <div style="margin-top:6px; opacity:.95;">${mentalText}</div>
          </div>

          <div class="mcde-card" data-mcde-card="1">
    <header class="mcde-card-header">
      <div class="mcde-card-kind">REST</div>
      <div class="mcde-card-title">NATURAL REST</div>
    </header>

    <div>
      Recover <strong>${dreadLost}</strong> Dread automatically
      <span style="opacity:.75;">(Mental Strength / 2, rounded down)</span>
    </div>
  </div>

          <div style="opacity:.8; font-size:12px; margin-top:8px;">
            Wounds should be edited manually on the character sheet when the character is healed.
          </div>
        </div>
      `;

      await ChatMessage.create({
        content,
        speaker: ChatMessage.getSpeaker({ actor }),
        rolls: [phys.roll, mental.roll]
      });
    });

// ========================================
// Reload bandolier: click bullets (SINGLE handler)
// ========================================
html.off("click.mcdeReload", ".mcde-reload-bullet");
html.off("click.mcdeReload", ".mcde-reload-bullet, .mcde-reload-bandolier img");
html.on("click.mcdeReload", ".mcde-reload-bullet, .mcde-reload-bandolier img", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const bullet = ev.currentTarget;
  const bandolier =
    bullet.closest(".mcde-reload-bandolier") ||
    bullet.parentElement?.closest?.(".mcde-reload-bandolier");

  if (!bandolier) {
    console.warn("[MCDE][RELOAD] No bandolier parent", bullet);
    return;
  }

  // value can be on the img OR on a wrapper
  const value =
    Number(bullet.dataset?.value ?? bandolier.dataset?.value ?? 0);

  if (!Number.isFinite(value) || value <= 0) {
    console.warn("[MCDE][RELOAD] Bad value", { value, bullet, bandolier });
    return;
  }

  // item id can be spelled multiple ways depending on template
  const itemId =
    bandolier.dataset.itemId ||
    bandolier.dataset.itemid ||
    bandolier.getAttribute("data-item-id") ||
    bandolier.getAttribute("data-itemid");

  if (!itemId) {
    console.warn("[MCDE][RELOAD] Missing itemId", bandolier);
    return;
  }

  const item = this.actor?.items?.get(itemId);
  if (!item) {
    console.warn("[MCDE][RELOAD] Item not found", itemId);
    return;
  }

  const max = Number(item.system?.reload?.max ?? bandolier.dataset.max ?? 10) || 10;
  const current = Number(item.system?.reload?.current ?? item.system?.reloadUsed ?? bandolier.dataset.current ?? 0) || 0;

  let newValue = (value <= current) ? (value - 1) : value;
  newValue = Math.max(0, Math.min(max, newValue));

  await item.update({
    "system.reload.max": max,
    "system.reload.current": newValue,
    "system.reloadUsed": newValue
  });

  this.render(false);
});

  async function openWeaponAttackDialog(weapon) {
  const actor = this.actor;
  const chronicleCurrent = Number(actor.system?.chronicle_points?.current ?? 0) || 0;
  const wt = String(weapon.system?.weaponType ?? "ranged").toLowerCase();

  const RULES = {
    melee:   { attr: "agility",      skill: "close_combat",   dmgBonus: "melee"  },
    unarmed: { attr: "agility",      skill: "unarmed_combat", dmgBonus: "melee"  },

    ranged:  { attr: "coordination", skill: "ranged_weapons", dmgBonus: "ranged" },
    heavy:   { attr: "coordination", skill: "heavy_weapons",  dmgBonus: "ranged" },
    mounted: { attr: "coordination", skill: "gunnery",        dmgBonus: "ranged" }
  };

const rule = RULES[wt] ?? RULES.ranged;
  const isRangedGroup = rule.dmgBonus === "ranged";   // ranged/heavy/mounted
  const isMeleeGroup  = !isRangedGroup;              // melee/unarmed
  const isRanged = isRangedGroup;                    // compat: legacy variable used below

// ---- Which skill is used
const attrKey = rule.attr;
const skillKey = rule.skill;

  const attrVal = Number(actor.system?.attributes?.[attrKey]?.value ?? 0) || 0;
  const exp = Number(actor.system?.skills?.[skillKey]?.expertise ?? 0) || 0;
  const foc = Number(actor.system?.skills?.[skillKey]?.focus ?? 0) || 0;

  const tn = attrVal + exp;
  const focus = foc;

  // ---- Weapon info
  const wName = weapon.name ?? "Weapon";
  const wRange = String(weapon.system?.stats?.range ?? "");
  const wMode = String(weapon.system?.stats?.mode ?? "");
  const qualities = Array.isArray(weapon.system?.qualities) ? weapon.system.qualities : [];

  const hasUnwieldy =
    String(weapon.system?.stats?.size ?? "").toLowerCase() === "unwieldy" ||
    qualities.some(q => String(q?.name ?? "").toLowerCase() === "unwieldy");

  // Let Rip only for ranged + mode != Munition
  const canLetRip = isRangedGroup && wMode && wMode.toLowerCase() !== "munition";
  const letRipMax =
    !canLetRip ? 0 :
    (wMode.toLowerCase() === "semi-automatic" ? 1 :
     wMode.toLowerCase() === "burst" ? 2 :
     wMode.toLowerCase() === "automatic" ? 3 : 0);

  const reloadCur = Number(weapon.system?.reload?.current ?? weapon.system?.reloadUsed ?? 0) || 0;

  const baseDsd = getWeaponBaseDSD(weapon);

  // ---- Traits HTML (with hover tooltip)
  const traitsHtml = qualities.length
    ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
        ${qualities.map(q => {
          const n = String(q?.name ?? "Trait");
          const d = String(q?.description ?? "");
          return `<span style="padding:2px 6px; border:1px solid rgba(0,90,60,0.5); border-radius:10px; font-size:11px;"
                        title="${foundry.utils.escapeHTML(d)}">${foundry.utils.escapeHTML(n)}</span>`;
        }).join("")}
      </div>`
    : `<div style="opacity:0.65; margin-top:6px;"><small>No traits.</small></div>`;

  // ---- Let Rip bullets (UI)
  const bulletSrcFull  = "systems/mutant-chronicles-diesel-edition/assets/sheet/reloadfull.png";
  const bulletSrcEmpty = "systems/mutant-chronicles-diesel-edition/assets/sheet/reloadempty.png";

  const letRipUiMax = (!canLetRip || letRipMax <= 0) ? 0 : (letRipMax + 1);
  const letRipHtml = (!canLetRip || letRipMax <= 0) ? "" : `
    <hr/>
    <div style="display:flex; flex-direction:column; gap:6px;">
      <div class="mcde-dialog-section-title" style="margin-bottom:0;">Let Rip</div>
      <div style="opacity:0.75; font-size:12px;">
        Select bullets to spend (max <span class="mcde-let-rip-max">${letRipMax}</span>). Ammo: <strong>${reloadCur}</strong>
      </div>
      <label style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" name="overRip" />
        <span>Over Rip (+1 max Let Rip)</span>
      </label>
      <div class="mcde-let-rip" data-base-max="${letRipMax}" data-max="${letRipMax}" data-selected="0"
           style="display:flex; gap:6px; align-items:center; justify-content:flex-start;">
        ${Array.from({length: letRipUiMax}).map((_, i) => {
          const v = i+1;
          return `<img class="mcde-let-rip-bullet"
                       data-value="${v}"
                       src="${bulletSrcEmpty}"
                       style="width:12px; height:auto; cursor:pointer; opacity:${v <= letRipMax ? 0.9 : 0.25}; display:block;" />`;
        }).join("")}
      </div>
    </div>
    <input type="hidden" name="letRip" value="0"/>
  `;

  const braceHtml = (!isRangedGroup || !hasUnwieldy) ? "" : `
    <hr/>
    <label style="display:flex; align-items:center; gap:8px;">
      <input type="checkbox" name="brace" />
      <span><strong>Brace</strong> (required for Unwieldy weapons)</span>
    </label>
    <div style="opacity:0.75; font-size:12px; margin-top:4px;">
      If not braced: +2 Difficulty and Repercussion range increases by 1.
    </div>
  `;

  // ---- Build dialog content
  const content = `
    <form class="mcde-attack-dialog" style="display:flex; flex-direction:column; gap:8px;">
      <div>
        <div class="mcde-dialog-heading">${foundry.utils.escapeHTML(wName)}</div>
        <div class="mcde-dialog-subheading">
          Attack Type: <strong>${isRanged ? "Ranged" : "Melee"}</strong>
          ${isRanged ? ` | Range: <strong>${foundry.utils.escapeHTML(wRange)}</strong> | Firing Mode: <strong>${foundry.utils.escapeHTML(wMode)}</strong>` : ``}
        </div>
        ${traitsHtml}
      </div>

      <hr/>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
        <div>
          <div class="mcde-dialog-section-title">Modifiers</div>

          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span>Buy Extra d20 (1 DSP each, max 3)</span>
            <select name="extraDice">
              <option value="0" selected>0 (2d20)</option>
              <option value="1">1 (3d20)</option>
              <option value="2">2 (4d20)</option>
              <option value="3">3 (5d20)</option>
            </select>
          </label>

          <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
  <input type="checkbox" name="useChronicle" ${chronicleCurrent <= 0 ? "disabled" : ""}/>
  <span>Use Chronicle Point (adds AUTO-1 die)</span>
</label>
<div style="opacity:0.75; font-size:12px; margin-top:2px;">
  Available: <strong>${chronicleCurrent}</strong>
</div>
        </div>


        <div>
          <div class="mcde-dialog-section-title">Difficulty</div>
          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span>Difficulty</span>
            <select name="difficulty">
              <option value="0">D0</option>
              <option value="1" selected>D1</option>
              <option value="2">D2</option>
              <option value="3">D3</option>
              <option value="4">D4</option>
              <option value="5">D5</option>
            </select>
          </label>
        </div>
      </div>

      <hr/>

      <div>
        <div class="mcde-dialog-section-title">Attack Modifiers</div>
        <label style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" name="exploitWeakness"/>
          <span>Exploit Weakness (+2d20, +2 DSD)</span>
        </label>

        <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
          <input type="checkbox" name="surprise"/>
          <span>Surprise (+1d20)</span>
        </label>
      </div>

      ${letRipHtml}
      ${braceHtml}

      <hr/>
      <div style="opacity:0.75; font-size:12px;">
        Test: <strong>${attrKey}</strong> + <strong>${skillKey}</strong> ⇒ TN <strong>${tn}</strong>, Focus <strong>${focus}</strong>
      </div>
    </form>
  `;

  // ---- Dialog
  mcdeDialogV2({
    title: `Attack — ${wName}`,
    content,
    width: 560,
    extraClasses: ["mcde-attack-dialog"],
    defaultAction: "roll",
    buttons: {
      roll: {
        label: "Roll Attack",
        callback: async (root) => {
          const extraDice = Number(root.querySelector("[name='extraDice']")?.value ?? 0) || 0;
          const useChronicle = !!root.querySelector("[name='useChronicle']")?.checked;

          const exploit = !!root.querySelector("[name='exploitWeakness']")?.checked;
          const surprise = !!root.querySelector("[name='surprise']")?.checked;

          const baseDiff = Number(root.querySelector("[name='difficulty']")?.value ?? 1) || 1;

          let letRip = Number(root.querySelector("[name='letRip']")?.value ?? 0) || 0;
          const baseMax = Number(root.querySelector(".mcde-let-rip")?.dataset.baseMax ?? 0) || 0;
          const overRip = !!root.querySelector("[name='overRip']")?.checked;
          const maxLetRip = baseMax + (overRip ? 1 : 0);
          if (letRip > maxLetRip) letRip = maxLetRip;

          const brace = !!root.querySelector("[name='brace']")?.checked;

           // ---- Munition mode: consume 1 reload per attack
 if (isRangedGroup && weapon.system?.stats?.mode === "Munition") {
   const cur = Number(weapon.system?.reload?.current ?? weapon.system?.reloadUsed ?? 0) || 0;

   if (cur <= 0) {
     ui.notifications?.warn?.("No reloads remaining (Munition mode).");
     return;
   }

   const newCur = cur - 1;
   await weapon.update({
     "system.reload.current": newCur,
     "system.reloadUsed": newCur
   });
 }

          // ---- Ammo spend for Let Rip
          if (isRangedGroup && letRip > 0) {
            const cur = Number(weapon.system?.reload?.current ?? weapon.system?.reloadUsed ?? 0) || 0;
            if (cur < letRip) {
              ui.notifications?.warn?.("Not enough ammo for Let Rip.");
              return;
            }
            const newCur = cur - letRip;

            // Keep both fields for compatibility
            await weapon.update({
              "system.reload.current": newCur,
              "system.reloadUsed": newCur
            });
          }

                    if (useChronicle) {
  const cur = Number(actor.system?.chronicle_points?.current ?? 0) || 0;
  if (cur <= 0) {
    ui.notifications?.warn?.("Not enough Chronicle Points.");
    return;
  }
  await actor.update({ "system.chronicle_points.current": cur - 1 });
}

          // ---- Dice count (2 base)
          let diceCount = 2;
          diceCount += Math.max(0, Math.min(3, extraDice));
          if (exploit) diceCount += 2;
          if (surprise) diceCount += 1;
          if (letRip > 0) diceCount += letRip;

          // Limit rule: only "buy extra d20" is capped (already handled by select max=3).
          // Other modifiers may push beyond 5d20.
          // Keep a hard safety cap to avoid crazy rolls.
          const HARD_CAP_D20 = 20; // adjust if you want
          diceCount = Math.max(1, Math.min(HARD_CAP_D20, diceCount));

          // ---- Difficulty / Brace (Unwieldy)
          let difficulty = baseDiff;
          let repFrom = null;

          if (isRanged && hasUnwieldy && !brace) {
            difficulty += 2;

            // Increase repercussion range by 1 => threshold -1 (ex: 20 -> 19, 19 -> 18, etc.)
            const baseRep = getRepercussionRange(actor);
            repFrom = Math.max(1, baseRep - 1);
          }

          // ---- DSP pool increase when buying extra d20
          if (extraDice > 0) {
            const curPool = await getDSP();
            await setDSP(curPool + extraDice);
          }

// ---- Damage
          const mode = (rule.dmgBonus === "ranged") ? "ranged" : "melee";
          const dmgBonus = getDamageBonus(actor, mode); // ✅ bonus EN DÉS (DSD)

          // Flat damage = weapon base + item flatBonus
          const flatBonus =
            (Number(weapon.system?.damage?.base ?? 0) || 0) +
            (Number(weapon.system?.damage?.flatBonus ?? 0) || 0);

          // DSD dice = weapon base DSD + damage bonus (dice) + Exploit(+2 DSD) + Let Rip dice
          const dsd =
            getWeaponBaseDSD(weapon) +
            (Number(dmgBonus) || 0) +
            (exploit ? 2 : 0) +
            (letRip > 0 ? letRip : 0);
// ---- Roll test (damage is triggered from the TEST chat card)
          const msg = await game.mcde.rollTest({
            actor,
            label: `${wName} Attack`,
            tn,
            focus,
            diceCount,
            useChroniclePoint: useChronicle,
            autoSuccesses: 0,
            difficulty,
            repercussionFrom: repFrom,
            attackData: {
              weaponId: weapon.id,
              weaponName: wName,
              mode: isRangedGroup ? "ranged" : "melee",
              dsdCount: Number(dsd) || 0,
              flatBonus: Number(flatBonus) || 0,

            // 🔥 on stocke les options choisies (pas des nombres "finaux")
            letRip,
            exploitWeakness: exploit,

            // (optionnel) si tu veux garder l’info pour l’UI
            surprise,
            extraDice,
}
          });
// (Optional) You can use msg if you want to do follow-up updates.
        }
      },
      cancel: { label: "Cancel" }
    },
    render: (root) => {
      // Let Rip click behavior + Over Rip (+1 max)
  const wrap = root.querySelector(".mcde-let-rip");
  if (!wrap) return;

  const hidden = root.querySelector("[name='letRip']");
  const over = root.querySelector("[name='overRip']");

  // base max is fixed by weapon mode; UI can show +1 bullet but we unlock it via checkbox
  const baseMax = Number(wrap.dataset.baseMax ?? wrap.dataset.max ?? 0) || 0;
  const getMax = () => baseMax + (over?.checked ? 1 : 0);

  const setSelected = (n) => {
    const max = getMax();
    n = Math.max(0, Math.min(max, n));
    wrap.setAttribute("data-selected", String(n));
    if (hidden) hidden.value = String(n);

    // update label if present
    const lbl = root.querySelector(".mcde-let-rip-max");
    if (lbl) lbl.textContent = String(max);

    // refresh bullets
    const imgs = wrap.querySelectorAll(".mcde-let-rip-bullet");
    imgs.forEach((el) => {
      const v = Number(el.dataset.value ?? 0) || 0;
      el.src = (v > 0 && v <= n) ? bulletSrcFull : bulletSrcEmpty;
      el.style.opacity = (v <= max) ? "0.9" : "0.25";
      el.style.pointerEvents = (v <= max) ? "auto" : "none";
    });
  };

  // init
  setSelected(0);

  // toggling over rip should refresh UI + clamp selection
  over?.addEventListener("change", () => setSelected(Number(hidden?.value ?? 0) || 0));
  over?.addEventListener("click",  () => setSelected(Number(hidden?.value ?? 0) || 0));

  wrap.addEventListener("click", (ev) => {
    const bullet = ev.target.closest(".mcde-let-rip-bullet");
    if (!bullet) return;
    const v = Number(bullet.dataset.value ?? 0) || 0;
    const max = getMax();
    if (v > max) return;

    const cur = Number(hidden?.value ?? 0) || 0;
    const next = (v <= cur) ? (v - 1) : v;
    setSelected(next);
  });
    }
  });
}


    // --- Weapons: click = open ATTACK dialog (instead of rolling damage instantly) ---
html.off("click.mcdeWeaponAttack", ".mcde-roll[data-roll='weapon']");
html.on("click.mcdeWeaponAttack", ".mcde-roll[data-roll='weapon']", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const weaponId = ev.currentTarget.dataset.itemId;
  const weapon = this.actor?.items?.get(weaponId);
  if (!weapon) return;

  await openWeaponAttackDialog.call(this, weapon);
});


    // --- Weapons: Add / Edit / Delete (same as other sheets) ---
    html.on("click", ".mcde-weapon-add", async (ev) => {
      ev.preventDefault();
      const [created] = await this.actor.createEmbeddedDocuments("Item", [{
        name: "New Weapon",
        type: "weapon",
        system: {
          weaponType: "ranged",
          restriction: 0,
          cost: 0,
          stats: { range: "Close", mode: "Semi-Automatic", enc: 0, size: "One-Handed", reliability: 0 },
          damage: { base: 1, dsy: 0, flatBonus: 0 },
          reload: { max: 0 },
          qualities: [],
          description: ""
        }
      }]);
      if (created) created.sheet.render(true);
    });

    // --- Armor: Add / Edit / Delete ---
    html.on("click", ".mcde-armor-add", async (ev) => {
      ev.preventDefault();
      const [created] = await this.actor.createEmbeddedDocuments("Item", [{
        name: "New Armor",
        type: "armor",
        system: {
          faction: "",
          tags: [],
          soak: { head: 0, torso: 0, left_arm: 0, right_arm: 0, legs: 0 },
          encumbrance: "",
          restriction: "",
          cost: "",
          description: ""
        }
      }]);
      if (created) created.sheet.render(true);
    });


    html.on("click", ".mcde-weapon-edit", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = ev.currentTarget.closest(".mcde-weapon");
      const itemId = li?.dataset?.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;
      item.sheet.render(true);
    });

    html.on("click", ".mcde-weapon-delete", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = ev.currentTarget.closest(".mcde-weapon");
      const itemId = li?.dataset?.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;
      await item.delete();
    });

    // --- Armor: edit/delete ---
html.on("click", ".mcde-armor-edit", async (ev) => {
  ev.preventDefault(); ev.stopPropagation();
  const li = ev.currentTarget.closest(".mcde-armor");
  const item = this.actor.items.get(li?.dataset?.itemId);
  if (item) item.sheet.render(true);
});

html.on("click", ".mcde-armor-delete", async (ev) => {
  ev.preventDefault(); ev.stopPropagation();
  const li = ev.currentTarget.closest(".mcde-armor");
  const item = this.actor.items.get(li?.dataset?.itemId);
  if (item) await item.delete();
});

// ---------------------------------------------------------
// Weapons: Reloads (ranged only) => persist to the embedded weapon
// ---------------------------------------------------------
html.on("change", ".mcde-weapon .mcde-reload-input", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const input = ev.currentTarget;
  const li = input.closest(".mcde-weapon");
  const itemId = li?.dataset?.itemId;
  const weapon = this.actor.items.get(itemId);
  if (!weapon) return;

  let v = Number(input.value ?? 0);
  if (!Number.isFinite(v)) v = 0;
  v = Math.max(0, Math.trunc(v));

  const reload = foundry.utils.duplicate(weapon.system.reload ?? {});
  reload.max = v;

  // Optionnel : si tu conserves current dans le data model, on le “cale” au cas où
  if (reload.current != null) reload.current = Math.min(Number(reload.current) || 0, reload.max);

  await weapon.update({ "system.reload": reload });
});

// ===============================
// Talents + Spells accordions (persistent per user)
// ===============================
const ACC_SCOPE = SYSTEM_ID;

const setupAccordionPersistence = (flagKey, rootSelector) => {
  // --- Restore state on render ---
  try {
    const saved = game.user?.getFlag(ACC_SCOPE, flagKey) ?? {};
    html.find(`${rootSelector} .mcde-ts-item[data-item-id]`).each((_, el) => {
      const id = el.dataset.itemId;
      if (!id) return;
      const isOpen = saved[id];
      if (typeof isOpen === "boolean") el.classList.toggle("open", isOpen);
    });
  } catch (e) {
    console.warn(`MCDE | Failed to restore accordion state (${flagKey})`, e);
  }

  // --- Save state when toggled ---
  const saveState = async (itemId, isOpen) => {
    if (!game.user) return;
    const saved = (game.user.getFlag(ACC_SCOPE, flagKey) ?? {});
    saved[itemId] = !!isOpen;
    await game.user.setFlag(ACC_SCOPE, flagKey, saved);
  };

  // Bind toggle on header (scoped)
  html.off(`click.${flagKey}`, `${rootSelector} .mcde-ts-header`);
  html.on(`click.${flagKey}`, `${rootSelector} .mcde-ts-header`, async (ev) => {
    // Avoid toggling when clicking edit/delete controls inside header
    if (ev.target.closest(".item-controls")) return;

    const li = ev.currentTarget.closest(".mcde-ts-item");
    const itemId = li?.dataset?.itemId;
    if (!li || !itemId) return;

    const nowOpen = !li.classList.contains("open");
    li.classList.toggle("open", nowOpen);

    await saveState(itemId, nowOpen);
  });
};

setupAccordionPersistence("accordionTalentsTab", `.tab[data-tab="talents"]`);
setupAccordionPersistence("accordionSpellsTab", `.tab[data-tab="spells"]`);


  // Add item
  html.off("click.mcdeTsAdd", ".mcde-ts-add");
  html.on("click", ".mcde-ts-add", async ev => {
  const type = ev.currentTarget.dataset.type;

  const defaultName = {
    equipment: "New Equipment",
    talent: "New Talent",
    spell: "New Spell"
  }[type] ?? "New Item";

  await this.actor.createEmbeddedDocuments("Item", [{
    name: defaultName,
    type
  }]);
});

// Edit item
html.on("click", ".mcde-ts-edit", ev => {
  const li = ev.currentTarget.closest(".mcde-ts-item");
  const item = this.actor.items.get(li.dataset.itemId);
  if (item) item.sheet.render(true);
});

// Delete item
html.on("click", ".mcde-ts-delete", async ev => {
  const li = ev.currentTarget.closest(".mcde-ts-item");
  const id = li.dataset.itemId;
  await this.actor.deleteEmbeddedDocuments("Item", [id]);
});

// --- Armor drop: allow dropping Armor items into this zone ---
html.find(".mcde-armor-dropzone").on("drop", async (ev) => {

  // --- IMPORTANT: if it's our internal reorder, let the UL handler process it
  const oe = ev.originalEvent ?? ev;
  const isSort = (() => {
    try {
      if (oe.dataTransfer?.types?.includes("text/mcde-sort")) return true;
      const plain = oe.dataTransfer?.getData?.("text/plain");
      return plain === "mcde-sort";
    } catch (_) { return false; }
  })();
  if (isSort) return; // do NOT prevent/stopPropagation here

  // 1) Bloquer le drop Foundry "global" (sinon double création)
  ev.preventDefault();
  ev.stopPropagation();

  try {
    oe.preventDefault?.();
    oe.stopPropagation?.();
    oe.stopImmediatePropagation?.();
  } catch (e) {}

  // 2) Lire la payload de drag
  let data;
  try {
    data = JSON.parse(oe.dataTransfer.getData("text/plain"));
  } catch {
    return false;
  }
  if (!data) return false;

  // 3) Résoudre le document drop (uuid / world item)
  let doc = null;
  try {
    if (data.uuid) doc = await fromUuid(data.uuid);
    else if (data.type === "Item" && data.id) doc = game.items.get(data.id);
  } catch (e) {}

  if (!doc || doc.type !== "armor") return false;

  // 4) (Optionnel) anti-doublon "même sourceId"
  const sourceId = doc.uuid ?? doc.flags?.core?.sourceId;
  if (sourceId) {
    const exists = this.actor.items.some(i => (i.flags?.core?.sourceId === sourceId) || (i.uuid === sourceId));
    if (exists) return false;
  }

  // 5) Embed copy of armor into actor
  const created = await this.actor.createEmbeddedDocuments("Item", [doc.toObject()]);
  const armor = created?.[0];
  if (!armor) return false;

  // 7) Important pour jQuery : empêcher toute propagation restante
  return false;
});



// Chronicle: click boxes to set current
html.find(".mcde-chronicle-box").on("click", async (ev) => {
  const index = Number(ev.currentTarget.dataset.index);
  const max = Math.max(0, Number(this.actor.system.chronicle_points?.max) || 0);
  let current = Math.max(0, Number(this.actor.system.chronicle_points?.current) || 0);

  // same logic as wounds: click filled -> decrease, else set to index+1
  if (index + 1 <= current) current = index;
  else current = index + 1;

  current = Math.max(0, Math.min(max, current));
  await this.actor.update({ "system.chronicle_points.current": current });
});

// Chronicle: when max changes, clamp current
html.find("input[name='system.chronicle_points.max']").on("change", async (ev) => {
  const max = Math.max(0, Number(ev.currentTarget.value) || 0);
  const current = Math.max(0, Number(this.actor.system.chronicle_points?.current) || 0);
  if (current > max) await this.actor.update({ "system.chronicle_points.current": max });
});


    // XP auto-total
    const recalcTotal = async () => {
      const currentXP = Number(this.actor.system.xp?.current ?? 0) || 0;
      const spentXP   = Number(this.actor.system.xp?.spent ?? 0) || 0;
      const totalXP   = Math.max(0, currentXP + spentXP);
      // évite les updates inutiles
      if ((Number(this.actor.system.xp?.total ?? 0) || 0) !== totalXP) {
        await this.actor.update({ "system.xp.total": totalXP });
      }
    };

    html.find("input[name='system.xp.current']").on("change", recalcTotal);
    html.find("input[name='system.xp.spent']").on("change", recalcTotal);


    // + Add trait
    html.find(".mcde-trait-add").on("click", async (ev) => {
      ev.preventDefault();

      const content = `
        <form class="mcde-trait-dialog">
          <div class="form-group">
            <label>New Trait</label>
            <input type="text" name="trait" placeholder="e.g. Veteran, Fearless, Cautious..." autofocus>
          </div>
        </form>
      `;

      mcdeDialogV2({
        title: "Add Trait",
        content,
        width: 420,
        extraClasses: ["mcde-trait-dialog"],
        defaultAction: "add",
        buttons: {
          add: {
            label: "Add",
            callback: async (root) => {
              const v = String(root.querySelector("[name='trait']")?.value ?? "").trim();
              if (!v) return;
              const cur = Array.isArray(this.actor.system.traits) ? [...this.actor.system.traits] : [];
              cur.push(v);
              await this.actor.update({ "system.traits": cur });
            }
          },
          cancel: { label: "Cancel" }
        }
      });
    });

    // x Remove trait
    html.find(".mcde-trait-remove").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const idx = Number(ev.currentTarget.dataset.index);
      const cur = Array.isArray(this.actor.system.traits) ? [...this.actor.system.traits] : [];
      if (!Number.isFinite(idx) || idx < 0 || idx >= cur.length) return;
      cur.splice(idx, 1);
      await this.actor.update({ "system.traits": cur });
    });
    
    
// --------------------------
// Armor: "Set Soaks" button (write summed soak into hit locations)
// --------------------------
html.on("click", ".mcde-armor-setsoaks", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const auto = this._computeArmorAutoSoak();

const go = await mcdeConfirmV13({
    title: "Set Soaks",
    content: `<p>This will overwrite the current Hit Locations soaks with the highest soak per location from equipped armors.</p>`
  });
  if (!go) return;

  await this.actor.update({
    "system.combat.locations.head.soak": auto.head,
    "system.combat.locations.torso.soak": auto.torso,
    "system.combat.locations.leftArm.soak": auto.left_arm,
    "system.combat.locations.rightArm.soak": auto.right_arm,
    "system.combat.locations.leftLeg.soak": auto.legs,
    "system.combat.locations.rightLeg.soak": auto.legs
  });
});

    /* ---------------------------------------------------------
       STATS TAB interactions
    --------------------------------------------------------- */

    // Toggle Signature (max 3)
    html.find("[data-action='toggle-signature']").on("change", async (ev) => {
      ev.preventDefault();
      const cb = ev.currentTarget;
      const skillKey = cb?.dataset?.skill;
      if (!skillKey) return;

      const skills = this.actor.system.skills ?? {};
      const sk = skills[skillKey];
      if (!sk) return;

      const currentSigCount = Object.values(skills).filter(s => !!s?.isSignature).length;
      const wantSig = !!cb.checked;

      if (wantSig && currentSigCount >= 3) {
        ui.notifications?.warn("You can only have 3 Signature Skills.");
        cb.checked = false;
        return;
      }

      await this.actor.update({ [`system.skills.${skillKey}.isSignature`]: wantSig });
    });

    // Clamp skill numbers based on signature (3 or 5)
    html.find("[data-action='skill-number']").on("change", async (ev) => {
      ev.preventDefault();
      // See the identical comment on the "system.belongings.assets" handler
      // above — same double-render/focus-loss fix. Safe: this handler
      // saves the input's own name (system.skills.<key>.<field>) below.
      ev.stopImmediatePropagation();
      const input = ev.currentTarget;
      const skillKey = input?.dataset?.skill;
      const field = input?.dataset?.field; // expertise|focus
      if (!skillKey || !field) return;

      const skills = this.actor.system.skills ?? {};
      const sk = skills[skillKey];
      if (!sk) return;

      const isSig = !!sk.isSignature;
      const max = isSig ? 5 : 3;

      let val = Number(input.value ?? 0);
      if (!Number.isFinite(val)) val = 0;
      val = Math.max(0, Math.min(max, Math.trunc(val)));
      input.value = String(val);

      await this.actor.update({ [`system.skills.${skillKey}.${field}`]: val });
    });

    // Clamp attribute value (simple)
    html.find("[data-action='attr-change']").on("change", async (ev) => {
      ev.preventDefault();
      // See the identical comment on the "system.belongings.assets" handler
      // above — same double-render/focus-loss fix. Safe: this handler
      // saves the input's own name (system.attributes.<key>.value) below.
      ev.stopImmediatePropagation();
      const input = ev.currentTarget;
      const attrKey = input?.dataset?.attr;
      if (!attrKey) return;

      let val = Number(input.value ?? 0);
      if (!Number.isFinite(val)) val = 0;
      val = Math.max(0, Math.trunc(val));
      input.value = String(val);

      await this.actor.update({ [`system.attributes.${attrKey}.value`]: val });
    });

// ==============================
// PLAYER ROLL CLICKS
// ==============================

// Click on Attribute header (label only; ignore input clicks)
html.find(".mcde-attr-head").on("click", async (ev) => {
  // If user clicked an editable control inside the header, do not roll
  if (ev.target.closest("input, select, textarea, button, a, [contenteditable='true']")) return;

  const attrKey = ev.currentTarget.dataset.attr;
  if (!attrKey) return;

  await this._rollPlayer({ attributeKey: attrKey, allowSkillSelect: true });
});

// Click on Skill row
html.find(".mcde-skill-row").on("click", async (ev) => {
  // ignore clicks on inputs/checkbox
  if (ev.target.closest("input")) return;

  const row = ev.currentTarget;
  const attrKey = row.dataset.attr;
  const skillKey = row.dataset.skill;

  if (!attrKey || !skillKey) return;

  await this._rollPlayer({
    attributeKey: attrKey,
    skillKey
  });
});

  }

  async _rollPlayer({ attributeKey, skillKey = null, allowSkillSelect = false } = {}) {
  const actor = this.actor;

  const attr = actor.system.attributes?.[attributeKey];
  if (!attr) return;

  const attrValue = Number(attr.value ?? 0) || 0;

  let skillExp = 0;
  let skillFocus = 0;
  let skillLabel = "";

  if (skillKey) {
    const sk = actor.system.skills?.[skillKey];
    if (!sk) return;

    skillExp = Number(sk.expertise ?? 0) || 0;
    skillFocus = Number(sk.focus ?? 0) || 0;
    skillLabel = SKILL_LABELS[skillKey] ?? skillKey;
  }

  const tn = attrValue + skillExp;
  const focus = skillFocus;

  const chronicleCurrent = Number(actor.system.chronicle_points?.current ?? 0) || 0;

  // Optional: allow selecting ANY skill to combine with this attribute (talent/substitution friendly)
  const orderedSkills = Object.keys(SKILL_LABELS ?? {});
  const skillOptions = orderedSkills
    .filter(k => actor.system.skills?.[k])
    .map(k => `<option value="${k}">${foundry.utils.escapeHTML(SKILL_LABELS[k] ?? k)}</option>`)
    .join("");
  const skillSelectHtml = allowSkillSelect ? `
      <label style="display:flex; flex-direction:column; gap:4px;">
        <span style="font-size:12px; opacity:0.85;">Skill (optional)</span>
        <select name="skillKey">
          <option value="">— none —</option>
          ${skillOptions}
        </select>
      </label>
      <div style="opacity:0.75; font-size:12px;">
        Choose a skill to roll under <strong>${foundry.utils.escapeHTML(ATTR_LABELS[attributeKey] ?? attributeKey)}</strong> + that skill (Focus comes from the chosen skill).
      </div>
  ` : "";

  const content = `
    <form class="mcde-roll-dialog" style="display:flex; flex-direction:column; gap:8px;">
      <div>
        <div class="mcde-dialog-heading">
          ${foundry.utils.escapeHTML(ATTR_LABELS[attributeKey] ?? attributeKey)}
          ${skillKey ? ` + ${foundry.utils.escapeHTML(skillLabel)}` : ""}
        </div>
        <div class="mcde-dialog-subheading">
          TN <strong>${tn}</strong> | Focus <strong>${focus}</strong>
        </div>
      </div>

      ${skillSelectHtml}

      <hr/>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
        <div>
          <div class="mcde-dialog-section-title">Modifiers</div>

          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span>Buy extra d20 (1 DSP each, max 3)</span>
            <select name="extraDice">
              <option value="0" selected>0 (2d20)</option>
              <option value="1">1 (3d20)</option>
              <option value="2">2 (4d20)</option>
              <option value="3">3 (5d20)</option>
            </select>
          </label>

          <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
            <input type="checkbox" name="useChronicle" ${chronicleCurrent <= 0 ? "disabled" : ""}/>
            <span>Use Chronicle Point (adds AUTO-1 die)</span>
          </label>
          <div style="opacity:0.75; font-size:12px; margin-top:2px;">
            Available: <strong>${chronicleCurrent}</strong>
          </div>
        </div>

        <div>
          <div class="mcde-dialog-section-title">Difficulty</div>
          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span>Difficulty</span>
            <select name="difficulty">
              <option value="0">D0</option>
              <option value="1" selected>D1</option>
              <option value="2">D2</option>
              <option value="3">D3</option>
              <option value="4">D4</option>
              <option value="5">D5</option>
            </select>
          </label>
        </div>
      </div>

      <hr/>
      <div style="opacity:0.75; font-size:12px;">
        Difficulty = successes required to pass.
      </div>
    </form>
  `;

  mcdeDialogV2({
    title: "Player Test",
    content,
    width: 520,
    extraClasses: ["mcde-skilltest-dialog"],
    defaultAction: "roll",
    buttons: {
      roll: {
        label: "Roll",
        callback: async (root) => {
          const extraDice = clampInt(root.querySelector("[name='extraDice']")?.value, 0, 3);
          const useChronicle = !!root.querySelector("[name='useChronicle']")?.checked;
          const dRaw = Number(root.querySelector("[name='difficulty']")?.value);
          const difficulty = Number.isFinite(dRaw) ? dRaw : 1;

          // Base dice: 2d20 + extras (cappé à 5 AVANT chronicle, chronicle ajoute 1 die à part)
          const diceCount = clamp(2 + extraDice, 2, 5);

          // Spend Chronicle (si coché et dispo)
          if (useChronicle) {
            const cur = Number(actor.system.chronicle_points?.current ?? 0) || 0;
            if (cur <= 0) {
              ui.notifications?.warn?.("Not enough Chronicle Points.");
              return;
            }
            await actor.update({ "system.chronicle_points.current": cur - 1 });
          }

          // DSP pour les d20 achetés
          if (extraDice > 0) {
            const dspNow = await getDSP();
            await setDSP(dspNow + extraDice);
          }

          // If we came from an attribute click, allow choosing a skill to pair with it
          let finalTn = tn;
          let finalFocus = focus;
          let finalLabel = skillKey
            ? `${ATTR_LABELS[attributeKey]} + ${skillLabel}`
            : (ATTR_LABELS[attributeKey] ?? attributeKey);

          if (allowSkillSelect) {
            const chosen = String(root.querySelector("[name='skillKey']")?.value ?? "").trim();
            if (chosen) {
              const sk = actor.system.skills?.[chosen];
              if (sk) {
                const exp = Number(sk.expertise ?? 0) || 0;
                const foc = Number(sk.focus ?? 0) || 0;
                const lbl = SKILL_LABELS[chosen] ?? chosen;
                finalTn = attrValue + exp;
                finalFocus = foc;
                finalLabel = `${ATTR_LABELS[attributeKey] ?? attributeKey} + ${lbl}`;
              }
            }
          }

          await game.mcde.rollTest({
            actor,
            label: finalLabel,
            tn: finalTn,
            focus: finalFocus,
            diceCount,
            useChroniclePoint: useChronicle,
            difficulty
          });
        }
      },
      cancel: { label: "Cancel" }
    }
  });
}

}


/* =========================================================
   NPC Sheet
========================================================= */

class MCDENpcSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {

  // -----------------------------
  // Scroll preservation (NPC/Nemesis)
  // We scroll on ".sheet-body .tab.active" in this system.
  // Tabs are toggled manually (see #mcdeActivateTab in _onRender) rather
  // than via AppV2's static TABS system, to keep the existing single-file
  // template and minimize the diff during the AppV1 -> AppV2 conversion.
  // -----------------------------
  _mcdeActiveTab = "stats";

  _mcdeGetActiveTabKey() {
    return this._mcdeActiveTab ?? "stats";
  }

  _mcdeGetScrollEl(rootEl) {
    const root = rootEl ?? this.element ?? null;
    if (!root) return null;

    // Prefer the active tab by key (stable across renders)
    const activeKey = this._mcdeGetActiveTabKey();
    if (activeKey) {
      const byKey = root.querySelector(`.sheet-body .tab[data-tab="${CSS.escape(activeKey)}"]`);
      if (byKey) return byKey;
    }

    // Fallback: whatever Foundry marked active
    return root.querySelector(".sheet-body .tab.active");
  }

  _mcdeCaptureScroll() {
    try {
      const el = this._mcdeGetScrollEl();
      if (!el) return;
      this._mcdeScrollTop = el.scrollTop ?? 0;
    } catch (_) {}
  }

  _mcdeRestoreScroll() {
    try {
      const el = this._mcdeGetScrollEl();
      if (!el) return;
      if (typeof this._mcdeScrollTop === "number") el.scrollTop = this._mcdeScrollTop;
    } catch (_) {}
  }

  // Toggle which ".tab" is visible; re-applied on every render since
  // Handlebars regenerates the whole PART's markup from scratch each time.
  _mcdeActivateTab(tabId, root) {
    root = root ?? this.element;
    if (!root) return;
    this._mcdeActiveTab = tabId;
    root.querySelectorAll(".sheet-tabs [data-tab]").forEach(n => n.classList.toggle("active", n.dataset.tab === tabId));
    root.querySelectorAll(".sheet-body > .tab[data-tab]").forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mcde", "sheet", "actor", "npc", "themed", "theme-light"],
    position: { width: 900, height: 750 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: mcdeEditImageAction
    }
  };

  static PARTS = {
    form: { template: `systems/${SYSTEM_ID}/templates/actor/npc-sheet.html` }
  };

  get title() {
    return this.document.name;
  }

  async _preRender(context, options) {
    await super._preRender(context, options);
    this._mcdeCaptureScroll();
    this._mcdeSavedFocus = mcdeCaptureFocusedField(this.element);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.actor;

  const items = this.actor.items?.contents ?? Array.from(this.actor.items ?? []);
  const bySort = (arr) => arr.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  context.weaponsSorted = bySort(items.filter(i => i.type === "weapon"));
  context.talentsSorted = bySort(items.filter(i => i.type === "talent"));
    context.system = this.actor.system;
    context.owner = this.actor.isOwner;
    context.editable = this.isEditable;

    // Wounds boxes
    const total = Number(context.system.wounds?.total) || 0;
    const current = Number(context.system.wounds?.current) || 0;
    context.woundBoxes = Array.from({ length: total }, (_, i) => ({ index: i, filled: i < current }));

    // ProseMirror fields (display fallback only)
    if (context.system.notes === undefined || context.system.notes === null) context.system.notes = "";
    if (!context.system.darkSymmetrySpendsText || !String(context.system.darkSymmetrySpendsText).trim()) {
      const t = context.system.npcType || "trooper";
      context.system.darkSymmetrySpendsText = defaultDSPHtml(t);
    }

    // Enriched HTML for Foundry-native editor (read mode + hover button)
    context.enriched = context.enriched ?? {};
    context.enriched.notes = await foundry.applications.ux.TextEditor.implementation.enrichHTML(context.system.notes ?? "", {
      async: true,
      secrets: this.actor.isOwner,
      documents: true,
      relativeTo: this.actor
    });
    context.enriched.darkSymmetrySpendsText = await foundry.applications.ux.TextEditor.implementation.enrichHTML(context.system.darkSymmetrySpendsText ?? "", {
      async: true,
      secrets: this.actor.isOwner,
      documents: true,
      relativeTo: this.actor
    });

    // Expertise list
    const S = context.system.skills ?? {};
    context.expertiseList = [
      { key: "combat", label: "COMBAT", exp: S.combat?.expertise ?? 0, foc: S.combat?.focus ?? 0 },
      { key: "fortitude", label: "FORTITUDE", exp: S.fortitude?.expertise ?? 0, foc: S.fortitude?.focus ?? 0 },
      { key: "movement", label: "MOVEMENT", exp: S.movement?.expertise ?? 0, foc: S.movement?.focus ?? 0 },
      { key: "senses", label: "SENSES", exp: S.senses?.expertise ?? 0, foc: S.senses?.focus ?? 0 },
      { key: "social", label: "SOCIAL", exp: S.social?.expertise ?? 0, foc: S.social?.focus ?? 0 },
      { key: "technical", label: "TECHNICAL", exp: S.technical?.expertise ?? 0, foc: S.technical?.focus ?? 0 }
    ];

    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const root = this.element;

    // Listeners are rebound on every render — an AbortController guards
    // against stacking duplicate handlers across re-renders.
    this._mcdeRenderAbort?.abort();
    this._mcdeRenderAbort = new AbortController();
    const { signal } = this._mcdeRenderAbort;

    const initSorting = () => {
      enableMcdeItemSortingNative(this.actor, root, "ul.mcde-items",   "li.item[data-item-id]");
      enableMcdeItemSortingNative(this.actor, root, "ul.mcde-talents", "li.item[data-item-id]");
    };

    // Re-apply whichever tab was active before this render, and wire up
    // manual tab switching (see class-level comment on _mcdeActivateTab).
    this._mcdeActivateTab(this._mcdeActiveTab, root);
    root.querySelectorAll(".sheet-tabs [data-tab]").forEach((navBtn) => {
      navBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        this._mcdeActivateTab(navBtn.dataset.tab, root);
        setTimeout(initSorting, 0);
      }, { signal });
    });

  // Track scroll live on active tab
  const scrollEl = this._mcdeGetScrollEl(root);
  if (scrollEl) {
    scrollEl.addEventListener("scroll", () => {
      this._mcdeScrollTop = scrollEl.scrollTop ?? 0;
    }, { passive: true, signal });
  }
  this._mcdeRestoreScroll();
  mcdeRestoreFocusedField(root, this._mcdeSavedFocus);

  initSorting();

    // Seed DSP text once if empty (persist to actor)
    this._seedDSPIfEmpty().catch(console.error);

    // When NPC type changes: seed only if empty
    root.querySelector("select[name='system.npcType']")?.addEventListener("change", async (ev) => {
      await this._seedDSPIfEmpty(ev.currentTarget.value);
    }, { signal });

    // Wounds click fill/clear
    root.querySelectorAll(".wound-box").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        const index = Number(ev.currentTarget.dataset.index);
        const total = Number(this.actor.system.wounds?.total) || 0;
        let current = Number(this.actor.system.wounds?.current) || 0;

        if (index + 1 <= current) current = index;
        else current = index + 1;

        current = Math.max(0, Math.min(total, current));
        await this.actor.update({ "system.wounds.current": current });
      }, { signal });
    });

    // Clamp current when total changes
    root.querySelector("input[name='system.wounds.total']")?.addEventListener("change", async (ev) => {
      const total = Number(ev.currentTarget.value) || 0;
      const current = Number(this.actor.system.wounds?.current) || 0;
      if (current > total) await this.actor.update({ "system.wounds.current": total });
    }, { signal });

    // ----------------------
    // Click-to-roll labels (attributes / npc skills / weapons)
    // ----------------------
    root.querySelectorAll(".mcde-roll").forEach((rollEl) => {
      rollEl.addEventListener("click", async (ev) => {

        // Don't roll when the user clicks an editable field
        const t = ev.target;
        if (t.closest("input, select, textarea, [contenteditable='true']")) return;

        ev.preventDefault();
        const el = ev.currentTarget;
        const rollType = el.dataset.roll;

        if (rollType === "attribute") {
          await this._rollNpcWithDSP({ attributeKey: el.dataset.attribute });
          return;
        }

        if (rollType === "npc-skill") {
          await this._rollNpcWithDSP({ skillKey: el.dataset.skill });
          return;
        }

        // Weapon click = open Attack dialog (NPC/Nemesis) -> roll TEST -> Roll Damage button
        if (rollType === "weapon") {
          const itemId = el.dataset.itemId;
          const weapon = this.actor.items.get(itemId);
          if (!weapon) return;
          await openNpcWeaponAttackDialog.call(this, weapon);
          return;
        }
      }, { signal });
    });

    // ---------------------------------------------------------
    // NPC/Nemesis Weapon Attack Dialog (like PCs, but NPC dice rules + Let Rip costs DSP)
    // ---------------------------------------------------------
    async function openNpcWeaponAttackDialog(weapon) {
      const actor = this.actor;

      const npcType = String(actor.system?.npcType ?? "trooper");
      const isTrooper = npcType === "trooper";
      const isHorde = (npcType === "horde_squad" || npcType === "horde");
      const isNemesis = (npcType === "nemesis"); // your NPC sheet uses npcType; nemesis sheet extends npc sheet

      // Base dice by type
      const baseDice = isTrooper ? 1 : 2;   // Trooper 1d20, others 2d20
      const hardMaxFree = 5;                // Hordes/Squads can reach 5 for free
      const paidExtraMax = 3;               // Everyone can buy up to +3 with DSP
      const maxTotalDice = isHorde ? (hardMaxFree + paidExtraMax) : 5; // 8 for hordes, else 5
      const freeExtraMax = isHorde ? Math.max(0, hardMaxFree - baseDice) : 0;

      const dspCurrent = await getDSP();

       // Weapon info (grouped like PCs: ranged/heavy/mounted vs melee/unarmed)
      const wt = String(weapon.system?.weaponType ?? "ranged").toLowerCase();
      const RULES = {
        melee:   { dmgBonus: "melee"  },
        unarmed: { dmgBonus: "melee"  },
        ranged:  { dmgBonus: "ranged" },
        heavy:   { dmgBonus: "ranged" },
        mounted: { dmgBonus: "ranged" }
      };
      const rule = RULES[wt] ?? RULES.ranged;
      const isRangedGroup = rule.dmgBonus === "ranged";
      const wName = weapon.name ?? "Weapon";
      const wRange = String(weapon.system?.stats?.range ?? "");
      const wMode = String(weapon.system?.stats?.mode ?? "");
      const qualities = Array.isArray(weapon.system?.qualities) ? weapon.system.qualities : [];

      // Traits chips
      const traitsHtml = qualities.length
        ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
            ${qualities.map(q => {
              const n = String(q?.name ?? "Trait");
              const d = String(q?.description ?? "");
              return `<span style="padding:2px 6px; border:1px solid rgba(0,90,60,0.5); border-radius:10px; font-size:11px;"
                            title="${foundry.utils.escapeHTML(d)}">${foundry.utils.escapeHTML(n)}</span>`;
            }).join("")}
          </div>`
        : `<div style="opacity:0.65; margin-top:6px;"><small>No traits.</small></div>`;

      // Let Rip rules (same as PCs) — but no reload display, and costs DSP
      const canLetRip = isRangedGroup && wMode && wMode.toLowerCase() !== "munition";
      const letRipMax =
        !canLetRip ? 0 :
        (wMode.toLowerCase() === "semi-automatic" ? 1 :
         wMode.toLowerCase() === "burst" ? 2 :
         wMode.toLowerCase() === "automatic" ? 3 : 0);

         // Optional: allow players to push Let Rip beyond weapon mode (talent/GM allowance)
  const overRipHtml = (!canLetRip || letRipMax <= 0) ? "" : `
    <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
      <input type="checkbox" name="overRip" />
      <span>Over Rip (+1 max Let Rip)</span>
    </label>
  `;

      const bulletSrcFull  = "systems/mutant-chronicles-diesel-edition/assets/sheet/reloadfull.png";
      const bulletSrcEmpty = "systems/mutant-chronicles-diesel-edition/assets/sheet/reloadempty.png";

      const letRipHtml = (!canLetRip || letRipMax <= 0) ? "" : `
        <hr/>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div>
            <div class="mcde-dialog-section-title" style="margin-bottom:0;">Let Rip</div>
            <div style="opacity:0.75; font-size:12px;">Spend DSP to add bullets (max ${letRipMax}).</div>
          </div>
          <div class="mcde-let-rip" data-max="${letRipMax}" data-selected="0" style="display:flex; gap:6px; align-items:center;">
            ${Array.from({length: letRipMax}).map((_, i) => {
              const v = i+1;
              return `<img class="mcde-let-rip-bullet"
                           data-value="${v}"
                           src="${bulletSrcEmpty}"
                           style="width:12px; height:auto; cursor:pointer; opacity:0.9;" />`;
            }).join("")}
          </div>
        </div>
        <input type="hidden" name="letRip" value="0"/>
      `;

      const content = `
        <form class="mcde-attack-dialog" style="display:flex; flex-direction:column; gap:8px;">
          <div>
            <div class="mcde-dialog-heading">${foundry.utils.escapeHTML(wName)}</div>
            <div class="mcde-dialog-subheading">
              Attack Type: <strong>${isRangedGroup ? "Ranged" : "Melee"}</strong>
              ${isRangedGroup ? ` | Range: <strong>${foundry.utils.escapeHTML(wRange)}</strong> | Firing Mode: <strong>${foundry.utils.escapeHTML(wMode)}</strong>` : ``}
            </div>
            ${traitsHtml}
          </div>

          <hr/>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div>
              <div class="mcde-dialog-section-title">Dice</div>

              ${isHorde ? `
              <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <span>Free extra d20 (Horde/Squad)</span>
                <select name="freeExtra">
                  ${Array.from({ length: freeExtraMax + 1 }, (_, i) => {
                    const total = baseDice + i;
                    return `<option value="${i}">${i} (Total ${total}d20)</option>`;
                  }).join("")}
                </select>
              </label>
              ` : ``}

              <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:6px;">
                <span>Buy extra d20 (1 DSP each, max ${paidExtraMax})</span>
                <select name="paidExtra">
                  ${Array.from({ length: paidExtraMax + 1 }, (_, i) => `<option value="${i}">${i}</option>`).join("")}
                </select>
              </label>
              ${isNemesis ? `
                <label style="display:flex; align-items:center; gap:8px; margin-top:8px;">
                  <input type="checkbox" name="autoOne"/>
                  <span>Nemesis: AUTO-1 die (cost 3 DSP)</span>
                </label>
              ` : ``}

              <div style="opacity:0.75; font-size:12px; margin-top:6px;">
                Base: <strong>${baseDice}d20</strong>
                | Max total: <strong>${maxTotalDice}d20</strong>
                | DSP Pool: <strong>${dspCurrent}</strong>
              </div>
            </div>

            <div>
              <div class="mcde-dialog-section-title">TN / Difficulty</div>

              <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <span>Attribute for TN</span>
                <select name="attrKey">
                  <option value="strength">Strength</option>
                  <option value="physique">Physique</option>
                  <option value="agility">Agility</option>
                  <option value="awareness" selected>Awareness</option>
                  <option value="coordination">Coordination</option>
                  <option value="intelligence">Intelligence</option>
                  <option value="mental_strength">Mental Strength</option>
                  <option value="personality">Personality</option>
                </select>
              </label>

              <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:6px;">
                <span>Difficulty</span>
                <select name="difficulty">
                  <option value="1" selected>D1</option>
                  <option value="2">D2</option>
                  <option value="3">D3</option>
                  <option value="4">D4</option>
                  <option value="5">D5</option>
                </select>
              </label>
            </div>
          </div>

          ${letRipHtml}
        </form>
      `;

      mcdeDialogV2({
        title: `Attack — ${wName}`,
        content,
        width: 560,
        extraClasses: ["mcde-attack-dialog"],
        defaultAction: "roll",
        buttons: {
          roll: {
            label: "Roll Attack",
            callback: async (root) => {
              const freeExtra = isHorde
                ? clampInt(root.querySelector("[name='freeExtra']")?.value, 0, freeExtraMax)
                : 0;
              const paidExtra = clampInt(root.querySelector("[name='paidExtra']")?.value, 0, paidExtraMax);
              const letRip = clampInt(root.querySelector("[name='letRip']")?.value, 0, letRipMax);
              const autoOne = isNemesis && !!root.querySelector("[name='autoOne']")?.checked;
              const difficulty = clampInt(root.querySelector("[name='difficulty']")?.value, 1, 5);
              const attrKey = String(root.querySelector("[name='attrKey']")?.value ?? "awareness");

              // Costs: paidExtra + letRip (both spend DSP) + nemesis autoOne(3)
              const costExtra = paidExtra;
              const costLetRip = letRip;
              const costAuto = autoOne ? 3 : 0;
              const totalCost = costExtra + costLetRip + costAuto;

              // GM-only only if spending DSP
              if (totalCost > 0 && !game.user.isGM) {
                ui.notifications?.warn?.("Only the GM can spend Dark Symmetry Pool.");
                return;
              }

              if (totalCost > 0) {
                const dspNow = await getDSP();
                if (dspNow < totalCost) {
                  ui.notifications?.warn?.(`Not enough Dark Symmetry Pool (need ${totalCost}, have ${dspNow}).`);
                  return;
                }
                await setDSP(dspNow - totalCost);
              }

              // TN / Focus: use chosen attribute + NPC combat expertise/focus by default
              const attrVal = Number(actor.system?.attributes?.[attrKey]?.value ?? 0) || 0;
              const combatExp = Number(actor.system?.skills?.combat?.expertise ?? 0) || 0;
              const combatFocus = Number(actor.system?.skills?.combat?.focus ?? 0) || 0;
              const tn = attrVal + combatExp;
              const focus = combatFocus;

              // Dice count BEFORE chronicle/auto-one (rollTest adds the AUTO-1 die)
              // Let Rip adds d20 too.
              let diceCount = baseDice + freeExtra + paidExtra + letRip;

              // Keep total dice (including AUTO-1) within cap
              const capBeforeAuto = Math.max(1, maxTotalDice - (autoOne ? 1 : 0));
              diceCount = clampInt(diceCount, 1, capBeforeAuto);

              // Damage payload (Let Rip + damage bonus add DSD dice, not flat)
              const mode = isRangedGroup ? "ranged" : "melee";
              const dmgBonus = getDamageBonus(actor, mode); // bonus EN DÉS (DSD)

              const flatBonus =
                (Number(weapon.system?.damage?.base ?? 0) || 0) +
                (Number(weapon.system?.damage?.flatBonus ?? 0) || 0);

              const dsdCount =
                (Number(weapon.system?.damage?.dsy ?? 0) || 0) +
                (Number(dmgBonus) || 0) +
                (letRip > 0 ? letRip : 0);
// ---- Munition mode (NPC): costs 1 DSP per attack
 if (weapon.system?.stats?.mode === "Munition") {
   const dspNow = await getDSP();
   if (dspNow < 1) {
     ui.notifications.warn("Not enough Dark Symmetry Pool for Munition attack.");
     return;
   }
   await setDSP(dspNow - 1);
 }

              await game.mcde.rollTest({
                actor,
                label: `${wName} Attack`,
                tn,
                focus,
                diceCount,
                useChroniclePoint: autoOne, // Nemesis AUTO-1
                autoSuccesses: Number(actor.system?.attributes?.[attrKey]?.auto ?? 0) || 0,
                difficulty,
                attackData: {
                  weaponId: weapon.id,
                  weaponName: wName,
                  mode,
                  dsdCount,
                  flatBonus,
  qualities: (Array.isArray(weapon.system?.qualities) ? weapon.system.qualities : []).map(q => ({
    name: String(q?.name ?? "").trim(),
    description: String(q?.description ?? "").trim()
  })).filter(q => q.name)
                }
              });
            }
          },
          cancel: { label: "Cancel" }
        },
        render: (root) => {
          // Let Rip bullet UI (same as PCs)
          const wrap = root.querySelector(".mcde-let-rip");
          if (!wrap) return;
          const max = Number(wrap.dataset.max ?? 0) || 0;
          const hidden = root.querySelector("[name='letRip']");

          const setSelected = (n) => {
            n = Math.max(0, Math.min(max, n));
            wrap.setAttribute("data-selected", String(n));
            if (hidden) hidden.value = String(n);
            const imgs = wrap.querySelectorAll(".mcde-let-rip-bullet");
            imgs.forEach((el) => {
              const v = Number(el.dataset.value ?? 0) || 0;
              el.src = (v > 0 && v <= n) ? bulletSrcFull : bulletSrcEmpty;
            });
          };

          setSelected(0);
          wrap.addEventListener("click", (ev) => {
            const bullet = ev.target.closest(".mcde-let-rip-bullet");
            if (!bullet) return;
            const v = Number(bullet.dataset.value ?? 0) || 0;
            const cur = Number(hidden?.value ?? 0) || 0;
            const next = (v <= cur) ? (v - 1) : v;
            setSelected(next);
          });
        }
      });
    }

    // ----------------------
    // Attributes: "(+)" -> set auto=1
    // ----------------------
    root.addEventListener("click", async (ev) => {
      const target = ev.target.closest(".mcde-attr-auto-add");
      if (!target) return;
      ev.preventDefault();
      ev.stopPropagation();

      const wrap = target.closest(".mcde-attrline");
      const attrKey = wrap?.dataset?.attr;
      if (!attrKey) return;

      await this.actor.update({ [`system.attributes.${attrKey}.auto`]: 1 });
    }, { signal });

// ----------------------
// Weapons: Add / Edit / Delete
// ----------------------
root.querySelector(".mcde-weapon-add")?.addEventListener("click", async (ev) => {
  ev.preventDefault();

  const [created] = await this.actor.createEmbeddedDocuments("Item", [{
    name: "New Weapon",
    type: "weapon",
    system: {
      weaponType: "ranged",
      restriction: 0,
      cost: 0,
      stats: { range: "Close", mode: "Semi-Automatic", enc: "0", size: "-", reliability: 0 },
      damage: { base: 1, dsy: 0, flatBonus: 0 },
      reload: { current: 0, max: 0 },
      qualities: [],
      description: ""
    }
  }]);

  if (created) created.sheet.render(true);
}, { signal });

root.querySelectorAll(".mcde-weapon-edit").forEach((el) => el.addEventListener("click", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const li = ev.currentTarget.closest(".mcde-weapon");
  const itemId = li?.dataset?.itemId;
  const item = this.actor.items.get(itemId);
  if (!item) return;

  item.sheet.render(true);
}, { signal }));

root.querySelectorAll(".mcde-weapon-delete").forEach((el) => el.addEventListener("click", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const li = ev.currentTarget.closest(".mcde-weapon");
  const itemId = li?.dataset?.itemId;
  const item = this.actor.items.get(itemId);
  if (!item) return;

  await item.delete();
}, { signal }));

// ----------------------
// Weapons: Drop Quality onto a weapon row
// ----------------------
root.querySelectorAll(".mcde-weapon").forEach((el) => {
  el.addEventListener("dragover", (ev) => ev.preventDefault(), { signal });

  el.addEventListener("drop", async (ev) => {
    ev.preventDefault();

    const weaponId = ev.currentTarget.dataset.itemId;
    const weapon = this.actor.items.get(weaponId);
    if (!weapon) return;

    let data;
    try {
      data = JSON.parse(ev.dataTransfer?.getData("text/plain") ?? "{}");
    } catch {
      return;
    }

    // Owned item dropped from the same actor
    if (data?.type === "Item" && data?.id) {
      const dropped = this.actor.items.get(data.id);
      if (!dropped || dropped.type !== "quality") return;
      await this._addQualityToWeapon(weapon, dropped);
      return;
    }

    // UUID dropped (compendium/sidebar/another actor)
    if (data?.uuid) {
      const doc = await fromUuid(data.uuid);
      if (!doc || doc.type !== "quality") return;
      await this._addQualityToWeapon(weapon, doc);
    }
  }, { signal });
});


        // ----------------------
    // Talents (Special Abilities): Add / Edit / Delete / Drop
    // ----------------------
    root.querySelector(".mcde-talent-add")?.addEventListener("click", async (ev) => {
      ev.preventDefault();

      const [created] = await this.actor.createEmbeddedDocuments("Item", [{
        name: "New Talent",
        type: "talent",
        system: {
          tier: 1,
          category: "",
          prerequisite: "",
          passive: false,
          description: "",
          notes: ""
        }
      }]);

      if (created) created.sheet.render(true);
    }, { signal });

    root.querySelectorAll(".mcde-talent-edit").forEach((el) => el.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = ev.currentTarget.closest(".mcde-talent");
      const itemId = li?.dataset?.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;
      item.sheet.render(true);
    }, { signal }));

    root.querySelectorAll(".mcde-talent-delete").forEach((el) => el.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = ev.currentTarget.closest(".mcde-talent");
      const itemId = li?.dataset?.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;
      await item.delete();
    }, { signal }));

    // Dropzone: accept a Talent item drop
    const tz = root.querySelector(".mcde-talent-dropzone");
    if (tz) {
      tz.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
          }, { signal });
      tz.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();                 // <-- IMPORTANT
        ev.stopImmediatePropagation?.();      // <-- encore mieux si dispo

        let data;
        try {
          data = JSON.parse(ev.dataTransfer?.getData("text/plain") ?? "{}");
        } catch {
          return;
        }

        // UUID (compendium / sidebar / another actor)
        if (!data?.uuid) return;
        const doc = await fromUuid(data.uuid);
        if (!doc || doc.type !== "talent") return;

        // prevent duplicates by UUID first, then by name as fallback
        const uuid = doc.uuid ?? "";
        const already = this.actor.items.some(i =>
          i.type === "talent" &&
          ((uuid && i.flags?.[SYSTEM_ID]?.sourceUuid === uuid) || i.name === doc.name)
        );
        if (already) return;

        await this.actor.createEmbeddedDocuments("Item", [{
          name: doc.name,
          type: "talent",
          img: doc.img,
          system: foundry.utils.duplicate(doc.system ?? {}),
          flags: { [SYSTEM_ID]: { sourceUuid: uuid } }
        }]);
      });
    }

  }


  async _addQualityToWeapon(weapon, qualityDoc) {
    const qualities = Array.isArray(weapon.system?.qualities) ? [...weapon.system.qualities] : [];

    const uuid = qualityDoc.uuid ?? "";
    if (uuid && qualities.some(q => q.uuid === uuid)) return;

    const desc = qualityDoc.system?.description ?? qualityDoc.system?.notes ?? "";
    qualities.push({
      uuid,
      name: qualityDoc.name,
      description: String(desc ?? "")
    });

    await weapon.update({ "system.qualities": qualities });
  }

  // never overwrite user edits; only seed when empty
  async _seedDSPIfEmpty(forcedType = null) {
    const cur = this.actor.system.darkSymmetrySpendsText;
    if (cur && String(cur).trim()) return;

    const t = forcedType ?? this.actor.system.npcType ?? "trooper";
    await this.actor.update({ "system.darkSymmetrySpendsText": defaultDSPHtml(t) });
  }

  async _rollNpcWithDSP({ skillKey = null, attributeKey = null } = {}) {
    const actor = this.actor;
    const isNemesis = (actor.system.npcType === "nemesis");

    const npcType = String(actor.system?.npcType ?? "trooper");
    const isTrooper = npcType === "trooper";
    const isHorde = (npcType === "horde_squad" || npcType === "horde");

    const baseDice = isTrooper ? 1 : 2;
    const maxDice = 5;           // cap "normal" (non-horde)
    const hardMaxFree = 5;       // horde free cap
    const paidExtraMax = 3;      // buy up to +3 with DSP

    // Hordes: up to +3 dice free (2 -> 5) without DSP
    const freeExtraMax = isHorde ? Math.max(0, hardMaxFree - baseDice) : 0;  // usually 3
    const hardMaxTotal = isHorde ? (hardMaxFree + paidExtraMax) : maxDice;   // 8 for hordes, else 5

  const defaultAttr = attributeKey ?? "awareness";
  const dspCurrent = await getDSP();


    const title = skillKey
      ? `NPC Test: ${String(skillKey).toUpperCase()}`
      : `NPC Test: ${String(attributeKey).toUpperCase()}`;

    const content = `
      <form class="mcde-roll-dialog" style="display:flex; flex-direction:column; gap:8px;">
        <div class="mcde-dialog-subheading">Dark Symmetry Pool: <strong>${dspCurrent}</strong></div>

        <div class="mcde-dialog-section-title">Dice</div>

        ${isHorde ? `
        <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <span>Horde/Squad free extra d20</span>
          <select name="freeExtra">
            ${Array.from({ length: freeExtraMax + 1 }, (_, i) => {
              const total = baseDice + i;
              return `<option value="${i}">${i} (Total ${total}d20)</option>`;
            }).join("")}
          </select>
        </label>
        ` : ``}

        <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <span>Buy extra d20 (1 DSP each, max ${paidExtraMax})</span>
          <select name="paidExtra">
            ${Array.from({ length: paidExtraMax + 1 }, (_, i) => `<option value="${i}">${i}</option>`).join("")}
          </select>
        </label>

        <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <span>Attribute for TN</span>
          <select name="attrKey">
            <option value="strength">Strength</option>
            <option value="physique">Physique</option>
            <option value="agility">Agility</option>
            <option value="awareness">Awareness</option>
            <option value="coordination">Coordination</option>
            <option value="intelligence">Intelligence</option>
            <option value="mental_strength">Mental Strength</option>
            <option value="personality">Personality</option>
          </select>
        </label>

        ${isNemesis ? `
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="autoOne"/>
            <span>Nemesis: AUTO-1 die (cost 3 DSP)</span>
          </label>
        ` : ``}

        <hr/>
        <div style="opacity:0.75; font-size:12px;">
          Base: <strong>${baseDice}d20</strong> | Max total: <strong>${hardMaxTotal}d20</strong>
        </div>
      </form>
    `;

    mcdeDialogV2({
      title,
      content,
      width: 520,
      extraClasses: ["mcde-npcskilltest-dialog"],
      defaultAction: "roll",
      buttons: {
        roll: {
          label: "Roll",
          callback: async (root) => {
            const freeExtra = isHorde
              ? clampInt(root.querySelector("[name='freeExtra']")?.value, 0, freeExtraMax)
              : 0;

            const paidExtra = clampInt(root.querySelector("[name='paidExtra']")?.value, 0, paidExtraMax);
            const attrKey = root.querySelector("[name='attrKey']")?.value || defaultAttr;
            const autoOne = isNemesis && !!root.querySelector("[name='autoOne']")?.checked;

            const costExtra = paidExtra; // only paid dice cost DSP
            const costAuto = autoOne ? 3 : 0;
            const totalCost = costExtra + costAuto;

            // GM-only only if we spend DSP
            if (totalCost > 0 && !game.user.isGM) {
              ui.notifications.warn("Only the GM can spend Dark Symmetry Pool.");
              return;
            }

            if (totalCost > 0) {
              const dspNow = await getDSP();
              if (dspNow < totalCost) {
                ui.notifications.warn(`Not enough Dark Symmetry Pool (need ${totalCost}, have ${dspNow}).`);
                return;
              }
              await setDSP(dspNow - totalCost);
            }

            const attrVal = Number(actor.system.attributes?.[attrKey]?.value) || 0;
            const auto = Number(actor.system.attributes?.[attrKey]?.auto ?? 0) || 0;
            const skillExp = skillKey ? (Number(actor.system.skills?.[skillKey]?.expertise) || 0) : 0;
            const focus = skillKey ? (Number(actor.system.skills?.[skillKey]?.focus) || 0) : 0;
            const tn = attrVal + skillExp;

            let diceCount = baseDice + freeExtra + paidExtra + (autoOne ? 1 : 0);
            diceCount = clamp(diceCount, baseDice, hardMaxTotal);

            await game.mcde.rollTest({
              actor,
              label: skillKey ? `NPC ${String(skillKey).toUpperCase()}` : `NPC ${String(attrKey).toUpperCase()}`,
              tn,
              focus,
              diceCount,
              useChroniclePoint: autoOne,
              autoSuccesses: auto
            });
          }
        },
        cancel: { label: "Cancel" }
      },
      render: (root) => {
        const attrSel = root.querySelector("[name='attrKey']");
        if (attrSel) attrSel.value = defaultAttr;
        if (isHorde) {
          const freeSel = root.querySelector("[name='freeExtra']");
          if (freeSel) freeSel.value = "0";
        }
        const paidSel = root.querySelector("[name='paidExtra']");
        if (paidSel) paidSel.value = "0";
      }
    });
  }
}

/* =========================================================
   NEMESIS Sheet (Actor type: npc)
========================================================= */
class MCDENemesisSheet extends MCDENpcSheet {
  // -----------------------------
  // Scroll preservation (NPC/Nemesis)
  // _mcdeGetActiveTabKey / _mcdeGetScrollEl are inherited unchanged from
  // MCDENpcSheet; only the capture/restore strategy differs here (a
  // per-tab scroll dictionary instead of a single remembered value).
  // -----------------------------
  _mcdeCaptureScroll() {
    const el = this._mcdeGetScrollEl();
    if (!el) return;
    const key = this._mcdeGetActiveTabKey() ?? "active";
    this._mcdeScrollByTab ??= {};
    this._mcdeScrollByTab[key] = el.scrollTop ?? 0;
  }

  _mcdeRestoreScroll() {
    const el = this._mcdeGetScrollEl();
    if (!el) return;
    const key = this._mcdeGetActiveTabKey() ?? "active";
    const y = Number(this._mcdeScrollByTab?.[key] ?? 0) || 0;

    // Restore after layout settles (Foundry + ProseMirror can shift heights)
    requestAnimationFrame(() => {
      el.scrollTop = y;
      setTimeout(() => { el.scrollTop = y; }, 0);
    });
  }

  _mcdeBindScroll(root) {
    root = root ?? this.element;
    const el = this._mcdeGetScrollEl(root);
    if (!el) return;

    // Unbind previous
    if (this._mcdeScrollEl && this._mcdeScrollHandler) {
      try { this._mcdeScrollEl.removeEventListener("scroll", this._mcdeScrollHandler); } catch (e) {}
    }
    this._mcdeScrollEl = el;

    const key = this._mcdeGetActiveTabKey() ?? "active";
    this._mcdeScrollByTab ??= {};
    this._mcdeScrollHandler = () => {
      this._mcdeScrollByTab[key] = el.scrollTop ?? 0;
    };
    el.addEventListener("scroll", this._mcdeScrollHandler, { passive: true });
  }

  // _preRender/_onRender (inherited from MCDENpcSheet) already call
  // this._mcdeCaptureScroll()/this._mcdeRestoreScroll() polymorphically —
  // no need to override the render lifecycle again here.

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mcde", "sheet", "actor", "nemesis", "themed", "theme-light"],
    position: { width: 900, height: 750 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: mcdeEditImageAction
    }
  };

  static PARTS = {
    form: { template: `systems/${SYSTEM_ID}/templates/actor/nemesis-sheet.html` }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    // Type actor = nemesis, mais on garde npcType pour tes logiques existantes
    context.system.npcType = "nemesis";
    const safeArr = (v) => Array.isArray(v) ? v : [];
const combat = context.system.combat ?? {};

const serious = safeArr(combat.seriousWounds);
const critical = safeArr(combat.criticalWounds);
const mental = safeArr(combat.mentalWounds);

context.woundTracks = {
  serious:  { boxes: serious,  max: serious.length },
  critical: { boxes: critical, max: critical.length },
  mental:   { boxes: mental,   max: mental.length }
};
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    const { signal } = this._mcdeRenderAbort;

    // Track scroll on the active tab (NPC/Nemesis)
    this._mcdeBindScroll(root);

// --- Hit Locations coloring (manual current/max) ---
const applyLocColors = () => {
  if (!root?.querySelectorAll) return;

  const wraps = root.querySelectorAll(".mcde-loc-wounds");

  wraps.forEach((wrap) => {
    const frame = wrap.closest(".mcde-loc-frame");
    if (!frame) return;

    const curEl = wrap.querySelector(".mcde-loc-current");
    const maxEl = wrap.querySelector(".mcde-loc-max");

    const cur = Number(curEl?.value ?? 0);
    const max = Math.max(1, Number(maxEl?.value ?? 0));
    const ratio = cur / max;

    frame.classList.remove("mcde-wound-ok", "mcde-wound-half", "mcde-wound-crit");

    if (ratio >= 0.75) frame.classList.add("mcde-wound-crit");
    else if (ratio >= 0.5) frame.classList.add("mcde-wound-half");
    else frame.classList.add("mcde-wound-ok");
  });
};

// Apply once on render
applyLocColors();

// Re-apply on user edits
root.addEventListener("input", (ev) => {
  if (!ev.target.closest(".mcde-loc-current, .mcde-loc-max")) return;
  applyLocColors();
}, { signal });
    const trackPath = (track) => `system.combat.${track}`;

const resizeTrack = async (track, newMax) => {
  const cur = Array.isArray(this.actor.system.combat?.[track]) ? [...this.actor.system.combat[track]] : [];
  const max = Math.max(0, Number(newMax) || 0);

  // resize en gardant l’existant
  const next = cur.slice(0, max);
  while (next.length < max) next.push(false);

  await this.actor.update({ [trackPath(track)]: next });
};

const setProgress = async (track, index) => {
  const cur = Array.isArray(this.actor.system.combat?.[track]) ? [...this.actor.system.combat[track]] : [];
  if (index < 0 || index >= cur.length) return;

  const clickedIsFilled = !!cur[index];

  let next = cur.slice();

  if (!clickedIsFilled) {
    // Fill all up to index
    for (let i = 0; i <= index; i++) next[i] = true;
  } else {
    // Clear from index to end
    for (let i = index; i < next.length; i++) next[i] = false;
  }

  await this.actor.update({ [`system.combat.${track}`]: next });
};

// Input = nombre de cases (manuel)
root.addEventListener("change", async (ev) => {
  const target = ev.target.closest(".mcde-wound-group .mcde-wound-max");
  if (!target) return;
  const group = target.closest(".mcde-wound-group");
  const track = group?.dataset?.track;
  if (!track) return;
  await resizeTrack(track, target.value);
}, { signal });

// Click = toggle case
root.addEventListener("click", async (ev) => {
  const box = ev.target.closest(".mcde-wound-group .mcde-wound-box");
  if (!box) return;
  const group = box.closest(".mcde-wound-group");
  const track = group?.dataset?.track;
  if (!track) return;

  const index = Number(box.dataset.index);
  await setProgress(track, index);
}, { signal });

  }
}

/* =========================================================
   ARMOR Sheet
========================================================= */

class MCDEArmorSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mcde", "sheet", "item", "armor", "themed", "theme-light"],
    position: { width: 560, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: mcdeEditImageAction
    }
  };

  static PARTS = {
    form: { template: `systems/${SYSTEM_ID}/templates/item/armor-sheet.html` }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system ?? {};

    // Embedded items: ownership from parent actor
    const parentOwner = this.item.parent?.isOwner;
    context.owner = (parentOwner !== undefined) ? parentOwner : this.item.isOwner;
    context.editable = this.isEditable;

    // Defaults
    context.system.faction ??= "";
    context.system.tags = Array.isArray(context.system.tags) ? context.system.tags : [];
    context.system.soak ??= { head: 0, torso: 0, left_arm: 0, right_arm: 0, legs: 0 };
    context.system.soak.head      = Number(context.system.soak.head ?? 0) || 0;
    context.system.soak.torso     = Number(context.system.soak.torso ?? 0) || 0;
    context.system.soak.left_arm  = Number(context.system.soak.left_arm ?? 0) || 0;
    context.system.soak.right_arm = Number(context.system.soak.right_arm ?? 0) || 0;
    context.system.soak.legs      = Number(context.system.soak.legs ?? 0) || 0;
    context.system.encumbrance ??= "";
    context.system.restriction ??= "";
    context.system.cost ??= "";
    context.system.description ??= "";

    // UI helper: tags as CSV
    context.tagsCsv = context.system.tags.join(", ");

    // Enriched HTML for editor rendering
    context.enriched = context.enriched ?? {};
    context.enriched.description = await foundry.applications.ux.TextEditor.implementation.enrichHTML(String(context.system.description ?? ""), {
      secrets: context.owner,
      documents: true,
      relativeTo: this.item.parent ?? this.item
    });

    return context;
  }

  async _preRender(context, options) {
    await super._preRender(context, options);
    this._mcdeSavedFocus = mcdeCaptureFocusedField(this.element);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    mcdeRestoreFocusedField(this.element, this._mcdeSavedFocus);

    // Listeners are rebound on every render — an AbortController guards
    // against stacking duplicate handlers across re-renders.
    this._mcdeRenderAbort?.abort();
    this._mcdeRenderAbort = new AbortController();
    const { signal } = this._mcdeRenderAbort;

    // Convert tags CSV -> array on change
    const input = this.element.querySelector('input[name="system.tagsCsv"]');
    input?.addEventListener("change", async (ev) => {
      const raw = String(ev.currentTarget.value ?? "");
      const tags = raw
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      await this.item.update({ "system.tags": tags });
    }, { signal });
  }
}


/* =========================================================
   QUALITY Sheet
========================================================= */

class MCDEQualitySheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mcde", "sheet", "item", "quality", "themed", "theme-light"],
    position: { width: 520, height: 520 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: mcdeEditImageAction
    }
  };

  static PARTS = {
    form: { template: `systems/${SYSTEM_ID}/templates/item/quality-sheet.html` }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system ?? {};
    context.owner = this.item.isOwner;
    context.editable = this.isEditable;

    if (context.system.description === undefined || context.system.description === null) {
      context.system.description = "";
    }

    // Foundry expects enriched HTML for editor rendering
    context.enriched = context.enriched ?? {};
    const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(String(context.system.description ?? ""), {
      secrets: context.owner,
      documents: true,
      relativeTo: this.item.parent ?? this.item
    });

    context.enriched.description = Handlebars.helpers.dsify
    ? Handlebars.helpers.dsify(enriched)
    : enriched;

    return context;
  }
}

/* =========================================================
   TALENT Sheet
========================================================= */

class MCDETalentSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mcde", "sheet", "item", "talent", "themed", "theme-light"],
    position: { width: 520, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: mcdeEditImageAction
    }
  };

  static PARTS = {
    form: { template: `systems/${SYSTEM_ID}/templates/item/talent-sheet.html` }
  };

  get title() {
    return this.document.name;
  }

async _prepareContext(options) {
  const context = await super._prepareContext(options);
  context.item = this.item;
  context.system = this.item.system ?? {};

  // Owner: embedded items inherit from parent actor
  const parentOwner = this.item.parent?.isOwner;
  context.owner = (parentOwner !== undefined) ? parentOwner : this.item.isOwner;

  // Editable: don't trust this.isEditable for embedded-on-first-render
  context.editable = !!(context.owner || game.user.isGM);

  // Defaults
  context.system.tier ??= 1;
  context.system.category ??= "";
  context.system.prerequisite ??= "";
  context.system.passive ??= false;
  context.system.description ??= "";
  context.system.notes ??= "";

  // IMPORTANT: enriched must always be a string (never undefined)
  context.enriched = context.enriched ?? {};
  const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(String(context.system.description ?? ""), {
    secrets: context.owner,
    documents: true,
    relativeTo: this.item.parent ?? this.item
  });

  context.enriched.description = Handlebars.helpers.dsify
    ? Handlebars.helpers.dsify(enriched)
    : enriched;

  // Debug helper if you keep the debug line
  context.isGM = game.user.isGM;

  return context;
}

  async _preRender(context, options) {
    await super._preRender(context, options);
    this._mcdeSavedFocus = mcdeCaptureFocusedField(this.element);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    mcdeRestoreFocusedField(this.element, this._mcdeSavedFocus);
  }

}

/* =========================================================
   SPELL Sheet
========================================================= */

class MCDESpellSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mcde", "sheet", "item", "spell", "themed", "theme-light"],
    position: { width: 520, height: 420 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: mcdeEditImageAction
    }
  };

  static PARTS = {
    form: { template: `systems/${SYSTEM_ID}/templates/item/spell-sheet.html` }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
  const context = await super._prepareContext(options);
  context.item = this.item;
  context.system = this.item.system ?? {};

  const parentOwner = this.item.parent?.isOwner;
  context.owner = (parentOwner !== undefined) ? parentOwner : this.item.isOwner;
  context.editable = this.isEditable;

  context.system.difficulty ??= "D1";
  context.system.target ??= "";
  context.system.duration ??= "";
  context.system.baseEffect ??= "";
  context.system.momentum ??= "";

// IMPORTANT: enriched must always be a string (never undefined)
context.enriched = context.enriched ?? {};

// Base Effect
const enrichedBase = await foundry.applications.ux.TextEditor.implementation.enrichHTML(String(context.system.baseEffect ?? ""), {
  secrets: context.owner,
  documents: true,
  relativeTo: this.item.parent ?? this.item
});

context.enriched.baseEffect = Handlebars.helpers.dsify
  ? Handlebars.helpers.dsify(enrichedBase)
  : enrichedBase;

// Momentum Spends
const enrichedMomentum = await foundry.applications.ux.TextEditor.implementation.enrichHTML(String(context.system.momentum ?? ""), {
  secrets: context.owner,
  documents: true,
  relativeTo: this.item.parent ?? this.item
});

context.enriched.momentum = Handlebars.helpers.dsify
  ? Handlebars.helpers.dsify(enrichedMomentum)
  : enrichedMomentum;


  return context;
}

}

/* =========================================================
   EQUIPMENT Sheet
========================================================= */

class MCDEEquipmentSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mcde", "sheet", "item", "equipment", "themed", "theme-light"],
    position: { width: 560, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: mcdeEditImageAction
    }
  };

  static PARTS = {
    form: { template: `systems/${SYSTEM_ID}/templates/item/equipment-sheet.html` }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system ?? {};

    const parentOwner = this.item.parent?.isOwner;
    context.owner = (parentOwner !== undefined) ? parentOwner : this.item.isOwner;
    context.editable = this.isEditable;

    // Defaults (stockés en texte comme tu veux)
    context.system.load ??= "";
    context.system.encumbrance ??= "";
    context.system.reliability ??= "";
    context.system.restriction ??= "";
    context.system.cost ??= "";
    context.system.maintenance ??= "";
    context.system.description ??= "";

    // Enriched HTML pour {{editor}} (comme weapon/armor/quality)
    context.enriched = context.enriched ?? {};
    context.enriched.description = await foundry.applications.ux.TextEditor.implementation.enrichHTML(String(context.system.description ?? ""), {
      secrets: context.owner,
      documents: true,
      relativeTo: this.item.parent ?? this.item
    });

    return context;
  }
}



/* =========================================================
   WEAPON Sheet
========================================================= */

class MCDEWeaponSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mcde", "sheet", "item", "weapon", "themed", "theme-light"],
    position: { width: 520, height: 820 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      editImage: mcdeEditImageAction
    }
  };

  static PARTS = {
    form: { template: `systems/${SYSTEM_ID}/templates/item/weapon-sheet.html` }
  };

  get title() {
    return this.document.name;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    context.system = this.item.system ?? {};
    // IMPORTANT: for embedded items, ownership comes from the parent actor
    const parentOwner = this.item.parent?.isOwner;
    context.owner = (parentOwner !== undefined) ? parentOwner : this.item.isOwner;
    context.editable = this.isEditable;

    // ensure structures exist
    context.system.stats = context.system.stats ?? {};
    context.system.damage = context.system.damage ?? { base: 1, dsy: 0, flatBonus: 0 };
    context.system.qualities = Array.isArray(context.system.qualities) ? context.system.qualities : [];
    if (context.system.description === undefined || context.system.description === null) context.system.description = "";

    // IMPORTANT: provide enriched HTML for the {{editor}} helper
    context.enriched = context.enriched ?? {};
    context.enriched.description = await foundry.applications.ux.TextEditor.implementation.enrichHTML(context.system.description ?? "", {
      secrets: context.owner,
      documents: true,
      relativeTo: this.item.parent ?? this.item
    });

    return context;
  }

  async _preRender(context, options) {
    await super._preRender(context, options);
    this._mcdeSavedFocus = mcdeCaptureFocusedField(this.element);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    mcdeRestoreFocusedField(this.element, this._mcdeSavedFocus);
    const root = this.element;

    // Listeners are rebound on every render — an AbortController guards
    // against stacking duplicate handlers across re-renders.
    this._mcdeRenderAbort?.abort();
    this._mcdeRenderAbort = new AbortController();
    const { signal } = this._mcdeRenderAbort;

    // remove quality tag
    root.querySelectorAll(".mcde-quality-remove").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const idx = Number(ev.currentTarget.dataset.index);
        const qualities = Array.isArray(this.item.system.qualities) ? [...this.item.system.qualities] : [];
        qualities.splice(idx, 1);
        await this.item.update({ "system.qualities": qualities });
      }, { signal });
    });

    // Drop Quality item onto dropzone
    const zone = root.querySelector(".mcde-quality-dropzone");
    if (zone) {
      zone.addEventListener("dragover", (ev) => ev.preventDefault(), { signal });
      zone.addEventListener("drop", async (ev) => {
        ev.preventDefault();

        let data;
        try {
          data = JSON.parse(ev.dataTransfer?.getData("text/plain") ?? "{}");
        } catch {
          return;
        }

        let doc = null;
        if (data?.type === "Item" && data?.id) doc = game.items?.get?.(data.id) ?? null;
        if (!doc && data?.uuid) doc = await fromUuid(data.uuid);
        if (!doc || doc.type !== "quality") return;

        const qualities = Array.isArray(this.item.system.qualities) ? [...this.item.system.qualities] : [];
        const uuid = doc.uuid ?? "";
        if (uuid && qualities.some(q => q.uuid === uuid)) return;

        qualities.push({
          uuid,
          name: doc.name,
          description: String(doc.system?.description ?? "")
        });

        await this.item.update({ "system.qualities": qualities });
      }, { signal });
    }

    function autoFitNameInput(input){
      const maxFont = 22;   // taille normale
      const minFont = 12;   // taille minimale acceptable

      input.style.fontSize = maxFont + "px";

      // Réinitialise pour mesurer correctement
      while (input.scrollWidth > input.clientWidth && parseFloat(input.style.fontSize) > minFont){
        input.style.fontSize = (parseFloat(input.style.fontSize) - 1) + "px";
      }
    }

    const nameInput = root.querySelector("input[name='name']");
    if (nameInput) {
      autoFitNameInput(nameInput);
      nameInput.addEventListener("input", () => autoFitNameInput(nameInput), { signal });

      // The custom "Bank Gothic" webfont may still be downloading (or not
      // even requested yet — a font the browser hasn't seen used anywhere
      // is not necessarily included in `document.fonts.ready`) when the
      // line above measures scrollWidth/clientWidth against the fallback
      // font. The layout can also still shift slightly after this point
      // (e.g. the window-content scrollbar appearing). Belt-and-braces:
      // explicitly request the exact font used, re-run once it resolves,
      // AND re-run again after layout has had a chance to settle. Cheap,
      // and each call is a no-op if the size was already correct.
      try {
        document.fonts?.load('500 22px "Bank Gothic"')
          ?.then(() => autoFitNameInput(nameInput))
          ?.catch(() => {});
      } catch (_) {}
      document.fonts?.ready?.then(() => autoFitNameInput(nameInput));
      requestAnimationFrame(() => requestAnimationFrame(() => autoFitNameInput(nameInput)));
      setTimeout(() => autoFitNameInput(nameInput), 300);
    }
  }
}

/* =========================================================
   Hooks: init / ready
========================================================= */

Hooks.once("init", async () => {
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("gt", (a, b) => a > b);


    // DS ICON helper
  Handlebars.registerHelper("dsify", function (input) {
  if (input === null || input === undefined) return "";

  if (typeof input === "object") {
    input = input?.value ?? input?.text ?? input?.content ?? "";
  }

  const iconPath = `systems/${SYSTEM_ID}/assets/sheet/dsd.png`;
  const iconHTML = `<img class="ds-icon" src="${iconPath}" alt="DS">`;

  let s = String(input);

    // Replace DSD everywhere (token)
    s = s.replace(/\bDSD\b/g, iconHTML);

  return new Handlebars.SafeString(s);
});
  Handlebars.registerHelper("dsValue", function (n) {
    const iconPath = `systems/${SYSTEM_ID}/assets/sheet/dsd.png`;
    return new Handlebars.SafeString(
      `<span class="ds-pack"><img class="ds-icon" src="${iconPath}">${n}</span>`
    );
  });

// Handlebars helpers used by vehicle-sheet.html (range + lte)
Handlebars.registerHelper("range", (from, to) => {
  const a = Number(from) || 0;
  const b = Number(to) || 0;
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
});

Handlebars.registerHelper("lte", (a, b) => {
  return (Number(a) || 0) <= (Number(b) || 0);
});


  // ---------------------------------------------------------
  // Preload Handlebars partials (required for {{> ...}})
  // ---------------------------------------------------------
  await loadTemplates([
    `systems/${SYSTEM_ID}/templates/partials/combat-locations.html`
  ]);


  // Settings (world-shared)
  game.settings.register(SYSTEM_ID, "darkSymmetryPool", {
    name: "Dark Symmetry Pool",
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: () => renderTrackersUI()
  });

  game.settings.register(SYSTEM_ID, "momentum", {
    name: "Momentum",
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: () => renderTrackersUI()
  });

    // Register Actor sheet
  Actors.registerSheet(SYSTEM_ID, MCDECharacterSheet, {
    types: ["character"],
    makeDefault: true
  });


  // Register NPC sheet
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet(SYSTEM_ID, MCDENpcSheet, {
    types: ["npc"],
    makeDefault: true
  });

  // Register NEMESIS sheet (Actor.type === "nemesis")
  Actors.registerSheet(SYSTEM_ID, MCDENemesisSheet, {
    types: ["nemesis"],
    makeDefault: true
  });

  // Register Vehicle sheet (Actor.type === "vehicle")
  Actors.registerSheet(SYSTEM_ID, MCDEVehicleSheet, { types: ["vehicle"], makeDefault: true });

  // Register sheets
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet(SYSTEM_ID, MCDEWeaponSheet, { types: ["weapon"], makeDefault: true });
  Items.registerSheet(SYSTEM_ID, MCDEQualitySheet, { types: ["quality"], makeDefault: true });
  Items.registerSheet(SYSTEM_ID, MCDETalentSheet, { types: ["talent"], makeDefault: true });
  Items.registerSheet(SYSTEM_ID, MCDEArmorSheet,  { types: ["armor"],  makeDefault: true });
  Items.registerSheet(SYSTEM_ID, MCDESpellSheet,     { types: ["spell"],     makeDefault: true });
  Items.registerSheet(SYSTEM_ID, MCDEEquipmentSheet, { types: ["equipment"], makeDefault: true });



  // Expose API
  game.mcde = game.mcde || {};
  game.mcde.rollTest = rollTest;
  game.mcde.rollDamage = rollDamage;
  game.mcde.hitLocation = mcHitLocation;
  game.mcde.dialogV2 = mcdeDialogV2;
  game.mcde.editImage = mcdeEditImageAction;
  game.mcde.captureFocus = mcdeCaptureFocusedField;
  game.mcde.restoreFocus = mcdeRestoreFocusedField;

// =========================================================
// Auto-link rule: Characters linked, NPC/Nemesis unlinked
// =========================================================
Hooks.on("preCreateToken", (doc, data, options, userId) => {
  // Ignore synthetic creations (imports, etc.)
  if (options?.temporary) return;

  // doc.actor peut être null selon le contexte, donc fallback sur actorId
  const actor = doc.actor ?? game.actors?.get?.(doc.actorId);
  if (!actor) return;

  // IMPORTANT:
  // Foundry fournit quasi toujours data.actorLink depuis le prototype token,
  // donc "respecter data.actorLink" empêche de forcer notre règle.
  // On applique la règle systématiquement :
  // - character => linked
  // - tout le reste (npc, etc.) => unlinked
  doc.updateSource({ actorLink: actor.type === "character" });
});

Hooks.on("renderDialog", (app, html) => {
  // tag only our dialogs
  if (app?.options?.mcdeSkin) {
    html.closest("dialog, .window-app")?.classList?.add("mcde-dialog");
  }
});


  // -------------------------------------------------------
  // Dice So Nice integration (custom Dark Symmetry Die preset)
  // -------------------------------------------------------
  Hooks.once("diceSoNiceReady", (dice3d) => {
    try {
      // Register our DSN "system"
      dice3d.addSystem({ id: SYSTEM_ID, name: "Mutant Chronicles (Diesel)" }, true);

      // Dark Symmetry Die faces (d6)
      const base = `systems/${SYSTEM_ID}/assets/dice`;
      const dsdLabels = [
        `${base}/dsd1.jpg`,      // 1
        `${base}/dsd2.jpg`,      // 2
        `${base}/dsdblank.jpg`,  // 3
        `${base}/dsdblank.jpg`,  // 4
        `${base}/dsdblank.jpg`,  // 5
        `${base}/dsd6.jpg`       // 6 (effect)
      ];

      // Add a *new* d6 preset (does NOT override default unless the user selects it in DSN settings)
      dice3d.addDicePreset({
        type: "d6",
        labels: dsdLabels,
        system: SYSTEM_ID
      });

      console.log("MCDE | Dice So Nice ready: DSD preset registered");
    } catch (e) {
      console.warn("MCDE | Dice So Nice integration failed", e);
    }
  });

// =========================================================
// Initiative Rule: Characters first, Nemesis second, NPC after
// (No roll display needed: initiative is only a sort key.)
// =========================================================
Hooks.on("createCombatant", async (combatant) => {
  if (!combatant.actor) return;

  let init = 0; // <-- manquait chez toi
  const t = combatant.actor.type;

  // Higher number = earlier in tracker
  if (t === "character") init = 30;
  else if (t === "nemesis") init = 20;
  else if (t === "npc") init = 10;
  else init = 0; // vehicles/other

  // Only set if not already defined
  if (combatant.initiative === null) {
    await combatant.update({ initiative: init });
  }
});

// =========================================================
// Combat Tracker: "Already acted this round" (icon) + GM click to set turn
// Assets expected:
//   systems/mutant-chronicles-diesel-edition/assets/initiative/initdone.png
//   systems/mutant-chronicles-diesel-edition/assets/initiative/initpending.png
// =========================================================
const MCDE_TURN_DONE_FLAG_KEY = "turnDone";
const MCDE_INIT_ICON_DONE = `systems/${SYSTEM_ID}/assets/initiative/initdone.png`;
const MCDE_INIT_ICON_PENDING = `systems/${SYSTEM_ID}/assets/initiative/initpending.png`;

function mcdeGetTurnDoneMap(combat) {
  return foundry.utils.duplicate(combat?.getFlag(SYSTEM_ID, MCDE_TURN_DONE_FLAG_KEY) ?? {});
}

async function mcdeSetTurnDoneMap(combat, map) {
  return combat.setFlag(SYSTEM_ID, MCDE_TURN_DONE_FLAG_KEY, map);
}

async function mcdeToggleTurnDone(combat, combatantId) {
  const map = mcdeGetTurnDoneMap(combat);
  map[combatantId] = !map[combatantId];
  return mcdeSetTurnDoneMap(combat, map);
}

async function mcdeClearTurnDone(combat) {
  return mcdeSetTurnDoneMap(combat, {});
}

// Reset at new round (GM only)
Hooks.on("updateCombat", async (combat, changed) => {
  if (!game.user.isGM) return;
  if (changed.round != null) {
    await mcdeClearTurnDone(combat);
  }
});

function mcdeGetStatusIconById(statusId) {
  // Foundry: CONFIG.statusEffects is often an array of {id, icon, label}
  const se = (CONFIG.statusEffects ?? []).find(e => e.id === statusId);
  if (se?.icon) return se.icon;

  // Foundry V12/V13 often exposes game.statuses as a Map
  try {
    const gs = game.statuses?.get?.(statusId);
    if (gs?.img) return gs.img;
  } catch (_) {}

  return null;
}

function mcdeGetTokenStatuses(tokenDoc) {
  // tokenDoc.statuses is commonly a Set of status ids in V12/V13
  const s = tokenDoc?.statuses;
  if (s && typeof s[Symbol.iterator] === "function") return Array.from(s);

  // fallback: some setups keep actor statuses
  const a = tokenDoc?.actor?.statuses;
  if (a && typeof a[Symbol.iterator] === "function") return Array.from(a);

  return [];
}

// Inject minimal CSS once (combat tracker icons placement)
Hooks.on("renderCombatTracker", (app, html) => {
  const combat = app.viewed;
  if (!combat) return;

  // --- CSS (once)
  const STYLE_ID = "mcde-combat-tracker-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* Hide the initiative numeric input (we only use initiative as a sort key) */
      #combat li.combatant input.initiative-input { display: none !important; }

      /* Make sure combatant rows don't overflow when we add a right-side icon */
      #combat li.combatant { position: relative; overflow: hidden; padding-right: 44px; }

      /* Right-side container pinned to the far right */
      #combat li.combatant .mcde-right {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        gap: 6px;
        pointer-events: none; /* only the icon itself should be clickable for GM */
      }

      /* The cog icon itself */
      #combat li.combatant .mcde-turn-done {
        width: 45px;
        height: 45px;
        flex: 0 0 26px;
        display: block;
        cursor: pointer;
        pointer-events: auto;
      }

      /* Statuses under the name */
      #combat li.combatant .mcde-statuses {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 2px;
      }
      #combat li.combatant .mcde-statuses img {
        width: 18px;
        height: 18px;
        max-width: 30px;
        max-height: 30px;
        object-fit: contain;
        display: block;
      }
    `;
    document.head.appendChild(style);
  }

  const root = html?.[0] ?? html;
  if (!root?.querySelectorAll) return;

  const map = mcdeGetTurnDoneMap(combat);
  const combatantLis = Array.from(root.querySelectorAll("li.combatant"));

  for (const li of combatantLis) {
    const combatantId = li.dataset?.combatantId;
    if (!combatantId) continue;

    const combatant = combat.combatants?.get?.(combatantId);
    if (!combatant) continue;

    const isDone = !!map[combatantId];
    li.classList.toggle("mcde-turn-done-yes", isDone);

    // ---------- RIGHT SIDE CONTAINER ----------
    let right = li.querySelector(".mcde-right");
    if (!right) {
      right = document.createElement("div");
      right.className = "mcde-right";
      li.appendChild(right);
    }

    // ---------- TURN DONE COG ICON ----------
    let btn = right.querySelector("img.mcde-turn-done");
    if (!btn) {
      btn = document.createElement("img");
      btn.className = "mcde-turn-done";
      btn.alt = "";
      btn.title = "Already acted this round";
      right.appendChild(btn);

      if (game.user.isGM) {
        btn.addEventListener("click", async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          await mcdeToggleTurnDone(combat, combatantId);
          app.render(false);
        });
      } else {
        btn.style.pointerEvents = "none";
      }
    }
    btn.src = isDone ? MCDE_INIT_ICON_DONE : MCDE_INIT_ICON_PENDING;

    // ---------- STATUS ICONS (small, under the name) ----------
    // Try to resolve a TokenDocument
    const tokenDoc =
      combatant.token
      ?? combatant.token?.document
      ?? combatant.actor?.getActiveTokens?.(true)?.[0]?.document
      ?? null;

    // Place the statuses directly under the name (not inside controls)
    const nameEl =
      li.querySelector(".token-name .name")
      || li.querySelector(".token-name strong.name")
      || li.querySelector(".combatant-name")
      || li.querySelector(".name")
      || li.querySelector("h4");

    let statusWrap = li.querySelector(".mcde-statuses");
    if (!statusWrap) {
      statusWrap = document.createElement("div");
      statusWrap.className = "mcde-statuses";
      if (nameEl?.insertAdjacentElement) nameEl.insertAdjacentElement("afterend", statusWrap);
      else li.appendChild(statusWrap);
    }
// Prefer Foundry's own status <img class="token-effect"> (avoid duplicates)
// We move them under the name into our wrapper.
const foundryStatusImgs = Array.from(li.querySelectorAll("img.token-effect"));
statusWrap.innerHTML = "";

if (foundryStatusImgs.length) {
  for (const img of foundryStatusImgs) statusWrap.appendChild(img);
} else if (tokenDoc) {
  // Fallback: build icons from token statuses (and mark them like Foundry)
  const statuses = mcdeGetTokenStatuses(tokenDoc);
  for (const statusId of statuses) {
    const icon = mcdeGetStatusIconById(statusId);
    if (!icon) continue;

    const img = document.createElement("img");
    img.className = "token-effect";
    img.src = icon;
    img.alt = statusId;
    img.title = statusId;
    statusWrap.appendChild(img);
  }
}
// ---- GM click on a combatant line => set turn (excluding controls/icons)
    if (!li.dataset.mcdeSetTurnBound) {
      li.dataset.mcdeSetTurnBound = "1";
      li.addEventListener("click", async (ev) => {
        if (!game.user.isGM) return;
        if (!combat.started) return;

        const ignore = ev.target?.closest?.(
          "a,button,input,select,label,.combatant-control,.combatant-controls,.mcde-turn-done,.mcde-statuses"
        );
        if (ignore) return;

        const c2 = combat.combatants?.get?.(combatantId);
        if (!c2 || c2.defeated) return;

        const idx = combat.turns?.findIndex(t => t.id === combatantId) ?? -1;
        if (idx < 0 || idx === combat.turn) return;

        if (typeof combat.setTurn === "function") await combat.setTurn(idx);
        else await combat.update({ turn: idx });
      });
    }
  }
});

});


Hooks.once("ready", async () => {

  // -----------------------------------------
  // Default turn marker (world)
  // -----------------------------------------
  if (game.user?.isGM) {
    const markerPath = `systems/${SYSTEM_ID}/assets/initiative/curplaying.png`;
    const cur = game.settings.get("core", "combatTrackerConfig") ?? {};

    const existing =
      cur?.turnMarker?.img ??
      cur?.turnMarker?.texture ??
      cur?.turnMarker?.image ??
      null;

    if (!existing) {
      const next = foundry.utils.mergeObject(cur, {
        turnMarker: {
          enabled: true,
          animation: "spin",
          img: markerPath,
          tint: true
        }
      }, { inplace: false });

      await game.settings.set("core", "combatTrackerConfig", next);
      console.log("MCDE | Default turn marker applied");
    } else {
      console.log("MCDE | Turn marker already configured, skipping");
    }
  }

  // Socket: players request momentum change -> GM applies
  game.socket.on(SOCKET_NS, async (payload) => {
    if (!payload?.type) return;
    if (!game.user.isGM) return;

    if (payload.type === "SET_MOMENTUM") {
      await game.settings.set(SYSTEM_ID, "momentum", clampInt(payload.value, 0, 6)); // ✅ cap à 6
    }
  });

  // Chat reroll clicks
  Hooks.on("renderChatMessage", (message, html) => {
    const state = message.getFlag(SYSTEM_ID, "rollState");
    if (!state) return;

    // This hook re-fires every time the card re-renders (reroll, gain
    // momentum, etc. all call message.update(), which re-triggers
    // renderChatMessage for the same message). Without a bound-guard on
    // the element itself, each re-render stacks another jQuery click
    // handler on the same button — a single later click then fires the
    // handler once per stacked render (confirmed: triggered "dead" status
    // application multiple times after a couple of rerolls).
    const bindOnce = (selector, handler) => {
      html.find(selector).each((_, el) => {
        if (el.dataset.mcdeBound) return;
        el.dataset.mcdeBound = "1";
        el.addEventListener("click", handler);
      });
    };

    bindOnce("[data-action='reroll']", async (ev) => {
      ev.preventDefault();
      const el = ev.currentTarget;
      await handleReroll(message, el.dataset.kind, el.dataset.index);
    });

    bindOnce("[data-action='apply-damage']", async (ev) => {
      ev.preventDefault();
      await handleApplyDamage(message, state);
    });

    bindOnce("[data-action='chronicle-add1']", async (ev) => {
      ev.preventDefault();
      await handleChronicleAdd1(message);
    });

    bindOnce("[data-action='roll-damage']", async (ev) => {
      ev.preventDefault();
      await handleRollDamage(message);
    });

    bindOnce("[data-action='gain-momentum']", async (ev) => {
      ev.preventDefault();
      const amt = Number(ev.currentTarget.dataset.amount ?? 0) || 0;
      await handleGainMomentum(message, amt);
    });

  html.find(".mcde-card .mcde-trait[data-tooltip]").on("mouseenter", (ev) => {
    try {
      const el = ev.currentTarget;
      ui?.tooltip?.activate?.(el, { text: el.dataset.tooltip });
    } catch (e) {}
  });

  html.find(".mcde-card .mcde-trait[data-tooltip]").on("mouseleave", () => {
  try { ui?.tooltip?.deactivate?.(); } catch (e) {}
  try { ui?.tooltip?.dismiss?.(); } catch (e) {} // fallback selon version
});

  });

  ensureTrackersUI();
  renderTrackersUI();

// ================================
  // AUTO DEAD STATUS SYNC
  // ================================

  function mcdeIsActorDead(actor) {
    const sys = actor?.system ?? {};

    if (actor?.type === "npc") {
      const cur = Number(sys?.wounds?.current ?? 0) || 0;
      const tot = Number(sys?.wounds?.total ?? 0) || 0;
      return (tot > 0 && cur >= tot);
    }

    console.log("MCDE | setDeadStatus is", typeof setDeadStatus);

    const crit = sys?.combat?.criticalWounds;
    if (Array.isArray(crit) && crit.length > 0) {
      return crit.every(Boolean);
    }

    return false;
  }

  async function mcdeSyncDeadStatus(actor) {
    const dead = mcdeIsActorDead(actor);
    const tokens = actor?.getActiveTokens?.(true) ?? [];
    for (const t of tokens) {
      await setDeadStatus(t, dead);
    }
  }

  Hooks.on("updateActor", async (actor, changes) => {
  if (!game.user.isGM) return;

  console.log("MCDE | updateActor fired", { actor: actor?.name, changes });

  const has = foundry.utils.hasProperty;
  const relevant =
    has(changes, "system.wounds") ||
    has(changes, "system.wounds.current") ||
    has(changes, "system.wounds.total") ||
    has(changes, "system.combat.criticalWounds") ||
    has(changes, "system.combat");

  if (!relevant) return;

  await mcdeSyncDeadStatus(actor);
});

const t = ui?.tooltip;
if (t?.options) {
  t.options.delay = 0;
  t.options.dismissDelay = 0;
}

  console.log("MCDE | ready OK");
});