import type { MetadataRoute } from "next";

/** PWA manifest — installable app + OS share-target into the clipper. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nodum",
    short_name: "Nodum",
    description: "Linked notes, living graph — your markdown knowledge base.",
    start_url: "/",
    display: "standalone",
    background_color: "#1e1e1e",
    theme_color: "#1e1e1e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
    // Shared pages/links/text land in the clipper (GET → query params)
    share_target: {
      action: "/clip",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  } as MetadataRoute.Manifest;
}
