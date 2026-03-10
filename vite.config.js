import { resolve } from "path";
import { copyFileSync } from "fs";

export default {
  base: "/clash-rps/",
  plugins: [
    {
      name: "copy-404",
      closeBundle() {
        copyFileSync("dist/index.html", "dist/404.html");
      },
    },
  ],
};
