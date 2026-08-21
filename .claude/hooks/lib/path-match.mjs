// Shared path/glob matching for the advisory PreToolUse hooks (B3, 2026-08-17).
//
// `globToRegExp` and `relPath` previously existed as near-identical copies in
// skill-activation.mjs and rules-injection.mjs, each carrying a comment claiming
// the other was identical. They had already drifted -- not behaviourally (the
// relPath variants are equivalent, since `\` -> `/` is a 1:1 replace so the
// lengths match) but textually, which is how the harmless kind of drift becomes
// the harmful kind. One source of truth removes the question.

/** Minimal glob -> RegExp (supports `**`, `*`, literal segments). */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** -> any depth. `**/` spans zero-or-more leading dirs; a trailing
        // `**` (e.g. `lib/**`) matches everything below, files included.
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*"; // * -> within one segment
      }
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

/** Normalise a file path to repo-relative, forward-slashed. */
export function relPath(p, root) {
  if (!p) return "";
  let s = String(p).replace(/\\/g, "/");
  const r = String(root).replace(/\\/g, "/");
  if (s.startsWith(r)) s = s.slice(r.length);
  return s.replace(/^\.?\//, "");
}
