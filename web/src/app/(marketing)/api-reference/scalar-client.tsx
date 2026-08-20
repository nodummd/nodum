"use client";

import "@scalar/api-reference-react/style.css";

import dynamic from "next/dynamic";

// Scalar is a large interactive bundle — loaded only on this route, only in
// the browser (the GraphView pattern). The spec URL is relative, so it is
// same-origin everywhere: the Next dev proxy and the production reverse
// proxy both forward /api/* to the backend.
const ApiReference = dynamic(
  () => import("@scalar/api-reference-react").then((m) => m.ApiReferenceReact),
  {
    ssr: false,
    loading: () => (
      <p style={{ padding: "4rem", textAlign: "center", opacity: 0.6 }}>Loading API reference…</p>
    ),
  },
);

export function ScalarClient() {
  return (
    <ApiReference
      configuration={{
        url: "/api/public/v1/openapi.json",
        // Pre-select the bearer scheme so pasting a key into the Auth field
        // is the only step before "Send" works. Keys are shown once by
        // design, so nothing is ever auto-filled.
        authentication: { preferredSecurityScheme: "ApiKey" },
        hideClientButton: true,
        darkMode: true,
        hideDarkModeToggle: true,
      }}
    />
  );
}
