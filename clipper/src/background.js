/** Right-click → "Clip selection to nodum". The popup handles full-page clips. */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "nodum-clip-selection",
    title: "Clip selection to nodum",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "nodum-clip-selection" || !tab?.id) return;
  const { endpoint = "http://localhost:8000", token } = await chrome.storage.sync.get([
    "endpoint",
    "token",
  ]);
  if (!token) {
    // Nothing to do without a token — open the popup so the user can connect.
    await chrome.action.openPopup().catch(() => undefined);
    return;
  }
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, "")}/api/v1/clipper/clip`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Nodum-Token": token },
      body: JSON.stringify({
        url: info.pageUrl ?? tab.url ?? "",
        title: tab.title ?? "Clipped selection",
        markdown: info.selectionText ?? "",
        folder: "Clippings",
        tags: ["clipped"],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.warn("nodum clip failed:", err);
  }
});
