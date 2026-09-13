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

export class MCDEVehicleSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static SYSTEM_ID = "mutant-chronicles-diesel-edition";

  // Tabs are toggled manually (see _mcdeActivateTab in _onRender) rather
  // than via AppV2's static TABS system, to keep the existing single-file
  // template and minimize the diff during the AppV1 -> AppV2 conversion
  // (same approach as MCDENpcSheet).
  _mcdeActiveTab = "tactical";

  _mcdeActivateTab(tabId, root) {
    root = root ?? this.element;
    if (!root) return;
    this._mcdeActiveTab = tabId;
    root.querySelectorAll(".mcde-tabs [data-tab]").forEach(n => n.classList.toggle("active", n.dataset.tab === tabId));
    root.querySelectorAll(".mcde-tab-content > .tab[data-tab]").forEach(t => t.classList.toggle("active", t.dataset.tab === tabId));
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["mcde", "sheet", "actor", "vehicle", "themed", "theme-light"],
    position: { width: 860, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      // game.mcde.editImage is only populated once the init hook in
      // mcde.mjs runs; forwarding through a regular method (not an arrow
      // function) preserves the `this` binding Foundry applies when
      // dispatching the action.
      editImage(event, target) { return game.mcde.editImage.call(this, event, target); }
    }
  };

  static PARTS = {
    form: { template: "systems/mutant-chronicles-diesel-edition/templates/actor/vehicle-sheet.html" }
  };

  get title() {
    return this.document.name;
  }

  async _preRender(context, options) {
    await super._preRender(context, options);
    // See mcdeCaptureFocusedField in mcde.mjs: `submitOnChange: true` means
    // any "change" (including a number input's up/down-arrow spin, which
    // fires immediately, not on blur) re-renders the whole sheet and would
    // otherwise kick focus out of the field being edited.
    this._mcdeSavedFocus = game.mcde.captureFocus(this.element);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actor = this.actor;

    // Your usual aliases
    context.system = this.actor.system ?? {};
    context.locations = context.system.locations ?? {};

    // --- Vehicle Tags (qualities) ---
    context.system.vehicleTags = Array.isArray(context.system?.vehicleTags) ? context.system.vehicleTags : [];
    context.vehicleTags = context.system.vehicleTags;

    // --- Armaments (embedded weapons on the vehicle) ---
    const SYSTEM_ID = MCDEVehicleSheet.SYSTEM_ID;
    const weapons = (this.actor.items?.contents ?? Array.from(this.actor.items ?? []))
      .filter(i => i.type === "weapon")
      .slice()
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const armaments = [];
    for (const w of weapons) {
      const gunnerUuid =
        w.getFlag?.(SYSTEM_ID, "gunnerUuid") ??
        w.flags?.[SYSTEM_ID]?.gunnerUuid ??
        "";

      let gunner = null;
      if (gunnerUuid) {
        try {
          const a = await fromUuid(gunnerUuid);
          if (a?.documentName === "Actor") gunner = { uuid: gunnerUuid, name: a.name, img: a.img };
        } catch (e) {}
      }

      armaments.push({
        id: w.id,
        name: w.name,
        img: w.img,
        system: w.system ?? {},
        gunner
      });
    }
    context.armaments = armaments;

    // Resolve pilot actor for display (if any)
    context.crewPilot = null;
    const pilotUuid = context.system?.crew?.pilotUuid;
    if (pilotUuid) {
      try {
        const pilot = await fromUuid(pilotUuid);
        if (pilot?.documentName === "Actor") {
          context.crewPilot = { name: pilot.name, img: pilot.img, uuid: pilotUuid };
        }
      } catch (e) {
        // ignore bad uuid
      }
    }

    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.isEditable) return;

    const root = this.element;

    // Listeners are rebound on every render — an AbortController guards
    // against stacking duplicate handlers across re-renders.
    this._mcdeRenderAbort?.abort();
    this._mcdeRenderAbort = new AbortController();
    const { signal } = this._mcdeRenderAbort;

  const initSorting = () => {
    const sorter = globalThis.enableMcdeItemSortingNative;
    if (typeof sorter === "function") {
      sorter(this.actor, root, "ul.mcde-veh-armaments-list", "li.item[data-item-id]");
    } else {
      console.warn("MCDE | VehicleSheet | enableMcdeItemSortingNative not available");
    }
  };

  // init now
  initSorting();

  // Re-apply whichever tab was active before this render, and wire up
  // manual tab switching (re-init sorting since a tab swap changes the
  // visible DOM).
  this._mcdeActivateTab(this._mcdeActiveTab, root);

  // Restore focus captured in _preRender — must run AFTER _mcdeActivateTab:
  // until the active tab's `.active` class is re-applied, that tab's
  // container is `display:none`, and browsers refuse to focus an element
  // that isn't laid out/visible.
  game.mcde.restoreFocus(root, this._mcdeSavedFocus);

  root.querySelectorAll(".mcde-tabs [data-tab]").forEach((navBtn) => {
    navBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      this._mcdeActivateTab(navBtn.dataset.tab, root);
      setTimeout(initSorting, 0);
    }, { signal });
  });

    // Click location boxes
    root.addEventListener("click", async (ev) => {
      const el = ev.target.closest(".mcde-box");
      if (!el) return;
      ev.preventDefault();

      const locKey = el.dataset.loc;
      const track = el.dataset.track;
      const idx = Number(el.dataset.idx ?? 0) || 0;

      const current = Number(
        this.actor.system?.locations?.[locKey]?.[track] ?? 0
      );

      let next;

      // Click on the current filled value → reset to 0
      if (idx === current) {
        next = 0;
      }
      // Click below current → reduce
      else if (idx < current) {
        next = idx;
      }
      // Click above current → increase
      else {
        next = idx;
      }

      await this.actor.update({
        [`system.locations.${locKey}.${track}`]: next
      });
    }, { signal });

  // ========================================
// Reload bandolier (Vehicle sheet)
// ========================================
root.addEventListener("click", async (ev) => {
  const bullet = ev.target.closest(".mcde-reload-bullet, .mcde-reload-bandolier img");
  if (!bullet) return;
  ev.preventDefault();
  ev.stopPropagation();

  const bandolier =
    bullet.closest(".mcde-reload-bandolier") ||
    bullet.parentElement?.closest?.(".mcde-reload-bandolier");

  if (!bandolier) return;

  const value = Number(bullet.dataset?.value ?? bandolier.dataset?.value ?? 0);
  if (!Number.isFinite(value) || value <= 0) return;

  const itemId =
    bandolier.dataset.itemId ||
    bandolier.dataset.itemid ||
    bandolier.getAttribute("data-item-id") ||
    bandolier.getAttribute("data-itemid");

  if (!itemId) return;

  const item = this.actor?.items?.get(itemId);
  if (!item) return;

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
}, { signal });

    // Pilot test button
    root.addEventListener("click", (ev) => {
      if (!ev.target.closest("[data-action='pilot-test']")) return;
      ev.preventDefault();
      this._openPilotTestDialog();
    }, { signal });

    // Drop zone for pilot
const dropEl = root?.querySelector(".mcde-pilot-drop[data-drop='pilot']");
if (dropEl) {
  dropEl.addEventListener("dragover", (ev) => ev.preventDefault(), { signal });
  dropEl.addEventListener("drop", (ev) => this._onDropPilot(ev), { signal });
}

    // Clear pilot
    root.addEventListener("click", async (ev) => {
      if (!ev.target.closest("[data-action='clear-pilot']")) return;
      ev.preventDefault();
      await this.actor.update({ "system.crew.pilotUuid": "" });
    }, { signal });

    // Impact damage button
root.addEventListener("click", async (ev) => {
  if (!ev.target.closest("[data-action='roll-impact-damage']")) return;
  ev.preventDefault();
  ev.stopPropagation();
  console.log("MCDE | roll impact damage clicked");
  try {
    await this._rollImpactDamage();
  } catch (err) {
    console.error("MCDE | roll impact damage failed", err);
    ui.notifications?.error?.("Impact Damage roll failed — see console (F12).");
  }
}, { signal });


    // =========================================================
// Vehicle Tags (drop Quality) + remove + tooltip
// =========================================================
const tagsDrop = root?.querySelector(".mcde-vehicle-tags-dropzone");
if (tagsDrop) {
  tagsDrop.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  }, { signal });
  tagsDrop.addEventListener("drop", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation?.();
    this._onDropVehicleTag(ev);
  }, { signal });
}

// ===============================
// Vehicle Tags — Rich tooltip (rust)
// ===============================
(async () => {
  const tagEls = root?.querySelectorAll?.(".mcde-vehicle-tags-dropzone .mcde-tag") ?? [];
  for (const el of tagEls) {
    const raw = el.dataset.mcdeDesc ?? "";
    if (!raw) continue;
    if (el.dataset.tooltipReady === "1") continue;
    el.dataset.tooltipReady = "1";

    let enriched = "";
    try {
      enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, { async: true });
    } catch (e) {
      console.warn("MCDE | Vehicle tag tooltip enrich failed", e);
      enriched = raw;
    }

    el.dataset.tooltip = enriched;
  }
})();

root.querySelectorAll(".mcde-vehicle-tags-dropzone .mcde-tag").forEach((el) => {
  el.addEventListener("mouseenter", (ev) => {
    const text = ev.currentTarget?.dataset?.tooltip;
    if (!text) return;
    ui?.tooltip?.activate?.(ev.currentTarget, { text });
  }, { signal });
  el.addEventListener("mouseleave", () => {
    ui?.tooltip?.deactivate?.();
  }, { signal });
});

// Remove vehicle tag
root.addEventListener("click", async (ev) => {
  const target = ev.target.closest("[data-action='vehicle-tag-remove']");
  if (!target) return;
  ev.preventDefault();
  ev.stopPropagation();

  const idx = Number(target.dataset.index ?? -1);
  const cur = Array.isArray(this.actor.system?.vehicleTags) ? [...this.actor.system.vehicleTags] : [];
  if (idx < 0 || idx >= cur.length) return;

  cur.splice(idx, 1);
  await this.actor.update({ "system.vehicleTags": cur });
  this.render(false);
}, { signal });

    // =========================================================
    // Armaments (drop Weapon) + edit/delete + attack
    // =========================================================
    const armDrop = root?.querySelector(".mcde-veh-armaments-dropzone");
    if (armDrop) {
      armDrop.addEventListener("dragover", (ev) => ev.preventDefault(), { signal });
      armDrop.addEventListener("drop", (ev) => this._onDropArmamentWeapon(ev), { signal });
    }

    root.addEventListener("click", (ev) => {
      const target = ev.target.closest("[data-action='veh-weapon-edit']");
      if (!target) return;
      ev.preventDefault(); ev.stopPropagation();
      const itemId = target.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (item) item.sheet.render(true);
    }, { signal });

    root.addEventListener("click", async (ev) => {
      const target = ev.target.closest("[data-action='veh-weapon-delete']");
      if (!target) return;
      ev.preventDefault(); ev.stopPropagation();
      const itemId = target.dataset.itemId;
      const item = this.actor.items.get(itemId);
      if (!item) return;
      await item.delete();
      this.render(false);
    }, { signal });

    // Gunner drop per weapon row
    root.querySelectorAll(".mcde-gunner-drop[data-drop='gunner']").forEach((el) => {
      el.addEventListener("dragover", (ev) => ev.preventDefault(), { signal });
      el.addEventListener("drop", (ev) => this._onDropGunnerForWeapon(ev), { signal });
    });

    root.addEventListener("click", async (ev) => {
      const target = ev.target.closest("[data-action='veh-gunner-clear']");
      if (!target) return;
      ev.preventDefault(); ev.stopPropagation();
      const itemId = target.dataset.itemId;
      const w = this.actor.items.get(itemId);
      if (!w) return;
      await w.unsetFlag(MCDEVehicleSheet.SYSTEM_ID, "gunnerUuid");
      this.render(false);
    }, { signal });

    // Click weapon attack (uses gunner stats, weapon from vehicle)
    root.addEventListener("click", async (ev) => {
      const target = ev.target.closest("[data-action='veh-weapon-attack']");
      if (!target) return;
      ev.preventDefault(); ev.stopPropagation();
      const itemId = target.dataset.itemId;
      const weapon = this.actor.items.get(itemId);
      if (!weapon) return;
      await this._openVehicleWeaponAttackDialog(weapon);
    }, { signal });

    // Add Weapon To Armaments (+)
root.addEventListener("click", async (ev) => {
  if (!ev.target.closest("[data-action='veh-weapon-create']")) return;
  ev.preventDefault();
  ev.stopPropagation();

  const created = await this.actor.createEmbeddedDocuments("Item", [{
    name: "New Weapon",
    type: "weapon",
    img: "icons/svg/sword.svg",
    system: {
      weaponType: "ranged",
      restriction: 0,
      cost: 0,
      description: "",
      tags: [],
      damage: {
        base: 1,
        dsy: 1,
        flatBonus: 0
      },
      stats: {
        range: "Close",
        mode: "Semi-Automatic",
        enc: 0,
        size: "-",
        reliability: 0
      },
      qualities: [],
      equipped: false,
      reload: {
        max: 10,
        current: 10
      },
      reloadUsed: 10
    }
  }]);

  const item = created?.[0];
  if (item) item.sheet?.render(true);
}, { signal });

  // Fuel Boxes (toggle, and use fuel.cur consistently)
  root.addEventListener("click", async (ev) => {
    const el = ev.target.closest(".mcde-fuel-box");
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();

    const idx = Number(el.dataset.idx ?? 0) || 0;

    const fuel = this.actor.system?.fuel ?? {};
    const current = Number(fuel.cur ?? fuel.value ?? 0) || 0; // tolère l'ancien champ si encore présent
    const max = Number(fuel.max ?? 0) || 0;

    // Re-clic sur la valeur courante => reset à 0, sinon set idx
    let next = (idx === current) ? 0 : idx;
    // Clamp
    if (max > 0) next = Math.min(next, max);
    next = Math.max(0, next);

    await this.actor.update({ "system.fuel.cur": next }, { render: true });
    this.render(false);
  }, { signal });

// Clamp Fuel when inputs change
root.addEventListener("change", async (ev) => {
  if (!ev.target.closest("input[name='system.fuel.cur'], input[name='system.fuel.max']")) return;
  if (!this.actor?.isOwner) return;

  const fuel = this.actor.system?.fuel ?? {};
  let cur = Number(fuel.cur ?? 0) || 0;
  let max = Number(fuel.max ?? 0) || 0;

  // Sanitize
  max = Math.max(0, max);
  cur = Math.max(0, cur);

  // Clamp cur to max
  if (cur > max) cur = max;

  await this.actor.update({
    "system.fuel.max": max,
    "system.fuel.cur": cur
  }, { render: true });

  this.render(false);
}, { signal });

// Loc Car Doll Boxes (stretched segments): toggle to 0 when clicking current value
  root.addEventListener("click", async (ev) => {
    const el = ev.target.closest(".mcde-stretch-seg");
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();

    if (!this.actor?.isOwner) return;

    const locKey = el.dataset.loc;
    const track = el.dataset.track;
    const idx = Number(el.dataset.idx ?? 0) || 0;

    const current = Number(this.actor.system?.locations?.[locKey]?.[track] ?? 0) || 0;

    // SHIFT = reset hard à 0 (optionnel mais pratique),
    // sinon toggle: reclic valeur courante => 0, sinon => idx
    const next = ev.shiftKey ? 0 : ((idx === current) ? 0 : idx);
    const path = `system.locations.${locKey}.${track}`;

    await this.actor.update({ [path]: next }, { render: true });
    this.render(false);
  }, { signal });
  }

  async _rollImpactDamage() {
  const vehicle = this.actor;

  const base = Number(vehicle.system?.impactdamage?.base ?? 0) || 0;
  const dsd  = Math.max(0, Number(vehicle.system?.impactdamage?.dsy ?? 0) || 0);

  // Optionnel: petit garde-fou si tout est à 0
  if (base <= 0 && dsd <= 0) {
    ui.notifications?.warn?.("Impact Damage is 0 (Base and DSD).");
    return;
  }

  // Réutilise ton pipeline Damage card + DSD faces + location d20
  console.log("MCDE | impact payload", { base, dsd, hasApi: !!game.mcde?.rollDamage });
  await game.mcde.rollDamage({
    actor: vehicle,
    weaponName: `Impact Damage — ${vehicle.name ?? "Vehicle"}`,
    mode: "impact",
    dsdCount: dsd,
    flatBonus: base,
    attackData: {
      kind: "impact",
      vehicleUuid: vehicle.uuid
    }
  });
}

  async _onDropPilot(ev) {
    ev.preventDefault();

    let data;
    try {
      data = JSON.parse(ev.dataTransfer.getData("text/plain"));
    } catch (e) {
      return;
    }

    if (data?.type !== "Actor" || !data.uuid) return;

    const doc = await fromUuid(data.uuid);
    if (!doc || doc.documentName !== "Actor") return;

    await this.actor.update({ "system.crew.pilotUuid": doc.uuid });
  }

  // =========================================================
  // Drops
  // =========================================================
  async _onDropVehicleTag(ev) {
    ev.preventDefault();
   ev.stopPropagation();

    let data;
    try { data = JSON.parse(ev.dataTransfer?.getData("text/plain") ?? "{}"); }
    catch { return; }

    let doc = null;
    try {
      if (data?.type === "Item" && data?.id) doc = game.items?.get?.(data.id) ?? null;
      if (!doc && data?.uuid) doc = await fromUuid(data.uuid);
    } catch (e) {}

    if (!doc || doc.type !== "quality") return;

    const cur = Array.isArray(this.actor.system?.vehicleTags) ? [...this.actor.system.vehicleTags] : [];
    const uuid = doc.uuid ?? "";
    if (uuid && cur.some(t => t.uuid === uuid)) return;

    cur.push({
      uuid,
      name: doc.name,
      description: String(doc.system?.description ?? doc.system?.notes ?? "")
    });

    await this.actor.update({ "system.vehicleTags": cur });
    this.render(false);
  }

  async _onDropArmamentWeapon(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    let data;
    try { data = JSON.parse(ev.dataTransfer?.getData("text/plain") ?? "{}"); }
    catch { return; }

    let doc = null;
    try {
      if (data?.uuid) doc = await fromUuid(data.uuid);
      else if (data?.type === "Item" && data?.id) doc = game.items?.get?.(data.id) ?? null;
    } catch (e) {}

    if (!doc || doc.type !== "weapon") return;

    // Prevent duplicates (same sourceId/uuid)
    const sourceId = doc.uuid ?? doc.flags?.core?.sourceId ?? "";
    if (sourceId) {
      const exists = this.actor.items.some(i =>
        i.type === "weapon" &&
        ((i.flags?.core?.sourceId === sourceId) || (i.uuid === sourceId) || (i.getFlag?.(MCDEVehicleSheet.SYSTEM_ID,"sourceUuid") === sourceId))
      );
      if (exists) return;
    }

    await this.actor.createEmbeddedDocuments("Item", [{
      name: doc.name,
      type: "weapon",
      img: doc.img,
      system: foundry.utils.duplicate(doc.system ?? {}),
      flags: {
        ...foundry.utils.duplicate(doc.flags ?? {}),
        [MCDEVehicleSheet.SYSTEM_ID]: { sourceUuid: (doc.uuid ?? "") }
      }
    }]);

    this.render(false);
  }

  async _onDropGunnerForWeapon(ev) {
    ev.preventDefault();
    ev.stopPropagation();

    const dropEl = ev.currentTarget;
    const weaponId = dropEl?.dataset?.weaponId;
    if (!weaponId) return;

    let data;
    try { data = JSON.parse(ev.dataTransfer?.getData("text/plain") ?? "{}"); }
    catch { return; }

    if (data?.type !== "Actor" || !data?.uuid) return;
    const actor = await fromUuid(data.uuid);
    if (!actor || actor.documentName !== "Actor") return;

    const weapon = this.actor.items.get(weaponId);
    if (!weapon) return;

    await weapon.setFlag(MCDEVehicleSheet.SYSTEM_ID, "gunnerUuid", actor.uuid);
    this.render(false);
  }

  // =========================================================
  // Vehicle weapon attack (gunner stats, vehicle weapon)
  // =========================================================
  async _openVehicleWeaponAttackDialog(weapon) {
    const SYSTEM_ID = MCDEVehicleSheet.SYSTEM_ID;

    // Resolve gunner
    const gunnerUuid =
      weapon.getFlag?.(SYSTEM_ID, "gunnerUuid") ??
      weapon.flags?.[SYSTEM_ID]?.gunnerUuid ??
      "";

    if (!gunnerUuid) {
      ui.notifications?.warn?.("No gunner assigned to this weapon.");
      return;
    }

    const gunner = await fromUuid(gunnerUuid);
    if (!gunner || gunner.documentName !== "Actor") {
      ui.notifications?.warn?.("Invalid gunner reference.");
     return;
    }

    // Same basics as “normal attack”
    const actor = gunner;
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
const isRanged = (rule.dmgBonus === "ranged"); // compat pour le reste du code

const attrKey = rule.attr;
const skillKey = rule.skill;

    const attrVal = Number(actor.system?.attributes?.[attrKey]?.value ?? 0) || 0;
    const exp = Number(actor.system?.skills?.[skillKey]?.expertise ?? 0) || 0;
    const foc = Number(actor.system?.skills?.[skillKey]?.focus ?? 0) || 0;
    const tn = attrVal + exp;
    const focus = foc;

    const wName = weapon.name ?? "Weapon";
    const wMode = String(weapon.system?.stats?.mode ?? "");
    const qualities = Array.isArray(weapon.system?.qualities) ? weapon.system.qualities : [];

    const hasUnwieldy =
      String(weapon.system?.stats?.size ?? "").toLowerCase() === "unwieldy" ||
      qualities.some(q => String(q?.name ?? "").toLowerCase() === "unwieldy");

    const canLetRip = isRanged && wMode && wMode.toLowerCase() !== "munition";
    const baseLetRipMax =
      !canLetRip ? 0 :
      (wMode.toLowerCase() === "semi-automatic" ? 1 :
       wMode.toLowerCase() === "burst" ? 2 :
       wMode.toLowerCase() === "automatic" ? 3 : 0);

    const getDSP = () => Number(game.settings.get(SYSTEM_ID, "darkSymmetryPool") ?? 0) || 0;
    const setDSP = (v) => game.settings.set(SYSTEM_ID, "darkSymmetryPool", Number(v) || 0);

    const content = `
      <form class="mcde-roll-dialog" style="display:flex; flex-direction:column; gap:8px;">
        <div>
          <div class="mcde-dialog-heading">
            Vehicle Weapon Attack — ${foundry.utils.escapeHTML(wName)}
          </div>
          <div class="mcde-dialog-subheading">
            Gunner: <strong>${foundry.utils.escapeHTML(actor.name ?? "Gunner")}</strong> • TN <strong>${tn}</strong> • Focus <strong>${focus}</strong>
          </div>
        </div>

        <hr/>

        <div class="mcde-dialog-section-title">Modifiers</div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span>Buy extra d20 (1 DSP each)</span>
            <select name="extraDice">
              <option value="0" selected>0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>

          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span>Surprise (+1d20)</span>
            <input type="checkbox" name="surprise">
          </label>

          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span>Exploit Weakness (+2d20)</span>
            <input type="checkbox" name="exploit">
          </label>

          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span>Use Chronicle Point (adds 1 die set to 1)</span>
            <input type="checkbox" name="useChronicle" ${chronicleCurrent > 0 ? "" : "disabled"}>
          </label>
        </div>

        ${hasUnwieldy ? `
          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span>Brace (avoid Unwieldy +2 Difficulty)</span>
            <input type="checkbox" name="brace">
          </label>
        ` : ``}

        ${canLetRip ? `
          <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <span>Let Rip</span>
            <select name="letRip">
              ${Array.from({length: baseLetRipMax + 1}, (_,i)=>`<option value="${i}" ${i===0?"selected":""}>${i}</option>`).join("")}
            </select>
          </label>
        ` : ``}
      </form>
    `;

    game.mcde.dialogV2({
      title: "Attack",
      content,
      width: 560,
      extraClasses: ["mcde-attack-dialog"],
      defaultAction: "roll",
      buttons: {
        roll: {
          label: "Roll",
          callback: async (root) => {
            const extraDice = Number(root.querySelector("[name='extraDice']")?.value ?? 0) || 0;
            const surprise = !!root.querySelector("[name='surprise']")?.checked;
            const exploit = !!root.querySelector("[name='exploit']")?.checked;
            const brace = !!root.querySelector("[name='brace']")?.checked;
            const useChronicle = !!root.querySelector("[name='useChronicle']")?.checked;
            const letRip = Number(root.querySelector("[name='letRip']")?.value ?? 0) || 0;

            // Pay DSP cost for bought dice (same rule as usual)
            if (extraDice > 0) {
              const cur = await getDSP();
              await setDSP(cur + extraDice);
            }

            // Spend ammo for Let Rip (weapon belongs to vehicle)
            if (isRanged && letRip > 0) {
              const curAmmo = Number(weapon.system?.reload?.current ?? weapon.system?.reloadUsed ?? 0) || 0;
              if (curAmmo < letRip) {
                ui.notifications?.warn?.("Not enough ammo for Let Rip.");
                return;
              }
              const newAmmo = curAmmo - letRip;
              await weapon.update({
                "system.reload.current": newAmmo,
                "system.reloadUsed": newAmmo
              });
            }

            // Spend Chronicle (gunner)
            if (useChronicle) {
              const cpCur = Number(actor.system?.chronicle_points?.current ?? 0) || 0;
              if (cpCur <= 0) {
                ui.notifications?.warn?.("Not enough Chronicle Points.");
                return;
              }
              await actor.update({ "system.chronicle_points.current": cpCur - 1 });
            }

            // Dice count (base 2 like your standard dialog)
            let diceCount = 2;
            diceCount += Math.max(0, Math.min(3, extraDice));
            if (exploit) diceCount += 2;
            if (surprise) diceCount += 1;
            if (letRip > 0) diceCount += letRip;

            // Difficulty (unwieldy)
            let difficulty = 1;
            if (isRanged && hasUnwieldy && !brace) difficulty += 2;

            // Damage payload (precomputed so chat damage roll works even though actor != weapon owner)
            const mode = isRanged ? "ranged" : "melee";
            const dmgBonus = getDamageBonus(actor, mode); // bonus EN DÉS (DSD)
            const flatBonus =
              (Number(weapon.system?.damage?.base ?? 0) || 0) +
              (Number(weapon.system?.damage?.flatBonus ?? 0) || 0);

            // DSD: weapon + LetRip dice (vehicle attacks still use weapon profile)
            const dsdCount =
              (Number(weapon.system?.damage?.dsy ?? 0) || 0) +
              (Number(dmgBonus) || 0) +
              (letRip > 0 ? letRip : 0) +
              (exploit ? 2 : 0);

            await game.mcde.rollTest({
              actor,
              label: `${wName} Attack`,
              tn,
              focus,
              diceCount,
              useChroniclePoint: false, // we already paid + subtracted; keep rollTest clean
              autoSuccesses: Number(actor.system?.attributes?.[attrKey]?.auto ?? 0) || 0,
              difficulty,
              attackData: {
                kind: "vehicle-weapon",
                vehicleUuid: this.actor.uuid,
                weaponUuid: weapon.uuid,
                weaponName: wName,
                mode,
                dsdCount,
                flatBonus,
                qualities: (Array.isArray(weapon.system?.qualities) ? weapon.system.qualities : [])
                  .map(q => ({ name: String(q?.name ?? "").trim(), description: String(q?.description ?? "").trim() }))
                  .filter(q => q.name)
              }
            });
          }
        },
        cancel: { label: "Cancel" }
      }
    });
  }


  async _openPilotTestDialog() {
    const SYSTEM_ID = "mutant-chronicles-diesel-edition";

    const vehicle = this.actor;
    const man = Number(vehicle.system?.combatmanoeuvrability ?? 0) || 0;

    // Resolve pilot actor
let pc = null;

// 1) If a pilot is assigned to the vehicle → use that
const pilotUuid = vehicle.system?.crew?.pilotUuid;
if (pilotUuid) {
  try {
    const pilotDoc = await fromUuid(pilotUuid);
    if (pilotDoc?.documentName === "Actor") {
      pc = pilotDoc;
    }
  } catch (e) {
    console.warn("MCDE | Invalid pilot UUID", e);
  }
}

// 2) Fallback to user character
if (!pc) {
  pc = game.user.character;
}

// 3) Still nothing → abort
if (!pc) {
  ui.notifications?.warn?.("No pilot assigned and no user character available.");
  return;
}

    const chronicleCurrent = Number(pc.system?.chronicle_points?.current ?? 0) || 0;

    const getDSP = () => Number(game.settings.get(SYSTEM_ID, "darkSymmetryPool") ?? 0) || 0;
    const setDSP = (v) => game.settings.set(SYSTEM_ID, "darkSymmetryPool", Number(v) || 0);

    const content = `
      <form class="mcde-roll-dialog" style="display:flex; flex-direction:column; gap:8px;">
        <div>
          <div class="mcde-dialog-heading">Pilot Test — ${foundry.utils.escapeHTML(vehicle.name ?? "Vehicle")}</div>
          <div class="mcde-dialog-subheading">
            Manoeuvrability bonus: <strong>+${man}d20</strong>
          </div>
        </div>

        <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <span>Mode</span>
          <select name="mode">
            <option value="ta" selected>Terrestrial / Aerial</option>
            <option value="space">Space</option>
          </select>
        </label>

        <hr/>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          <div>
            <div class="mcde-dialog-section-title">Modifiers</div>

            <label style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
              <span>Buy extra d20 (1 DSP each, max 3)</span>
              <select name="extraDice">
                <option value="0" selected>0</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
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

    game.mcde.dialogV2({
      title: "Pilot Test",
      content,
      width: 520,
      extraClasses: ["mcde-skilltest-dialog"],
      defaultAction: "roll",
      buttons: {
        roll: {
          label: "Roll",
          callback: async (root) => {
            const mode = String(root.querySelector("[name='mode']")?.value ?? "ta");
            const extraDice = Math.max(0, Math.min(3, Number(root.querySelector("[name='extraDice']")?.value) || 0));
            const useChronicle = !!root.querySelector("[name='useChronicle']")?.checked;
            const difficulty = Number(root.querySelector("[name='difficulty']")?.value);
            const diff = Number.isFinite(difficulty) ? difficulty : 1;

            const attrKey = "coordination";
            const skillKey = (mode === "space") ? "space" : "pilot";

            const attrVal = Number(pc.system?.attributes?.[attrKey]?.value ?? 0) || 0;
            const sk = pc.system?.skills?.[skillKey];
            if (!sk) {
              ui.notifications?.warn?.(`Character has no skill "${skillKey}".`);
              return;
            }
            const exp = Number(sk.expertise ?? 0) || 0;
            const foc = Number(sk.focus ?? 0) || 0;

            const tn = attrVal + exp;
            const focus = foc;

            let diceCount = 2 + extraDice + man;
            if (diceCount < 2) diceCount = 2;

            if (useChronicle) {
              const cur = Number(pc.system?.chronicle_points?.current ?? 0) || 0;
              if (cur <= 0) {
                ui.notifications?.warn?.("Not enough Chronicle Points.");
                return;
              }
              await pc.update({ "system.chronicle_points.current": cur - 1 });
            }

            if (extraDice > 0) {
              const dspNow = getDSP();
              await setDSP(dspNow + extraDice);
            }

            const label = `${pc.name} — ${mode === "space" ? "Space" : "Pilot"} + Coordination (Vehicle Manoeuvrability +${man}d20)`;

            await game.mcde.rollTest({
              actor: pc,
              label,
              tn,
              focus,
              diceCount,
              useChroniclePoint: useChronicle,
              difficulty: diff
            });
          }
        },
        cancel: { label: "Cancel" }
      }
    });
  }
}