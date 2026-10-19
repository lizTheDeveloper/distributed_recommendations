// Example taste lists, bundled so they work offline. Clearly labelled example data:
// generated from instances' most-viewed videos, not curated by a person.
import tilvids from "../public/examples/tilvids-picks.json";
import framatube from "../public/examples/framatube-picks.json";

export const EXAMPLES = [
  { file: "tilvids-picks.json", list: tilvids as unknown },
  { file: "framatube-picks.json", list: framatube as unknown },
];
