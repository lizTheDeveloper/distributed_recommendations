// The display name, from src/brand.json (also read by scripts/build.mjs for
// index.html, the manifest and the artifact title). A rename is one edit there.
// Internal identifiers stay as they are: localStorage keys `mf.v1.*`, the IndexedDB
// database `match-feed` and the vault's AAD strings, so existing data keeps working.
import brand from "./brand.json" with { type: "json" };

export const APP_NAME: string = brand.name;
export const APP_SHORT_NAME: string = brand.shortName;
export const APP_DESCRIPTION: string = brand.description;
