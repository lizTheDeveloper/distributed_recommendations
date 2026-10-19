#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning
// Creator side: read a collection result and print the studio view.
//   collect ... | node --experimental-strip-types bin/discovery-report.ts           (Janus `collect` output)
//   node --experimental-strip-types bin/discovery-report.ts result.json              ({"report_count", "result"} from the interop collector)
//   add --json for JSON, --publishable for the publishable subset
import { readFileSync } from "node:fs";
import { parseCollectOutput, postprocess, publishable } from "../src/index.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const text = readFileSync(file ?? 0, "utf8");
let input: { reportCount: number; aggregate: string[] };
if (text.trimStart().startsWith("{")) {
  const j = JSON.parse(text) as { report_count: number; result: string[] };
  input = { reportCount: j.report_count, aggregate: j.result };
} else {
  input = parseCollectOutput(text);
}
const stats = postprocess(input);
if (args.includes("--publishable")) console.log(JSON.stringify(publishable(stats), null, 2));
else if (args.includes("--json")) console.log(JSON.stringify(stats, null, 2));
else {
  console.log(`Viewers who contributed: ${stats.reportCountDisplay}`);
  for (const c of stats.channels) {
    const share = c.share === null ? "" : `  ${(c.share * 100).toFixed(0)}%`;
    console.log(`  ${c.channel.padEnd(8)} ${c.display.padStart(6)}${share}`);
  }
  console.log("Counts include random noise; anything under 20 is shown as <20.");
}
