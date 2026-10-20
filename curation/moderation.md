# Editorial moderation

Operational policy for the editors' collections (CURATION_STRATEGY.md §11). Status: draft, 2026-10-19.

## What gets in

A pick must:

- link to the original upload on the creator's own instance, not a re-upload;
- pass the hard gates in §6:
  - authorship is honestly represented;
  - no fabricated claims presented as fact;
  - lawful to link to;
  - within the platform's moderation rules;
- be approved by a named person.

Dual-use security material is judged on context. Defensive framing and legal practice targets are fine. The pick's `context_note` says what the risk is.

We reward clarity, evidence and honesty, not agreement. Opinion pieces are labelled `opinion` in `evidence_class`, and their notes say they are argued positions.

## Reporting a pick

- **Viewers:** use the Report button on the video (the app's moderation flow), or open an issue at https://github.com/lizthedotdev/distributed_recommendations/issues titled `Curation: <video URL>`.
- **Creators** who want a video taken out of a collection: the same issue route. We remove first and ask questions later. Removing a pick never affects the video itself, which stays on the creator's instance.

A dedicated contact address is still to be set up.

## Handling a report

1. Acknowledge the report.
2. If the creator asks for removal, or the report alleges harassment, doxxing or a rights problem, remove now:
   ```sh
   node curation/scripts/approve.mjs --reviewer "<you>" remove <id> --reason "<short reason>"
   node curation/scripts/publish.mjs
   ```
   Then deploy.
3. Otherwise, re-review the pick. Keep it, correct its note or labels, or remove it. Record why in the reason, which goes into the audit log.
4. A removed pick comes back only through a fresh review. Creator removal requests are final unless the creator withdraws them.
5. Appeals go to a different editor from the one who decided.

## Upkeep

- Run `node curation/scripts/verify.mjs --all` at least weekly.
  - Videos whose origin returns 404 or 410 move to `needs-recheck` and drop out on the next publish.
  - The same run refreshes caption availability and identity.
- Recheck `timely` picks and software demos for staleness when they are a year old.
- Never mirror or import media because a video disappeared. Flag the record and find the creator's new canonical upload, if there is one.
