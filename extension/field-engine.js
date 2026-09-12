// JobPilot field engine — builds a text signature per form control and maps it
// to profile/kit values. Label-signature approach adapted from JobNavigator
// (github.com/vesaias/JobNavigator, MIT — see LICENSE-THIRD-PARTY).
(function () {
  "use strict";

  // Every label source we can find for a control, joined into one signature.
  function labelText(el) {
    const parts = [];
    if (el.id) {
      const forLbl = document.querySelector(
        `label[for="${CSS.escape(el.id)}"]`
      );
      if (forLbl) parts.push(forLbl.textContent);
    }
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) parts.push(aria);
    const alby = el.getAttribute && el.getAttribute("aria-labelledby");
    if (alby)
      alby.split(/\s+/).forEach((id) => {
        const n = document.getElementById(id);
        if (n) parts.push(n.textContent);
      });
    const anc = el.closest && el.closest("label");
    if (anc) parts.push(anc.textContent);
    if (el.name) parts.push(el.name);
    if (el.id) parts.push(el.id);
    if (el.placeholder) parts.push(el.placeholder);
    // Workday: question text lives in the formField container; the
    // data-automation-id is itself a strong signal.
    const wd = el.closest && el.closest("[data-automation-id]");
    if (wd) parts.push(wd.getAttribute("data-automation-id"));
    const fs = el.closest && el.closest("fieldset");
    if (fs) {
      const lg = fs.querySelector("legend");
      if (lg) parts.push(lg.textContent);
    }
    return parts.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  }

  // Canonical field → signature keywords. Order matters (first match wins).
  const FIELD_RULES = [
    ["first_name", /first\s?name|given name|fname/],
    ["last_name", /last\s?name|family name|surname|lname/],
    ["full_name", /\bfull name\b|\byour name\b|^name$/],
    ["email", /e-?mail/],
    ["phone", /phone|mobile|contact number|tel\b/],
    ["linkedin", /linkedin/],
    ["website", /website|portfolio|personal site|url/],
    ["location", /current (city|location)|city\b|location\b/],
    ["country", /country/],
    ["resume", /resume|cv\b|curriculum/],
    ["cover_letter", /cover letter|motivation/],
    ["salary", /salary|compensation|ctc|expected pay|pay expectation/],
    ["notice_period", /notice period|when can you (start|join)|start date|availability/],
    [
      "work_auth",
      /authori[sz]ed to work|work authori[sz]ation|legally (able|allowed) to work|right to work|eligible to work/,
    ],
    [
      "sponsorship",
      /sponsorship|require .{0,15}visa|need .{0,15}visa|h-?1b/,
    ],
    ["gender", /gender/],
    ["veteran", /veteran/],
    ["disability", /disabilit/],
    ["ethnicity", /ethnicit|race\b|hispanic|latino/],
    ["how_heard", /how did you hear|referral source|where did you (hear|find)/],
    ["years_experience", /years? of (relevant )?experience/],
  ];

  function classify(el) {
    const sig = labelText(el);
    if (!sig) return null;
    for (const [field, re] of FIELD_RULES) if (re.test(sig)) return field;
    return null;
  }

  function collectControls(root = document) {
    const sel =
      'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, [role="combobox"], [contenteditable="true"]';
    return Array.from(root.querySelectorAll(sel)).filter(
      (el) => el.offsetParent !== null || el.type === "file"
    );
  }

  // Map the page: control → canonical field (or null → unknown, sent to AI fallback)
  function mapPage(root) {
    return collectControls(root).map((el) => ({
      el,
      field: classify(el),
      signature: labelText(el).slice(0, 160),
      kind:
        el.tagName === "SELECT"
          ? "select"
          : el.type === "file"
          ? "file"
          : el.type === "radio" || el.type === "checkbox"
          ? el.type
          : el.tagName === "TEXTAREA" || el.isContentEditable
          ? "textarea"
          : "text",
    }));
  }

  // Set value in a framework-friendly way (React/Vue listen to input events)
  function setValue(el, value) {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.style.outline = "2px solid #175C43";
    el.style.outlineOffset = "1px";
  }

  function setSelect(el, value) {
    const target = String(value).toLowerCase();
    const opt = Array.from(el.options).find(
      (o) =>
        o.value.toLowerCase() === target ||
        o.textContent.toLowerCase().includes(target)
    );
    if (opt) {
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.style.outline = "2px solid #175C43";
      return true;
    }
    return false;
  }

  window.__jobpilotEngine = { mapPage, setValue, setSelect, classify, labelText };
})();
