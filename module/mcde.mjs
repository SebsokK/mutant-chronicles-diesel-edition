// module/mcde.mjs
const SYSTEM_ID = "mutant-chronicles-diesel-edition";
const SOCKET_NS = `system.${SYSTEM_ID}`;

import { MCDEVehicleSheet } from "./vehicule/vehicle-sheet.mjs";

// Small helper: enrich HTML for "read mode" display of {{editor ...}}
async function _enrich(content) {
  const html = String(content ?? "");
  return TextEditor.enrichHTML(html, {
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
  const diceHtml = (dice ?? [])
    .map((v, i) => {
      const tags = [
        i === chronicleIndex ? "AUTO-1" : null,
        rerolled?.[i] ? "Rerolled" : null
      ].filter(Boolean);

      const tagHtml = tags.length
        ? ` <span class="tags">(${tags.join(", ")})</span>`
        : "";

      return `<button type="button" class="mcde-die" data-action="reroll" data-kind="test" data-index="${i}">${v}</button>${tagHtml}`;
    })
    .join(" ");

  // 2) Résultats ensuite
  const difficulty = Number(state.difficulty) || 1;
  const total = Number(calc.total) || 0;
  const net = total - difficulty;
  const complications = Number(calc.repercussions) || 0;

  const resultsHtml = `
    <div class="mcde-results" style="margin-top:6px;">
      Successes: <strong>${total}</strong>
      | Difficulty: <strong>D${difficulty}</strong>
      | Net: <strong>${net}</strong>
      | Complications: <strong>${complications}</strong>
      <span style="opacity:0.7;">(Repercussion ${repercussionFrom}–20)</span>
    </div>
  `;

  // 3) Boutons (tes blocs existants)
  const actorType = String(state.actorType ?? "");
  const npcType = String(state.npcType ?? "");
  const isCharacter = (actorType === "character");
  const isNemesis = (npcType === "nemesis"); // 👈 chez toi, nemesis = npcType

  const canAddAuto1 = (!state.chronicleUsed) && (isCharacter || isNemesis);
  const add1Label = isNemesis ? "Add a 1 (6 DSP)" : "Add a 1 (2 CP)";

  const add1Html = canAddAuto1
    ? `<div class="mcde-actions" style="margin-top:6px;">
         <button type="button" class="mcde-btn" data-action="chronicle-add1">${add1Label}</button>
       </div>`
    : "";

  const atk = state.attack ?? null;
  const rollDamageHtml = (atk && !atk.damageRolled)
    ? `<div class="mcde-actions" style="margin-top:6px;">
         <button type="button" class="mcde-btn" data-action="roll-damage">Roll Damage</button>
       </div>`
    : "";

      // 3B) Gain Momentum (PC only, if Net >= 1, only once)
  const isPC = state.actorType === "character";
  const canGainMomentum = isPC && net >= 1 && !state.momentumGranted;

  const gainMomentumHtml = canGainMomentum
    ? `<div class="mcde-actions" style="margin-top:6px;">
         <button type="button" class="mcde-btn" data-action="gain-momentum" data-amount="${net}">
           Gain Momentum (+${net})
         </button>
       </div>`
    : "";


  // 4) Return à la fin
  return `
  <div class="mcde-card" data-mcde-card="1">
    <header><strong>TEST</strong>${label ? ` — ${label}` : ""}</header>

    <div>
      TN: <strong>${tn}</strong>
      | Focus: <strong>${focus}</strong>
      | Difficulty: <strong>D${difficulty}</strong>
      ${state.autoSuccesses ? ` <span style="opacity:0.7;">(+${state.autoSuccesses} auto)</span>` : ""}
    </div>

    <div class="mcde-dice">${diceHtml}</div>
    ${resultsHtml}
    ${add1Html}
    ${rollDamageHtml}
    ${gainMomentumHtml}
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

async function setDeadStatus(token, active) {
  try {
    if (token?.document?.toggleStatusEffect) {
      await token.document.toggleStatusEffect("dead", { active });
      return;
    }
  } catch (e) {}
  try {
    if (token?.toggleEffect) {
      await token.toggleEffect("dead", { active });
    }
  } catch (e) {}
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
      new Dialog({
        title: "Apply Damage",
        content,
        buttons: {
          apply: {
            label: "Apply",
            callback: async (html) => {
              const skipSoak = !!html.find("[name='skipSoak']")[0]?.checked;
              const val = Number(html.find("[name='applyDamage']").val() ?? 0) || 0;
              const final = Math.max(0, skipSoak ? rolledDamage : val);

              await applyDamageToActor({ actor, token, dmg: final, locKey });

              try {
                await message.update({ [`flags.${SYSTEM_ID}.rollState.damageApplied`]: true });
              } catch (e) {}

              resolve(true);
            }
          },
          cancel: { label: "Cancel", callback: () => resolve(false) }
        },
        default: "apply"
      }, {
    width: 520,
    classes: ["mcde-dialog", "mcde-applydamage-dialog"]
  }).render(true);
    });
  } catch (e) {
    console.error(e);
    ui.notifications?.error?.("Apply Damage failed. See console.");
  }
}

function renderDamageCard(state) {
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

  const dsdHtml = dsd
    .map((v, i) => {
      const tag = dsdRerolled?.[i] ? ` <span class="tags">(Rerolled)</span>` : "";
      return `<button type="button" class="mcde-die" data-action="reroll" data-kind="dsd" data-index="${i}">${v}</button>${tag}`;
    })
    .join(" ");

  const locTag = locationRerolled ? ` <span class="tags">(Rerolled)</span>` : "";

  const hasTarget = !!(game?.user?.targets && game.user.targets.size);
  const applyDamageHtml = (game?.user?.isGM && hasTarget)
    ? `<div class="mcde-actions" style="margin-top:6px;">
         <button type="button" class="mcde-btn" data-action="apply-damage">Apply Damage</button>
       </div>`
    : "";

  return `
  <div class="mcde-card" data-mcde-card="1">
    <header><strong>DAMAGE</strong>${weaponName ? ` — ${weaponName}` : ""}</header>
    <div>Mode: <strong>${mode}</strong> | Damage: <strong>${totalDamage}</strong> | Effects: <strong>${effects}</strong></div>
    <div>Location: <button type="button" class="mcde-die" data-action="reroll" data-kind="location" data-index="0">${locationD20}</button>${locTag} ⇒ <strong>${locLabel}</strong></div>
    <div class="mcde-dice">DSD: ${dsdHtml}</div>
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
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
    rolls: [roll],
    flags: { [SYSTEM_ID]: { rollState: state } }
  });
}

async function rollDamage({ actor, weaponName = "", mode = "ranged", dsdCount, flatBonus = 0 } = {}) {
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
  weaponName,
  mode,
  flatBonus: Number(flatBonus) || 0,
  dsd,
  dsdRerolled,
  locationD20,
  locationRerolled: false
};


  return ChatMessage.create({
    content: renderDamageCard(state),
    speaker: ChatMessage.getSpeaker({ actor }),
    type: CONST.CHAT_MESSAGE_TYPES.ROLL,
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
    flatBonus
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
    content: renderDamageCard(state),
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
    "min-width:210px; padding:6px 8px; border:1px solid rgba(255,255,255,0.2); border-radius:6px; background:rgba(0,0,0,0.55);";
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
      <div style="margin-top:4px; font-size:11px; color:rgba(255,255,255,0.7);">GM only</div>
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
      <div style="margin-top:4px; font-size:11px; color:rgba(255,255,255,0.7);">Everyone</div>
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

class MCDECharacterSheet extends ActorSheet {

  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["mcde", "sheet", "actor", "character"],
      template: `systems/${SYSTEM_ID}/templates/actor/character-sheet.html`,
      width: 900,
      height: 800,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
    });
  }

  async getData() {
    const context = await super.getData();

    context.system = this.actor.system;
    context.owner = this.actor.isOwner;
    context.editable = this.isEditable;

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
    context.enriched.combatNotes = await TextEditor.enrichHTML(String(context.system.combatNotes ?? ""), {
      async: true,
      secrets: this.actor.isOwner,
      documents: true,
      relativeTo: this.actor
    });

    // Enriched HTML for editor fields (Notes + Background)
    context.enriched = context.enriched ?? {};

context.enriched.notes = await TextEditor.enrichHTML(
  context.system.notes ?? "",
  {
    async: true,
    secrets: context.owner,
    documents: true,
    relativeTo: this.actor
  }
);

context.enriched.background = await TextEditor.enrichHTML(
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
  autoSoak.head      += Number(armor.system?.soak?.head ?? 0);
  autoSoak.torso     += Number(armor.system?.soak?.torso ?? 0);
  autoSoak.left_arm  += Number(armor.system?.soak?.left_arm ?? 0);
  autoSoak.right_arm += Number(armor.system?.soak?.right_arm ?? 0);
  autoSoak.legs      += Number(armor.system?.soak?.legs ?? 0);
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
      autoSoak.head      += Number(soak.head ?? 0) || 0;
      autoSoak.torso     += Number(soak.torso ?? 0) || 0;
      autoSoak.left_arm  += Number(soak.left_arm ?? soak.leftArm ?? 0) || 0;
      autoSoak.right_arm += Number(soak.right_arm ?? soak.rightArm ?? 0) || 0;
      autoSoak.legs      += Number(soak.legs ?? 0) || 0;
    }
    return autoSoak;
  }

  
  activateListeners(html) {
    super.activateListeners(html);

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

    const setProgress = async (track, index) => {
      const cur = Array.isArray(this.actor.system.combat?.[track]) ? [...this.actor.system.combat[track]] : [];
      if (index < 0 || index >= cur.length) return;

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
      const group = ev.currentTarget.closest(".mcde-wound-group");
      const track = group?.dataset?.track;
      if (!track) return;
      await resizeTrack(track, ev.currentTarget.value);
    });

    html.on("click", ".mcde-wound-group .mcde-wound-box", async (ev) => {
      const box = ev.currentTarget;
      const group = box.closest(".mcde-wound-group");
      const track = group?.dataset?.track;
      if (!track) return;
      const index = Number(box.dataset.index);
      await setProgress(track, index);
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
  const isRanged = (weapon.system?.weaponType === "ranged");

  // ---- Which skill is used
  const attrKey = isRanged ? "coordination" : "agility";
  const skillKey = isRanged ? "ranged_weapons" : "close_combat";

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
  const canLetRip = isRanged && wMode && wMode.toLowerCase() !== "munition";
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
      <div style="font-weight:600;">Let Rip</div>
      <div style="opacity:0.75; font-size:12px;">
        Select bullets to spend (max <span class="mcde-let-rip-max">${letRipMax}</span>). Ammo: <strong>${reloadCur}</strong>
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
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

  const braceHtml = (!isRanged || !hasUnwieldy) ? "" : `
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
    <form class="mcde-attack-dialog" style="display:flex; flex-direction:column; gap:10px;">
      <div>
        <div style="font-weight:700; font-size:14px;">${foundry.utils.escapeHTML(wName)}</div>
        <div style="opacity:0.8; font-size:12px;">
          Attack Type: <strong>${isRanged ? "Ranged" : "Melee"}</strong>
          ${isRanged ? ` | Range: <strong>${foundry.utils.escapeHTML(wRange)}</strong> | Firing Mode: <strong>${foundry.utils.escapeHTML(wMode)}</strong>` : ``}
        </div>
        ${traitsHtml}
      </div>

      <hr/>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
        <div>
          <div style="font-weight:600;">Modifiers</div>

          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:6px;">
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
          <div style="font-weight:600;">Difficulty</div>
          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:6px;">
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
        <div style="font-weight:600;">Attack Modifiers</div>
        <label style="display:flex; align-items:center; gap:8px; margin-top:6px;">
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
  new Dialog({
    title: `Attack — ${wName}`,
    content,
    render: (html) => {
    const root = html[0];
    const letRipEl = root.querySelector(".mcde-let-rip");
    if (!letRipEl) return;

    const over = root.querySelector('input[name="overRip"]');
    const maxLabel = root.querySelector(".mcde-let-rip-max");
    const hidden = root.querySelector('input[name="letRip"]');

    const baseMax = Number(letRipEl.dataset.baseMax ?? 0) || 0;

    const bullets = Array.from(letRipEl.querySelectorAll(".mcde-let-rip-bullet"));

    const getMax = () => baseMax + (over?.checked ? 1 : 0);

  const paint = () => {
    const max = getMax();
    letRipEl.dataset.max = String(max);
    if (maxLabel) maxLabel.textContent = String(max);

    const selectedRaw = Number(letRipEl.dataset.selected ?? 0) || 0;
    const selected = Math.min(selectedRaw, max);
    if (selected !== selectedRaw) {
      letRipEl.dataset.selected = String(selected);
      if (hidden) hidden.value = String(selected);
    }

    for (const b of bullets) {
      const v = Number(b.dataset.value ?? 0) || 0;
      b.src = (v <= selected) ? bulletSrcFull : bulletSrcEmpty;
      b.style.opacity = (v <= max) ? "0.9" : "0.25";
      b.style.pointerEvents = (v <= max) ? "auto" : "none";
    }
  };

  // Some Foundry DOMs are finicky; listen to multiple events
  over?.addEventListener("change", paint);
  over?.addEventListener("click", paint);

for (const b of bullets) {
  b.addEventListener("click", () => {
    const v = Number(b.dataset.value ?? 0) || 0;
    const max = Number(letRipEl.dataset.max ?? 0) || 0;
    if (v > max) return;
    letRipEl.dataset.selected = String(v);
    if (hidden) hidden.value = String(v);
    paint();
  });
}

paint();
  },
    buttons: {
      roll: {
        label: "Roll Attack",
        callback: async (dlgHtml) => {
          const extraDice = Number(dlgHtml.find("[name='extraDice']").val() ?? 0) || 0;
          const useChronicle = !!dlgHtml.find("[name='useChronicle']")[0]?.checked;

          const exploit = !!dlgHtml.find("[name='exploitWeakness']")[0]?.checked;
          const surprise = !!dlgHtml.find("[name='surprise']")[0]?.checked;

          const baseDiff = Number(dlgHtml.find("[name='difficulty']").val() ?? 1) || 1;

          let letRip = Number(dlgHtml.find("[name='letRip']").val() ?? 0) || 0;
          const baseMax = Number(dlgHtml.find(".mcde-let-rip").data("base-max") ?? 0) || 0;
          const overRip = !!dlgHtml.find("[name='overRip']")[0]?.checked;
          const maxLetRip = baseMax + (overRip ? 1 : 0);
          if (letRip > maxLetRip) letRip = maxLetRip;

          const brace = !!dlgHtml.find("[name='brace']")[0]?.checked;

           // ---- Munition mode: consume 1 reload per attack
 if (weapon.system?.stats?.mode === "Munition") {
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
          if (letRip > 0) {
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
          const mode = isRanged ? "ranged" : "melee";
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
              mode: isRanged ? "ranged" : "melee",
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
    default: "roll",
    render: (dlgHtml) => {
      // Let Rip click behavior + Over Rip (+1 max)
  const wrap = dlgHtml.find(".mcde-let-rip");
  if (!wrap.length) return;

  const hidden = dlgHtml.find("[name='letRip']");
  const over = dlgHtml.find("[name='overRip']")[0] ?? null;

  // base max is fixed by weapon mode; UI can show +1 bullet but we unlock it via checkbox
  const baseMax = Number(wrap.data("base-max") ?? wrap.data("max") ?? 0) || 0;
  const getMax = () => baseMax + (over?.checked ? 1 : 0);

  const setSelected = (n) => {
    const max = getMax();
    n = Math.max(0, Math.min(max, n));
    wrap.attr("data-selected", String(n));
    hidden.val(String(n));

    // update label if present
    const lbl = dlgHtml.find(".mcde-let-rip-max");
    if (lbl.length) lbl.text(String(max));

    // refresh bullets
    const imgs = wrap.find(".mcde-let-rip-bullet");
    imgs.each((_, el) => {
      const v = Number(el.dataset.value ?? 0) || 0;
      el.src = (v > 0 && v <= n) ? bulletSrcFull : bulletSrcEmpty;
      el.style.opacity = (v <= max) ? "0.9" : "0.25";
      el.style.pointerEvents = (v <= max) ? "auto" : "none";
    });
  };

  // init
  setSelected(0);

  // toggling over rip should refresh UI + clamp selection
  over?.addEventListener("change", () => setSelected(Number(hidden.val() ?? 0) || 0));
  over?.addEventListener("click",  () => setSelected(Number(hidden.val() ?? 0) || 0));

  wrap.on("click", ".mcde-let-rip-bullet", (ev) => {
    const v = Number(ev.currentTarget.dataset.value ?? 0) || 0;
    const max = getMax();
    if (v > max) return;

    const cur = Number(hidden.val() ?? 0) || 0;
    const next = (v <= cur) ? (v - 1) : v;
    setSelected(next);
  });
    }
  }, { width: 520 }).render(true);
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
  // 1) Bloquer le drop Foundry "global" (sinon double création)
  ev.preventDefault();
  ev.stopPropagation();

  const oe = ev.originalEvent ?? ev;
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

      new Dialog({
        title: "Add Trait",
        content,
        buttons: {
          add: {
            label: "Add",
            callback: async (dlgHtml) => {
              const v = String(dlgHtml.find("[name='trait']").val() ?? "").trim();
              if (!v) return;
              const cur = Array.isArray(this.actor.system.traits) ? [...this.actor.system.traits] : [];
              cur.push(v);
              await this.actor.update({ "system.traits": cur });
            }
          },
          cancel: { label: "Cancel" }
        },
        default: "add"
      }).render(true);
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
      const go = await Dialog.confirm({
        title: "Set Soaks",
        content: `<p>This will overwrite the current Hit Locations soaks with the sum of equipped armors.</p>`
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

// Click on Attribute header
html.find(".mcde-attr-head").on("click", async (ev) => {
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
    <form class="mcde-roll-dialog" style="display:flex; flex-direction:column; gap:10px;">
      <div>
        <div style="font-weight:700; font-size:14px;">
          ${foundry.utils.escapeHTML(ATTR_LABELS[attributeKey] ?? attributeKey)}
          ${skillKey ? ` + ${foundry.utils.escapeHTML(skillLabel)}` : ""}
        </div>
        <div style="opacity:0.75; font-size:12px;">
          TN <strong>${tn}</strong> | Focus <strong>${focus}</strong>
        </div>
      </div>

      ${skillSelectHtml}

      <hr/>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
        <div>
          <div style="font-weight:600;">Modifiers</div>

          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:6px;">
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
          <div style="font-weight:600;">Difficulty</div>
          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:6px;">
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

  new Dialog({
    title: "Player Test",
    content,
    buttons: {
      roll: {
        label: "Roll",
        callback: async (html) => {
          const extraDice = clampInt(html.find("[name='extraDice']").val(), 0, 3);
          const useChronicle = !!html.find("[name='useChronicle']")[0]?.checked;
          const dRaw = Number(html.find("[name='difficulty']").val());
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
            const chosen = String(html.find("[name='skillKey']").val() ?? "").trim();
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
    },
    default: "roll"
    }, {
    width: 520,
    classes: ["mcde-dialog", "mcde-skilltest-dialog"]
  }).render(true);
}

}


/* =========================================================
   NPC Sheet
========================================================= */

class MCDENpcSheet extends ActorSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["mcde", "sheet", "actor", "npc"],
      template: `systems/${SYSTEM_ID}/templates/actor/npc-sheet.html`,
      width: 900,
      height: 750,
      minWidth: 720,
      minHeight: 650,
      tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
    });
  }

  async getData() {
    const context = await super.getData();
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
    context.enriched.notes = await TextEditor.enrichHTML(context.system.notes ?? "", {
      async: true,
      secrets: this.actor.isOwner,
      documents: true,
      relativeTo: this.actor
    });
    context.enriched.darkSymmetrySpendsText = await TextEditor.enrichHTML(context.system.darkSymmetrySpendsText ?? "", {
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

  activateListeners(html) {
    super.activateListeners(html);

    // NOTE: do NOT force activateEditor() manually.
    // The {{editor}} helper handles read/edit toggle correctly when given enriched HTML.

    // Seed DSP text once if empty (persist to actor)
    this._seedDSPIfEmpty().catch(console.error);

    // When NPC type changes: seed only if empty
    html.find("select[name='system.npcType']").on("change", async (ev) => {
      await this._seedDSPIfEmpty(ev.currentTarget.value);
    });

    // Wounds click fill/clear
    html.find(".wound-box").on("click", async (ev) => {
      const index = Number(ev.currentTarget.dataset.index);
      const total = Number(this.actor.system.wounds?.total) || 0;
      let current = Number(this.actor.system.wounds?.current) || 0;

      if (index + 1 <= current) current = index;
      else current = index + 1;

      current = Math.max(0, Math.min(total, current));
      await this.actor.update({ "system.wounds.current": current });
    });

    // Clamp current when total changes
    html.find("input[name='system.wounds.total']").on("change", async (ev) => {
      const total = Number(ev.currentTarget.value) || 0;
      const current = Number(this.actor.system.wounds?.current) || 0;
      if (current > total) await this.actor.update({ "system.wounds.current": total });
    });

    // ----------------------
    // Click-to-roll labels (attributes / npc skills / weapons)
    // ----------------------
    html.find(".mcde-roll").on("click", async (ev) => {
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

      // Weapon info
      const isRanged = (weapon.system?.weaponType === "ranged");
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
      const canLetRip = isRanged && wMode && wMode.toLowerCase() !== "munition";
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
            <div style="font-weight:600;">Let Rip</div>
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
        <form class="mcde-attack-dialog" style="display:flex; flex-direction:column; gap:10px;">
          <div>
            <div style="font-weight:700; font-size:14px;">${foundry.utils.escapeHTML(wName)}</div>
            <div style="opacity:0.8; font-size:12px;">
              Attack Type: <strong>${isRanged ? "Ranged" : "Melee"}</strong>
              ${isRanged ? ` | Range: <strong>${foundry.utils.escapeHTML(wRange)}</strong> | Firing Mode: <strong>${foundry.utils.escapeHTML(wMode)}</strong>` : ``}
            </div>
            ${traitsHtml}
          </div>

          <hr/>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div>
              <div style="font-weight:600;">Dice</div>

              ${isHorde ? `
              <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:6px;">
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
              <div style="font-weight:600;">TN / Difficulty</div>

              <label style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:6px;">
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

      new Dialog({
        title: `Attack — ${wName}`,
        content,
        buttons: {
          roll: {
            label: "Roll Attack",
            callback: async (dlgHtml) => {
              const freeExtra = isHorde
                ? clampInt(dlgHtml.find("[name='freeExtra']").val(), 0, freeExtraMax)
                : 0;
              const paidExtra = clampInt(dlgHtml.find("[name='paidExtra']").val(), 0, paidExtraMax);
              const letRip = clampInt(dlgHtml.find("[name='letRip']").val(), 0, letRipMax);
              const autoOne = isNemesis && !!dlgHtml.find("[name='autoOne']")[0]?.checked;
              const difficulty = clampInt(dlgHtml.find("[name='difficulty']").val(), 1, 5);
              const attrKey = String(dlgHtml.find("[name='attrKey']").val() ?? "awareness");

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
              const mode = isRanged ? "ranged" : "melee";
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
                  flatBonus
                }
              });
            }
          },
          cancel: { label: "Cancel" }
        },
        default: "roll",
        render: (dlgHtml) => {
          // Let Rip bullet UI (same as PCs)
          const wrap = dlgHtml.find(".mcde-let-rip");
          if (!wrap.length) return;
          const max = Number(wrap.data("max") ?? 0) || 0;
          const hidden = dlgHtml.find("[name='letRip']");

          const setSelected = (n) => {
            n = Math.max(0, Math.min(max, n));
            wrap.attr("data-selected", String(n));
            hidden.val(String(n));
            const imgs = wrap.find(".mcde-let-rip-bullet");
            imgs.each((_, el) => {
              const v = Number(el.dataset.value ?? 0) || 0;
              el.src = (v > 0 && v <= n) ? bulletSrcFull : bulletSrcEmpty;
            });
          };

          setSelected(0);
          wrap.on("click", ".mcde-let-rip-bullet", (ev) => {
            const v = Number(ev.currentTarget.dataset.value ?? 0) || 0;
            const cur = Number(hidden.val() ?? 0) || 0;
            const next = (v <= cur) ? (v - 1) : v;
            setSelected(next);
          });
        }
      }, { width: 560 }).render(true);
    }

    // ----------------------
    // Attributes: "(+)" -> set auto=1
    // ----------------------
    html.on("click", ".mcde-attr-auto-add", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const wrap = ev.currentTarget.closest(".mcde-attrline");
      const attrKey = wrap?.dataset?.attr;
      if (!attrKey) return;

      await this.actor.update({ [`system.attributes.${attrKey}.auto`]: 1 });
    });

// ----------------------
// Weapons: Add / Edit / Delete
// ----------------------
html.find(".mcde-weapon-add").on("click", async (ev) => {
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
});

// ✅ AJOUTE ÇA ICI
html.find(".mcde-weapon-edit").on("click", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const li = ev.currentTarget.closest(".mcde-weapon");
  const itemId = li?.dataset?.itemId;
  const item = this.actor.items.get(itemId);
  if (!item) return;

  item.sheet.render(true);
});

html.find(".mcde-weapon-delete").on("click", async (ev) => {
  ev.preventDefault();
  ev.stopPropagation();

  const li = ev.currentTarget.closest(".mcde-weapon");
  const itemId = li?.dataset?.itemId;
  const item = this.actor.items.get(itemId);
  if (!item) return;

  await item.delete();
});

// ----------------------
// Weapons: Drop Quality onto a weapon row
// ----------------------
html.find(".mcde-weapon").on("dragover", (ev) => ev.preventDefault());

html.find(".mcde-weapon").on("drop", async (ev) => {
  ev.preventDefault();

  const weaponId = ev.currentTarget.dataset.itemId;
  const weapon = this.actor.items.get(weaponId);
  if (!weapon) return;

  let data;
  try {
    data = JSON.parse(ev.originalEvent?.dataTransfer?.getData("text/plain") ?? "{}");
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
});


        // ----------------------
    // Talents (Special Abilities): Add / Edit / Delete / Drop
    // ----------------------
    html.find(".mcde-talent-add").on("click", async (ev) => {
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
    });

    html.find(".mcde-talent-edit").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = ev.currentTarget.closest(".mcde-talent");
      const itemId = li?.dataset?.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;
      item.sheet.render(true);
    });

    html.find(".mcde-talent-delete").on("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const li = ev.currentTarget.closest(".mcde-talent");
      const itemId = li?.dataset?.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;
      await item.delete();
    });

    // Dropzone: accept a Talent item drop
    const tz = html.find(".mcde-talent-dropzone")[0];
    if (tz) {
      tz.addEventListener("dragover", (ev) => ev.preventDefault());
      tz.addEventListener("drop", async (ev) => {
        ev.preventDefault();

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
      <form class="mcde-roll-dialog">
        <p><strong>Dark Symmetry Pool:</strong> ${dspCurrent}</p>

        ${isHorde ? `
        <div class="form-group">
          <label>Horde/Squad free extra d20</label>
          <select name="freeExtra">
            ${Array.from({ length: freeExtraMax + 1 }, (_, i) => {
              const total = baseDice + i;
              return `<option value="${i}">${i} (Total ${total}d20)</option>`;
            }).join("")}
          </select>
          <small>Free dice (no DSP), up to ${hardMaxFree}d20 before purchases.</small>
        </div>
        ` : ``}

        <div class="form-group">
          <label>Buy extra d20 (1 DSP each, max ${paidExtraMax})</label>
          <select name="paidExtra">
            ${Array.from({ length: paidExtraMax + 1 }, (_, i) => `<option value="${i}">${i}</option>`).join("")}
          </select>
          <small>Total dice cap: ${hardMaxTotal}d20.</small>
        </div>

        <div class="form-group">
          <label>Attribute for TN</label>
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
        </div>

        ${isNemesis ? `
          <hr/>
          <div class="form-group">
            <label>
              <input type="checkbox" name="autoOne"/>
              Nemesis: AUTO-1 die (cost 3 DSP)
            </label>
          </div>
        ` : ``}

        <small>Base: ${baseDice}d20. Max total: ${hardMaxTotal}d20.</small>
      </form>
    `;

    const dlg = new Dialog({
      title,
      content,
      buttons: {
        roll: {
          label: "Roll",
          callback: async (html) => {
            const freeExtra = isHorde
              ? clampInt(html.find("[name='freeExtra']").val(), 0, freeExtraMax)
              : 0;

            const paidExtra = clampInt(html.find("[name='paidExtra']").val(), 0, paidExtraMax);
            const attrKey = html.find("[name='attrKey']").val() || defaultAttr;
            const autoOne = isNemesis && !!html.find("[name='autoOne']")[0]?.checked;

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
      default: "roll",
      render: (html) => {
        html.find("[name='attrKey']").val(defaultAttr);
        if (isHorde) html.find("[name='freeExtra']").val("0");
        html.find("[name='paidExtra']").val("0");
      }
    });

    dlg.render(true);
  }
}

/* =========================================================
   NEMESIS Sheet (Actor type: npc)
========================================================= */
class MCDENemesisSheet extends MCDENpcSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["mcde", "sheet", "actor", "nemesis"],
      template: `systems/${SYSTEM_ID}/templates/actor/nemesis-sheet.html`
    });
  }

  async getData() {
    const context = await super.getData();
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
  
  activateListeners(html) {
    super.activateListeners(html);

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

// Apply once on render
applyLocColors();

// Re-apply on user edits
html.on("input", ".mcde-loc-current, .mcde-loc-max", () => {
  applyLocColors();
});
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
html.on("change", ".mcde-wound-group .mcde-wound-max", async (ev) => {
  const group = ev.currentTarget.closest(".mcde-wound-group");
  const track = group?.dataset?.track;
  if (!track) return;
  await resizeTrack(track, ev.currentTarget.value);
});

// Click = toggle case
html.on("click", ".mcde-wound-group .mcde-wound-box", async (ev) => {
  const box = ev.currentTarget;
  const group = box.closest(".mcde-wound-group");
  const track = group?.dataset?.track;
  if (!track) return;

  const index = Number(box.dataset.index);
  await setProgress(track, index);
});

  }
}

/* =========================================================
   ARMOR Sheet
========================================================= */

class MCDEArmorSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["mcde", "sheet", "item", "armor"],
      template: `systems/${SYSTEM_ID}/templates/item/armor-sheet.html`,
      width: 560,
      height: 620,
      resizable: true
    });
  }

  async getData(options = {}) {
    const context = await super.getData(options);
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
    context.enriched.description = await TextEditor.enrichHTML(String(context.system.description ?? ""), {
      async: true,
      secrets: context.owner,
      documents: true,
      relativeTo: this.item.parent ?? this.item
    });

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Convert tags CSV -> array on change
    html.find('input[name="system.tagsCsv"]').on("change", async (ev) => {
      const raw = String(ev.currentTarget.value ?? "");
      const tags = raw
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      await this.item.update({ "system.tags": tags });
    });
  }
}


/* =========================================================
   QUALITY Sheet
========================================================= */

class MCDEQualitySheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["mcde", "sheet", "item", "quality"],
      template: `systems/${SYSTEM_ID}/templates/item/quality-sheet.html`,
      width: 520,
      height: 520
    });
  }

  async getData(options = {}) {
    const context = await super.getData(options);
    context.system = this.item.system ?? {};
    context.owner = this.item.isOwner;
    context.editable = this.isEditable;

    if (context.system.description === undefined || context.system.description === null) {
      context.system.description = "";
    }

    // Foundry expects enriched HTML for editor rendering
    context.enriched = context.enriched ?? {};
    const enriched = await TextEditor.enrichHTML(String(context.system.description ?? ""), {
      async: true,
      secrets: context.owner,
      documents: true,
      relativeTo: this.item.parent ?? this.item
    });

    context.enriched.description = Handlebars.helpers.dsify
    ? Handlebars.helpers.dsify(enriched)
    : enriched;

    return context;
  }
  
  activateListeners(html) {
    super.activateListeners(html);
  }
}

/* =========================================================
   TALENT Sheet
========================================================= */

class MCDETalentSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["mcde", "sheet", "item", "talent"],
      template: "systems/mutant-chronicles-diesel-edition/templates/item/talent-sheet.html",
      width: 520,
      height: 620,
      resizable: true
    });
  }

async getData(options = {}) {
  const context = await super.getData(options);
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
  const enriched = await TextEditor.enrichHTML(String(context.system.description ?? ""), {
    async: true,
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

}

/* =========================================================
   SPELL Sheet
========================================================= */

class MCDESpellSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["mcde", "sheet", "item", "spell"],
      template: `systems/${SYSTEM_ID}/templates/item/spell-sheet.html`,
      width: 520,
      height: 420,
      resizable: true
    });
  }

  async getData(options = {}) {
  const context = await super.getData(options);
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
const enrichedBase = await TextEditor.enrichHTML(String(context.system.baseEffect ?? ""), {
  async: true,
  secrets: context.owner,
  documents: true,
  relativeTo: this.item.parent ?? this.item
});

context.enriched.baseEffect = Handlebars.helpers.dsify
  ? Handlebars.helpers.dsify(enrichedBase)
  : enrichedBase;

// Momentum Spends
const enrichedMomentum = await TextEditor.enrichHTML(String(context.system.momentum ?? ""), {
  async: true,
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

class MCDEEquipmentSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["mcde", "sheet", "item", "equipment"],
      template: `systems/${SYSTEM_ID}/templates/item/equipment-sheet.html`,
      width: 560,
      height: 620,
      resizable: true
    });
  }

  async getData(options = {}) {
    const context = await super.getData(options);
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
    context.enriched.description = await TextEditor.enrichHTML(String(context.system.description ?? ""), {
      async: true,
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

class MCDEWeaponSheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["mcde", "sheet", "item", "weapon"],
      template: `systems/${SYSTEM_ID}/templates/item/weapon-sheet.html`,
      width: 520,
      height: 620
    });
  }

  async getData(options={}) {
    const context = await super.getData(options);
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
    context.enriched.description = await TextEditor.enrichHTML(context.system.description ?? "", {
      async: true,
      secrets: context.owner,
      documents: true,
      relativeTo: this.item.parent ?? this.item
    });

    return context;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // remove quality tag
    html.find(".mcde-quality-remove").on("click", async (ev) => {
      ev.preventDefault();
      const idx = Number(ev.currentTarget.dataset.index);
      const qualities = Array.isArray(this.item.system.qualities) ? [...this.item.system.qualities] : [];
      qualities.splice(idx, 1);
      await this.item.update({ "system.qualities": qualities });
    });

    // Drop Quality item onto dropzone
    const zone = html.find(".mcde-quality-dropzone")[0];
    if (zone) {
      zone.addEventListener("dragover", (ev) => ev.preventDefault());
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
      });
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

  console.log("MCDE | init OK");
});


Hooks.once("ready", () => {
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

    html.find("[data-action='reroll']").on("click", async (ev) => {
      ev.preventDefault();
      const el = ev.currentTarget;
      await handleReroll(message, el.dataset.kind, el.dataset.index);
    });

    html.find("[data-action='apply-damage']").on("click", async (ev) => {
      ev.preventDefault();
      await handleApplyDamage(message, state);
    });


  html.find("[data-action='chronicle-add1']").on("click", async (ev) => {
    ev.preventDefault();
    await handleChronicleAdd1(message);
  });
  
  html.find("[data-action='roll-damage']").on("click", async (ev) => {
    ev.preventDefault();
    await handleRollDamage(message);
  });

  html.find("[data-action='gain-momentum']").on("click", async (ev) => {
  ev.preventDefault();
  const amt = Number(ev.currentTarget.dataset.amount ?? 0) || 0;
  await handleGainMomentum(message, amt);
});
  });

  ensureTrackersUI();
  renderTrackersUI();

  console.log("MCDE | ready OK");
});