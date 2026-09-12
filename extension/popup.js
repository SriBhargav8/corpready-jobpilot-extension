document.getElementById("fill").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const r = await chrome.tabs.sendMessage(tab.id, { type: "FILL_NOW" });
  document.getElementById("report").textContent = r
    ? `Filled ${r.filled} fields on ${r.ats}. ${r.unknown.length} unknown question(s) sent to AI. Skipped: ${r.skipped.join(", ") || "none"}.`
    : "Open a supported application page first.";
});
