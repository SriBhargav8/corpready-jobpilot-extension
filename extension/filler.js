// JobPilot filler — pulls profile + application kit, fills every mapped field,
// highlights what it touched, and NEVER presses submit (product law, Spec §5).
(function () {
  "use strict";
  const E = window.__jobpilotEngine;

  function detectAts() {
    const h = location.hostname;
    if (h.includes("greenhouse.io")) return "greenhouse";
    if (h.includes("lever.co")) return "lever";
    if (h.includes("ashbyhq.com")) return "ashby";
    if (h.includes("myworkdayjobs.com")) return "workday";
    if (h.includes("linkedin.com")) return "linkedin";
    return "generic";
  }

  // Values resolved from profile + kit. Unknown-field answers come from the
  // kit's screening_answers or the AI fallback (background.js → edge function).
  function valueFor(field, profile, kit) {
    const wa = profile.work_authorization || {};
    switch (field) {
      case "first_name":
        return (profile.full_name || "").split(" ")[0];
      case "last_name":
        return (profile.full_name || "").split(" ").slice(1).join(" ");
      case "full_name":
        return profile.full_name;
      case "email":
        return profile.email;
      case "phone":
        return profile.phone;
      case "linkedin":
        return profile.linkedin_url;
      case "location":
        return profile.city;
      case "country":
        return profile.country;
      case "cover_letter":
        return kit?.cover_letter;
      case "salary":
        return profile.expected_salary;
      case "notice_period":
        return profile.notice_period || "Immediately available";
      case "work_auth":
        return wa.authorized_in_target ? "Yes" : "No";
      case "sponsorship":
        return wa.needs_sponsorship ? "Yes" : "No";
      case "years_experience":
        return profile.years_experience;
      case "how_heard":
        return "Company careers page";
      default:
        return null; // resume upload + EEO fields handled separately
    }
  }

  async function fill() {
    const { profile, kit } = await chrome.storage.local
      .get(["profile", "kit"])
      .then((s) => ({ profile: s.profile || {}, kit: s.kit || null }));

    const ats = detectAts();
    const mapped = E.mapPage(document);
    const report = { ats, filled: 0, skipped: [], unknown: [] };

    for (const m of mapped) {
      // EEO/self-ID fields: only fill if user opted in and provided values
      if (["gender", "veteran", "disability", "ethnicity"].includes(m.field)) {
        const v = profile.self_id?.[m.field];
        if (v && m.kind === "select" && E.setSelect(m.el, v)) report.filled++;
        else report.skipped.push(m.field);
        continue;
      }
      if (m.field === "resume") {
        report.skipped.push("resume (attach tailored PDF from popup)");
        continue;
      }
      const v = m.field ? valueFor(m.field, profile, kit) : null;
      if (v == null) {
        if (!m.field) report.unknown.push(m.signature);
        continue;
      }
      if (m.kind === "select") {
        if (E.setSelect(m.el, v)) report.filled++;
        else report.skipped.push(m.field);
      } else if (m.kind === "radio" || m.kind === "checkbox") {
        const yes = /^y(es)?$/i.test(String(v));
        const sig = E.labelText(m.el);
        if ((yes && /\byes\b/.test(sig)) || (!yes && /\bno\b/.test(sig))) {
          m.el.click();
          report.filled++;
        }
      } else {
        E.setValue(m.el, String(v));
        report.filled++;
      }
    }

    // Unknown questions → AI fallback via background (edge function with
    // profile context); answers land as suggestions the user reviews.
    if (report.unknown.length && kit) {
      chrome.runtime.sendMessage({
        type: "AI_FIELD_FALLBACK",
        questions: report.unknown.slice(0, 10),
      });
    }
    chrome.runtime.sendMessage({ type: "FILL_REPORT", report });
    return report;
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg.type === "FILL_NOW") {
      fill().then(sendResponse);
      return true;
    }
    if (msg.type === "APPLY_AI_ANSWERS" && msg.answers) {
      // answers: [{signature, value}] — match back by signature
      const mapped = E.mapPage(document);
      let n = 0;
      for (const a of msg.answers) {
        const m = mapped.find((x) => x.signature === a.signature && !x.field);
        if (m && a.value) {
          if (m.kind === "select") E.setSelect(m.el, a.value) && n++;
          else {
            E.setValue(m.el, a.value);
            n++;
          }
        }
      }
      sendResponse({ applied: n });
      return true;
    }
  });
})();
