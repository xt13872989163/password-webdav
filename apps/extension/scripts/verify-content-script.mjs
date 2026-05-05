import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const contentScriptPath = resolve("dist/assets/contentScript.js");
const source = await readFile(contentScriptPath, "utf8");

if (/(^|\n)\s*(import|export)\s/.test(source)) {
  throw new Error("Content script must be a classic single-file script without top-level import/export.");
}

if (!source.includes("chrome.runtime.onMessage")) {
  throw new Error("Content script build looks incomplete: missing runtime message listener.");
}

console.log("content script build verified");
