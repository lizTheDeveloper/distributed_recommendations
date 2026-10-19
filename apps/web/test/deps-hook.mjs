// Resolve the bare imports of the packages apps/web imports from source
// (packages/match, packages/moderation, packages/taste: nostr-tools, @noble/*,
// @scure/*, @openmined/psi.js) from apps/web's own node_modules, the same way
// scripts/build.mjs does, so tests need nothing installed outside apps/web.
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
const OWN = /^(nostr-tools|nostr-wasm|@noble\\/[^/]+|@scure\\/[^/]+|@openmined\\/psi\\.js|ohttp-ts|hpke|bhttp-ts|@divviup\\/[^/]+|ws)(\\/.*)?$/;
const ROOT = ${JSON.stringify(new URL("../package.json", import.meta.url).href)};
export async function resolve(spec, ctx, next) {
  if (OWN.test(spec) && ctx.parentURL && !ctx.parentURL.startsWith(new URL(".", ROOT).href + "node_modules/")) {
    return next(spec, { ...ctx, parentURL: ROOT });
  }
  return next(spec, ctx);
}`),
);
