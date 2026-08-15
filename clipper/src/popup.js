/** Popup controller: capture the active tab, preview, and POST to nodum. */

import { extractPage } from "./extract.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_ENDPOINT = "http://localhost:8000";

/** chrome.storage.sync so the token follows the user's profile. */
const store = {
  get: () => chrome.storage.sync.get(["endpoint", "token"]),
  set: (v) => chrome.storage.sync.set(v),
  clear: () => chrome.storage.sync.remove(["endpoint", "token"]),
};

async function api(endpoint, token, path, init = {}) {
  const res = await fetch(`${endpoint.replace(/\/$/, "")}/api/v1/clipper${path}`, {
    ...init,
    headers: { "content-type": "application/json", "X-Nodum-Token": token, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.error?.message ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.status === 204 ? null : (await res.json()).data;
}

/** Run the extractor in the page's own world and return its result. */
async function capture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPage,
  });
  return result;
}

function show(section) {
  $("setup").hidden = section !== "setup";
  $("clip").hidden = section !== "clip";
}

function setStatus(el, message, kind = "") {
  el.textContent = message;
  el.className = kind;
}

async function boot() {
  const { endpoint = DEFAULT_ENDPOINT, token } = await store.get();
  $("endpoint").value = endpoint;

  if (!token) {
    show("setup");
    return;
  }

  show("clip");
  const status = $("status");
  try {
    // Capture first so the preview is populated even if the server is slow.
    const page = await capture();
    $("title").value = page.title;
    // A selection is the user being explicit about what they want.
    $("preview").value = page.selection || page.markdown;

    const vaults = await api(endpoint, token, "/vaults");
    $("vault").innerHTML = vaults
      .map((v) => `<option value="${v.id}">${v.name}</option>`)
      .join("");
  } catch (err) {
    setStatus(status, err.message, "error");
    if (String(err.message).includes("401")) show("setup");
  }
}

$("save").addEventListener("click", async () => {
  const endpoint = $("endpoint").value.trim() || DEFAULT_ENDPOINT;
  const token = $("token").value.trim();
  const status = $("setup-status");
  if (!token) return setStatus(status, "Paste your clipper token.", "error");
  setStatus(status, "Checking…");
  try {
    await api(endpoint, token, "/vaults"); // cheapest call that proves the token
    await store.set({ endpoint, token });
    setStatus(status, "Connected.", "ok");
    await boot();
  } catch (err) {
    setStatus(status, err.message, "error");
  }
});

$("reset").addEventListener("click", async () => {
  await store.clear();
  show("setup");
});

$("send").addEventListener("click", async () => {
  const { endpoint = DEFAULT_ENDPOINT, token } = await store.get();
  const status = $("status");
  const button = $("send");
  button.disabled = true;
  setStatus(status, "Saving…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const saved = await api(endpoint, token, "/clip", {
      method: "POST",
      body: JSON.stringify({
        url: tab?.url ?? "",
        title: $("title").value,
        markdown: $("preview").value,
        vault_id: $("vault").value || null,
        folder: $("folder").value.trim() || null,
        tags: $("tags").value.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });
    setStatus(status, `Saved “${saved.title}”.`, "ok");
  } catch (err) {
    setStatus(status, err.message, "error");
  } finally {
    button.disabled = false;
  }
});

void boot();
