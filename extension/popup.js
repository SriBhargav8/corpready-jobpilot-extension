document.getElementById("fill").addEventListener("click", async () => {
  const reportEl = document.getElementById("report");
  reportEl.textContent = "Analyzing application page...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      reportEl.textContent = "No active tab found.";
      return;
    }

    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
      reportEl.innerHTML = "<span style='color:#e67e22'>Please open a supported job application page (e.g. Greenhouse, Lever, Ashby) first.</span>";
      return;
    }

    let r;
    try {
      r = await chrome.tabs.sendMessage(tab.id, { type: "FILL_NOW" });
    } catch (msgErr) {
      // If content script was not pre-injected, dynamically inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["field-engine.js", "filler.js"]
        });
        r = await chrome.tabs.sendMessage(tab.id, { type: "FILL_NOW" });
      } catch (injectErr) {
        throw new Error("Could not connect to this page. Make sure you are on a supported job posting (Greenhouse, Lever, or Ashby) and refresh the page (F5).");
      }
    }

    reportEl.textContent = r
      ? `Filled ${r.filled} fields on ${r.ats}. ${r.unknown.length} unknown question(s) sent to AI. Skipped: ${r.skipped.join(", ") || "none"}.`
      : "Open a supported application page first.";
  } catch (err) {
    reportEl.innerHTML = `<span style="color:#c0392b;font-size:11.5px;">${err.message}</span>`;
  }
});

