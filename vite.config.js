import { resolve } from "path";
import { copyFileSync } from "fs";
import react from "@vitejs/plugin-react";

export default {
  base: "/clash-rps/",
  plugins: [
    react(),
    {
      name: "copy-404",
      closeBundle() {
        copyFileSync("dist/index.html", "dist/404.html");
      },
    },
  ],
};
