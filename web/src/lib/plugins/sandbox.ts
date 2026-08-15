/**
 * Plugin sandbox — one cross-origin iframe per plugin.
 *
 * Security model, in order of importance:
 *  1. `sandbox="allow-scripts"` WITHOUT `allow-same-origin`. The frame gets an
 *     opaque origin, so plugin code cannot touch our DOM, cookies, localStorage
 *     or IndexedDB, and cannot read the auth token. This is the whole point —
 *     an in-page `eval` would hand a plugin the user's session.
 *  2. Everything the plugin can do goes through postMessage RPC that the host
 *     checks against the permissions the user granted.
 *  3. The frame's own CSP sets `connect-src 'none'`, so a plugin cannot
 *     exfiltrate note content to a third party.
 *
 * The frame CSP does allow 'unsafe-eval' — running plugin code IS the feature,
 * and there is no way to execute it otherwise. That is safe only because of the
 * jail around it: an opaque origin means eval'd code sees none of our state,
 * and connect-src 'none' means it cannot phone home with what it computes.
 * Never relax the sandbox attribute to include allow-same-origin; that single
 * change would turn this from a jail into a session handover.
 *
 * The cost of an opaque origin is that the frame cannot be `srcdoc`-inspected
 * from the host and messages arrive with origin "null" — so we identify frames
 * by their MessageEvent.source rather than by origin.
 */

import type { PluginManifest } from "./types";

/** Bootstrap that runs INSIDE the sandbox, before any plugin code. */
function bootstrapSource(manifest: PluginManifest, code: string): string {
  const granted = JSON.stringify(manifest.permissions);
  // The plugin body is injected as a string and evaluated inside the frame's
  // own realm — never in ours.
  const encoded = JSON.stringify(code);
  return `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'">
<script>
(function () {
  var granted = ${granted};
  var nextCall = 1;
  var pending = new Map();
  var handlers = new Map();

  window.addEventListener("message", function (e) {
    // Only the host may drive this plugin. Without this check any window that
    // can get a handle on this frame could invoke its commands or forge RPC
    // responses to it — the host validates senders; the guest must too.
    if (e.source !== parent) return;
    var msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.nodum === "response") {
      var p = pending.get(msg.callId);
      if (!p) return;
      pending.delete(msg.callId);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || "Plugin call failed"));
      return;
    }
    if (msg.nodum === "invoke") {
      var fn = handlers.get(msg.commandId);
      if (fn) { try { fn(); } catch (err) { console.error(err); } }
    }
  });

  function call(method, args) {
    var need = method.split(".")[0] === "commands" ? "commands:register"
             : method === "ui.notice" ? "ui:notice"
             : method.indexOf("notes.") === 0
               ? (method === "notes.create" || method === "notes.update" ? "notes:write" : "notes:read")
               : method;
    if (granted.indexOf(need) === -1) {
      return Promise.reject(new Error("Permission not granted: " + need));
    }
    var callId = nextCall++;
    return new Promise(function (resolve, reject) {
      pending.set(callId, { resolve: resolve, reject: reject });
      parent.postMessage({ nodum: "request", callId: callId, method: method, args: args || [] }, "*");
    });
  }

  // The API surface a plugin sees. Async by design: every call crosses a
  // trust boundary, and pretending otherwise is how Obsidian's API became
  // impossible to sandbox.
  window.nodum = {
    manifest: ${JSON.stringify(manifest)},
    notes: {
      list: function () { return call("notes.list", []); },
      get: function (id) { return call("notes.get", [id]); },
      create: function (title, content) { return call("notes.create", [title, content]); },
    },
    commands: {
      register: function (commandId, label, run) {
        handlers.set(commandId, run);
        return call("commands.register", [commandId, label]);
      },
    },
    ui: {
      notice: function (message) { return call("ui.notice", [String(message)]); },
    },
  };

  try {
    (0, eval)(${encoded});
    parent.postMessage({ nodum: "emit", event: "ready", payload: null }, "*");
  } catch (err) {
    parent.postMessage({ nodum: "emit", event: "error", payload: String(err) }, "*");
  }
})();
</script>`;
}

export interface SandboxHandle {
  manifest: PluginManifest;
  frame: HTMLIFrameElement;
  /** Ask the plugin to run one of its registered commands. */
  invoke: (commandId: string) => void;
  destroy: () => void;
}

/** Boot a plugin into its own opaque-origin frame. */
export function createSandbox(manifest: PluginManifest, code: string): SandboxHandle {
  const frame = document.createElement("iframe");
  // No allow-same-origin: the frame must not be able to reach our origin.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.style.display = "none";
  frame.srcdoc = bootstrapSource(manifest, code);
  document.body.appendChild(frame);

  return {
    manifest,
    frame,
    invoke: (commandId: string) => {
      frame.contentWindow?.postMessage({ nodum: "invoke", commandId }, "*");
    },
    destroy: () => frame.remove(),
  };
}
