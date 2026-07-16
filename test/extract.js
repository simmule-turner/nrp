"use strict";
// Pulls the exact source of a named top-level function out of nrp.html.
// The app is one big IIFE with no module exports, so tests can't `require()`
// its functions directly — this is the alternative to hand-copying function
// bodies into a parallel test file, which would silently drift from the
// real implementation the moment someone edits nrp.html without updating
// the copy. Extracting from the real file means the tests always run
// against whatever nrp.html actually contains right now.
const fs = require("fs");

function extractFunctionSource(html, name) {
  const startRe = new RegExp("(^|\\n)([ \\t]*)((?:async\\s+)?function\\s+" + name + "\\s*\\()");
  const m = startRe.exec(html);
  if (!m) throw new Error(`extractFunctionSource: "${name}" not found`);
  const defStart = m.index + m[1].length; // skip the leading \n, keep indentation start
  let i = m.index + m[0].length - 1; // position of the opening "(" of the param list

  // Walk past the parameter list to the function body's opening "{".
  let depth = 0;
  while (i < html.length) {
    if (html[i] === "(") depth++;
    else if (html[i] === ")") { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  while (html[i] !== "{") i++;

  // Brace-balanced walk through the body, string/template/comment/regex
  // aware so a "}" (or a quote character inside a regex character class,
  // e.g. /[&<>"]/) doesn't throw off the balance count.
  let depthBody = 0, inString = null, escape = false, inLineComment = false, inBlockComment = false, inRegex = false, inRegexClass = false;
  let lastSignificant = ""; // last non-whitespace char(s) seen, to disambiguate / (regex start) from division
  while (i < html.length) {
    const c = html[i], next = html[i + 1];
    if (inLineComment) { if (c === "\n") inLineComment = false; }
    else if (inBlockComment) { if (c === "*" && next === "/") { inBlockComment = false; i++; } }
    else if (inRegex) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === "[") inRegexClass = true;
      else if (c === "]") inRegexClass = false;
      else if (c === "/" && !inRegexClass) inRegex = false;
    } else if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === inString) inString = null;
    } else {
      if (c === "/" && next === "/") inLineComment = true;
      else if (c === "/" && next === "*") inBlockComment = true;
      else if (c === "/" && /[(,=:\[!&|?{;\n]|^$|return/.test(lastSignificant)) inRegex = true;
      else if (c === '"' || c === "'" || c === "`") inString = c;
      else if (c === "{") depthBody++;
      else if (c === "}") { depthBody--; if (depthBody === 0) { i++; break; } }
      if (!/\s/.test(c)) lastSignificant = /[a-zA-Z0-9_$]/.test(c) ? (lastSignificant + c).slice(-6) : c;
    }
    i++;
  }
  return html.slice(defStart, i);
}

function extractMany(html, names) {
  return names.map(n => extractFunctionSource(html, n)).join("\n\n");
}

module.exports = { extractFunctionSource, extractMany };
