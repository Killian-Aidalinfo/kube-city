// Config Vite : le client vit dans client/, la sortie va dans client/dist (servie par le serveur Node).
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  publicDir: path.join(root, "public"),
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 4500, // seul le chunk rapier (WASM en base64, ~4,3 Mo) dépasse 1 Mo
    rolldownOptions: {
      output: {
        // bibliothèques lourdes dans leurs propres fichiers (cache navigateur indépendant du code du jeu)
        codeSplitting: {
          groups: [
            { name: "rapier", test: /node_modules[\\/]@dimforge/, priority: 20 },
            { name: "three", test: /node_modules[\\/]three[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    // en développement, le serveur Node (HA, WebSocket) tourne sur 8080
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/api": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
    },
  },
});
