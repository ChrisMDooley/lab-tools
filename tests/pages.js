#!/usr/bin/env node
/* Drives each page's own self-test panel in a headless browser.
   Needs Playwright and a local server; run:  node tests/pages.js        */
"use strict";
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const root = require("path").join(__dirname, "..");
const PORT = 8799;

(async () => {
  const srv = spawn("python3", ["-m", "http.server", String(PORT)],
                    { cwd: root, stdio: "ignore" });
  await new Promise(r => setTimeout(r, 900));
  let bad = 0;
  try {
    const b = await chromium.launch();
    for (const [page, panel] of [["index.html","testOut"], ["qpcr.html","tests"],
                                 ["notebook.html","testOut"]]) {
      const p = await b.newPage();
      const errs = [];
      p.on("pageerror", e => errs.push(e.message.slice(0, 100)));
      await p.goto(`http://localhost:${PORT}/${page}`, { waitUntil: "networkidle" });
      await p.waitForTimeout(500);
      const txt = await p.evaluate(id => {
        const el = document.getElementById(id);
        return el ? el.textContent.trim().split("\n")[0] : "(no panel #" + id + ")";
      }, panel);
      const m = /(\d+)\s+of\s+(\d+)/.exec(txt);
      const okAll = m && m[1] === m[2] && !errs.length;
      if (!okAll) bad++;
      console.log(`  ${okAll ? "ok   " : "FAIL "} ${page.padEnd(15)} ${txt}`
                  + (errs.length ? "  errors: " + errs.join(" | ") : ""));
      await p.close();
    }
    await b.close();
  } finally { srv.kill(); }
  console.log(bad ? "\nFAILED\n" : "\nall pages good\n");
  process.exit(bad ? 1 : 0);
})();
