// Runs the Style Dictionary token pipeline (A5 / cat 21).
//
// Wired to `npm run tokens:build`. Reads tokens/design-tokens.json through
// style-dictionary.config.mjs and emits tokens/build/tokens.generated.css.
// Kept as a tiny explicit runner (rather than the CLI) so the pipeline is
// debuggable and portable, and so a fork can extend it (add platforms, run a
// diff-against-tokens.css check) without fighting CLI config discovery.
import StyleDictionary from "style-dictionary";
import config from "../style-dictionary.config.mjs";

const sd = new StyleDictionary(config);
await sd.buildAllPlatforms();

console.log("tokens: built tokens/build/tokens.generated.css from tokens/design-tokens.json");
