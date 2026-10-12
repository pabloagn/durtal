import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { id: "/", name: "Durtal", short_name: "Durtal", description: "Your books and saved reading places",
    start_url: "/ebooks/offline", scope: "/", display: "standalone", background_color: "#07090d", theme_color: "#07090d",
    icons: [ { src: "/icons/durtal-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/durtal-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/durtal-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" } ] };
}
