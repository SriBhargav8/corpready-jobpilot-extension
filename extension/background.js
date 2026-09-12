// JobPilot background service worker — auth bridge + AI fallback + tracking
const SUPABASE_URL = "https://hmtlyylpkszijsdjtiot.supabase.co";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "AI_FIELD_FALLBACK") {
    handleAiFallback(msg.questions, sender.tab?.id);
    return;
  }
  if (msg.type === "FILL_REPORT") {
    chrome.storage.local.set({ lastFillReport: msg.report });
    logApplication(msg.report);
    return;
  }
});

async function handleAiFallback(questions, tabId) {
  const { session } = await chrome.storage.local.get("session");
  if (!session?.access_token) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/answer-fields`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ questions }),
    });
    if (!res.ok) return;
    const { answers } = await res.json();
    if (tabId && answers)
      chrome.tabs.sendMessage(tabId, { type: "APPLY_AI_ANSWERS", answers });
  } catch (e) {
    /* offline-tolerant */
  }
}

async function logApplication(report) {
  const { session, currentJob } = await chrome.storage.local.get([
    "session",
    "currentJob",
  ]);
  if (!session?.access_token) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: session.anon_key,
        Authorization: `Bearer ${session.access_token}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        job_id: currentJob?.id ?? null,
        ats_type: report.ats,
        status: "filled",
      }),
    });
  } catch (e) {}
}
