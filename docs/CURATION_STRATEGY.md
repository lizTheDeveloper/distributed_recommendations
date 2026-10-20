# Multiverse Video: Federation, Discovery & Editorial Curation

**Platform:** https://video.multiversegames.ai  
**Status:** Proposed product/editorial specification — not an assertion of current implementation  
**Updated:** 2026-10-19  
**Audience:** Multiverse School students, builders, educators, hackers, artists, organizers, and the curious public

## 1. Mission

Multiverse Video should help people become more capable, independent, knowledgeable, and effective in their communities. It should surface rigorous technical education, social analysis, creative experimentation, and useful work that commercial recommendation engines frequently bury.

**Editorial proposition:** Technology should make people more capable, more independent, and harder to exploit.

**Values:** social justice, community, growth, knowledge, purpose, and independence. Curate for intellectual rigor and genuine utility rather than ideological conformity. Publish meaningful disagreements and distinguish evidence from advocacy.

This is a **curated discovery layer**, not a proposal to ingest or mirror every video on the federation. Federation, discovery, curation, playlisting, importing, and media mirroring are different operations and must be handled separately.

## 2. Intended audiences

| Audience | Wants | Best entry points |
|---|---|---|
| Curious newcomer | Clear explanations and an achievable first project | Start Here; Digital Self-Defense |
| Working developer | Useful tools, demos, architecture, implementation detail | Build Your Own Future; Strange Machines |
| Security practitioner | Threat models, reproducible demonstrations, defensive techniques | Hack the Planet |
| Educator | Teachable videos, discussion prompts, lesson sequences | Classroom Ready |
| Organizer / activist | Evidence, strategy, privacy, community tools | The Machine Is Political; Reclaim the City |
| Artist / game maker | Interactive fiction, creative coding, weird media | The Weird Internet |
| Independent operator | Infrastructure that reduces platform dependence | Build Your Own Future |

## 3. Top-level collections

### 3.1 Hack the Planet — target 25% of initial picks
**Promise:** Understand systems well enough to defend, repair, and improve them.

Topics: consumer cybersecurity; digital identity defense; home networks; privacy; phishing and scams; open-source intelligence; secure communication; reverse engineering; incident response; threat modeling; security research; hardware security; operational security.

Search seeds: `digital self defense`, `threat modeling`, `privacy workshop`, `home network security`, `OSINT`, `reverse engineering`, `security conference`, `phishing defense`, `hardware hacking`, `incident response`.

Subcollections: *Your First Threat Model*, *Protect Your Family*, *Hacker Conference Essentials*, *Understand Your Router*, *Defensive OSINT*.

### 3.2 The Machine Is Political — 20%
**Promise:** Examine how technological systems allocate power, risk, and opportunity.

Topics: AI accountability; model evaluation; algorithmic harms; labor and automation; surveillance; public-interest technology; propaganda and media literacy; platform governance; civil liberties; accessibility; critical technology studies.

Search seeds: `algorithmic accountability`, `AI governance`, `surveillance capitalism`, `digital rights`, `technology labor`, `AI safety evaluation`, `platform cooperatives`, `media literacy`, `algorithmic bias`, `public interest technology`.

Subcollections: *Who Gets to Decide?*, *AI Safety Without Hype*, *Data Is Political*, *Labor and Automation*, *Surveillance and Resistance*.

### 3.3 Build Your Own Future — 20%
**Promise:** Replace dependence on opaque platforms with skills and infrastructure you control.

Topics: free/open-source software; Linux; self-hosting; local language models; agent engineering; reproducible deployment; federated protocols; privacy-first services; sustainable software; community networks; open hardware.

Search seeds: `self hosting`, `local LLM`, `open source AI`, `ActivityPub`, `Fediverse`, `Linux tutorial`, `home server`, `community mesh network`, `open hardware`, `AI agents`.

Subcollections: *Leave Big Tech*, *Local AI Lab*, *Your First Server*, *Build an Agent*, *The Federated Web*.

### 3.4 Reclaim the City — 15%
**Promise:** Learn how people redesign the systems that shape daily life.

Topics: housing justice; urbanism; mutual aid; community broadband; climate adaptation; public transportation; cooperative governance; accessible public space; local democracy; community science.

Search seeds: `housing first`, `tenant organizing`, `community broadband`, `cooperative housing`, `urban planning`, `climate resilience`, `mutual aid`, `community science`, `right to the city`.

Subcollections: *Housing Is Infrastructure*, *Neighborhood Technology*, *Mutual Aid That Works*, *Climate Adaptation*, *Cities for People*.

### 3.5 Strange Machines — 12%
**Promise:** Make unusual physical things and understand how they work.

Topics: robotics; embedded electronics; ESP32; BLE; 3D printing; drones; sensing; amateur radio; repair; solar power; off-grid systems; creative hardware; experimental interfaces.

Search seeds: `ESP32`, `robotics workshop`, `3D printing`, `repair cafe`, `hardware teardown`, `BLE reverse engineering`, `solar DIY`, `microcontrollers`, `creative electronics`, `right to repair`.

Subcollections: *Robots in the Wild*, *Tiny Computers*, *Repair Everything*, *Off-Grid Experiments*, *Beautifully Unnecessary Machines*.

### 3.6 The Weird Internet — 8%
**Promise:** Celebrate creative computing, independent culture, and genuinely strange ideas.

Topics: interactive fiction; indie games; procedural storytelling; demoscene; creative coding; net art; speculative fiction; digital folklore; experimental music and animation; unusual interfaces.

Search seeds: `interactive fiction`, `creative coding`, `demoscene`, `indie game development`, `generative art`, `digital folklore`, `procedural narrative`, `experimental animation`, `net art`.

Subcollections: *Playable Stories*, *Demoscene Archaeology*, *Art Made of Code*, *Future Folklore*, *Indie Worlds*.

**These percentages are editorial targets, not rigid quotas.** They describe an initial 100-video collection, not upload or federation restrictions.

## 4. Cross-cutting tags

Every curated video can have multiple tags independent of its primary collection.

**Difficulty:** `beginner`, `intermediate`, `advanced`, `research`  
**Format:** `lecture`, `tutorial`, `demonstration`, `documentary`, `interview`, `debate`, `short`, `livestream`, `artwork`  
**Learning intent:** `understand`, `build`, `defend`, `repair`, `organize`, `create`, `critique`, `teach`  
**Evidence:** `primary-source`, `research-backed`, `practitioner-experience`, `opinion`, `speculative`  
**Accessibility:** `captions-available`, `transcript-available`, `audio-described`, `language:<code>`  
**Usefulness:** `classroom-ready`, `project-starter`, `reference`, `watch-with-friends`, `timely`, `evergreen`  
**Safety:** `dual-use-security`, `sensitive-topic`, `graphic-content`, `needs-context`.

Tags are not certifications. A `research-backed` label requires a curator to record supporting references. Do not infer captions or accessibility from titles.

## 5. Source discovery and seed registry

### 5.1 Confirmed infrastructure / destination

| Source | URL | Role | Verification |
|---|---|---|---|
| Multiverse Video | https://video.multiversegames.ai | Target deployment; inspect before changing configuration | User-supplied; implementation not inspected |
| Sepia Search | https://search.joinpeertube.org/ | Federated discovery starting point | Official discovery service |
| PeerTube instance directory | https://instances.joinpeertube.org/instances | Find potential federation partners | Official directory |
| Waag PeerTube | https://tube.waag.org/ | Candidate content instance, especially technology and society | PeerTube site observed; individual channels still require review |
| PeerTube documentation | https://docs.joinpeertube.org/ | Product behavior, federation, API | Official documentation |
| PeerTube REST reference | https://docs.joinpeertube.org/api-rest-reference.html | Search, feeds, playlists, follows | Official documentation |
| PeerTube ActivityPub docs | https://docs.joinpeertube.org/api/activitypub | Remote actors and federation | Official documentation |

**Do not automatically follow Waag or any other instance solely because it appears here.** Review its content, moderation practices, activity, language, and remote-host policy first.

### 5.2 Editorial leads — not verified PeerTube subscriptions

These are organizations or content traditions worth searching for **authorized PeerTube channels, cross-posts, or conference archives**. Their names are not proof of PeerTube availability.

| Lead | Priority | Relevant collections | Verification needed |
|---|---|---|---|
| Chaos Computer Club / Chaos Communication Congress | P0 | Hack the Planet; Machine Is Political | Locate official or authorized PeerTube actor; canonical archive: https://media.ccc.de/ |
| Framasoft / PeerTube project | P0 | Build Your Own Future | Locate official channels and inspect recent activity |
| Waag Futurelab | P0 | Machine Is Political; Reclaim the City | Identify specific channels/videos on its PeerTube instance |
| Digital rights and civil liberties organizations | P0 | Hack the Planet; Machine Is Political | Discover individual verified publishers |
| Free-software and Linux conferences | P0 | Build Your Own Future | Locate official conference channels and licenses |
| Community-networking projects | P1 | Reclaim the City; Build Your Own Future | Identify original publishers |
| Repair cafés and right-to-repair educators | P1 | Strange Machines | Find active creators and assess safety |
| Open-source robotics educators | P1 | Strange Machines | Verify technical quality and reuse permissions |
| Cooperative housing and urbanism educators | P1 | Reclaim the City | Check geographic context and evidence |
| Demoscene and creative-coding collectives | P1 | Weird Internet | Confirm original authors and licensing |
| Interactive-fiction communities | P1 | Weird Internet | Find demos, talks, and author channels |
| Independent AI evaluation researchers | P1 | Machine Is Political; Build Your Own Future | Verify source, methodology, and recency |

### 5.3 Search protocol

For each editorial lead:

1. Search Sepia Search for organization name, known speaker, topic, and likely language variants.
2. Capture candidate **channel actor URI**, canonical channel URL, instance host, and video URLs.
3. Open the actual channel and verify ownership via the organization's official site or independently linked identity where possible.
4. Sample at least three videos or all videos if fewer than three exist.
5. Check most recent upload, substantive quality, captions, license, language, and moderation concerns.
6. Record `verified_at`, verification method, reviewer, and status.
7. Follow or feature only after review. Record why rejected sources were rejected.

Never generate plausible-looking channel handles or URLs. `discovered` is not `verified`; `verified` is not `approved`.

## 6. Curation and ranking

Use an explicit editorial score, not a popularity proxy.

| Criterion | Weight | Question |
|---|---:|---|
| Educational usefulness | 25 | Will the viewer leave with a clearer model or practical skill? |
| Technical / factual rigor | 25 | Can major claims and demonstrations be checked? |
| Mission fit | 20 | Does this increase knowledge, independence, or community capacity? |
| Distinctiveness | 10 | Is this difficult to discover through mainstream recommendations? |
| Accessibility / presentation | 10 | Is it comprehensible and usable by the intended audience? |
| Currency / maintenance | 10 | Is it accurate for its topic and publication date? |

Score each dimension from 0–5 and calculate `sum(weight * rating / 5)`, giving a score from 0–100.

**Publication thresholds:** 80+ feature candidate; 65–79 collection candidate; 50–64 editorial review; below 50 reject. These are proposed defaults, subject to evaluation.

**Hard gates:** Do not publish as a recommendation when authorship is falsely represented, major claims are demonstrably fabricated without disclosure, the content is unlawful to distribute, or it materially violates the platform's published safety/moderation rules. Security demonstrations require contextual assessment; do not automatically reject all dual-use research.

Do not reward ideological agreement. Reward clarity, evidence, and intellectual honesty. Label disputed arguments and add context where appropriate. Prefer original uploads over unauthorized mirrors.

## 7. Featured collections and homepage shelves

### Permanent shelves

1. **Start Here** — ten accessible videos, each with one concrete next action.
2. **Hack the Planet** — practical security and privacy.
3. **Build Your Own Future** — local-first, open-source, federated technology.
4. **The Machine Is Political** — technology, governance, power, and accountability.
5. **Strange Machines** — maker projects, electronics, robotics, and repair.
6. **The Weird Internet** — games, art, and strange computational culture.
7. **Reclaim the City** — housing, climate, infrastructure, community power.
8. **Classroom Ready** — captioned, teachable, discussion-friendly selections.

### Rotating editorial shelves

- **Things They Didn't Teach You to Build** — unconventional tools that give people agency.
- **One Hour to Independence** — projects doable in roughly an hour; verify estimates.
- **Hacker Conference Gems** — overlooked, rigorous conference talks.
- **AI Without the Sales Pitch** — evaluation, limitations, deployment, and accountability.
- **Your Family's Digital Defense** — practical, low-cost safety measures.
- **Tools for Mutual Aid** — coordination, mapping, community infrastructure.
- **Beautifully Unnecessary Machines** — joyful, odd hardware projects.
- **Playable Futures** — interactive fiction and experimental games.
- **From Video to Project** — each video paired with a reproducible activity.

### Sample video card

- **Title:** Preserve original title; optional editorial headline separately.
- **Creator:** Canonical actor/channel and instance.
- **Why we picked it:** One to two specific sentences.
- **Difficulty:** Beginner / Intermediate / Advanced / Research.
- **You'll learn:** Two or three outcomes.
- **Try next:** One concrete action or project.
- **Evidence:** Sources or caveats, if needed.
- **Original publication:** Date, with later updates clearly marked.
- **Watch at source:** Canonical URL.

## 8. Content record schema

This is an **application-level schema proposal**, not a claim about PeerTube's database schema.

```json
{
  "id": "curation-item-uuid",
  "source": {
    "video_url": "https://example.org/w/VIDEO_ID",
    "video_uuid": null,
    "channel_actor_uri": null,
    "instance_host": "example.org",
    "creator_display_name": null,
    "license": null,
    "original_published_at": null
  },
  "editorial": {
    "status": "candidate",
    "primary_collection": "hack-the-planet",
    "secondary_collections": ["strange-machines"],
    "difficulty": "intermediate",
    "format": "demonstration",
    "learning_intents": ["understand", "defend"],
    "evidence_class": "practitioner-experience",
    "tags": ["hardware", "security"],
    "why_selected": null,
    "learning_outcomes": [],
    "try_next": null,
    "context_note": null,
    "score": null,
    "reviewer": null,
    "reviewed_at": null
  },
  "verification": {
    "identity_status": "unverified",
    "verified_at": null,
    "verification_method": null,
    "rights_status": "unknown",
    "captions_verified": false,
    "last_checked_at": null
  },
  "distribution": {
    "mode": "link-only",
    "featured": false,
    "mirroring_authorized": false
  }
}
```

Allowed editorial status transitions:

`candidate -> discovered -> verified -> reviewed -> approved -> published`

At any stage: `rejected`, `needs-recheck`, or `removed`. Restoring a removed item requires a new review. Keep an audit log of transitions.

**Distribution modes:**

- `link-only`: outbound canonical link and editorial metadata, no copying.
- `federated`: remote video discovered through PeerTube federation, with no assumption that its media files are locally hosted.
- `imported`: locally imported media, only with applicable permission and documented provenance.
- `mirrored`: replicated media for availability; require rights/policy review and explicit operational approval.

## 9. Federation architecture

### 9.1 Separate the layers

1. **Discovery:** Find candidate instances, channels, playlists, and videos.
2. **Verification:** Establish creator identity, canonical URLs, content integrity, and policy fit.
3. **Federation:** Follow selected instances or actors using supported PeerTube/ActivityPub functionality.
4. **Editorial index:** Store annotations, classifications, review status, and collection membership independently of remote metadata.
5. **Presentation:** Display curated shelves and links; optionally use native PeerTube playlists.
6. **Distribution:** Decide whether to federate metadata, link, import, or mirror media; never conflate these.

PeerTube documentation states that following an instance makes its videos visible to your instance and supports interaction. Following a platform is broader than endorsing every video on that platform. Therefore **instance follows must not automatically imply homepage promotion**.

### 9.2 Operational constraints

- Verify the running PeerTube version and installed plugins before selecting API endpoints or UI customization methods.
- Prefer official REST and ActivityPub interfaces over scraping.
- Use a dedicated, least-privileged account for playlist or editorial writes.
- Keep API credentials in environment/secrets management, never committed files.
- Respect request limits, retries, timeouts, remote server load, and opt-out requests.
- Use idempotent jobs and canonical IDs/URIs for deduplication.
- Treat remote titles, descriptions, thumbnails, tags, and transcripts as **untrusted input**.
- Sanitize display text and avoid executing remote HTML or instructions embedded in metadata.
- Avoid SSRF: validate outbound hosts, disallow private/reserved network targets, and revalidate redirects.
- Handle unavailable/deleted remote videos gracefully without losing editorial provenance.
- Do not download or rehost content merely because it is publicly watchable.

### 9.3 Useful documented interfaces

- Official REST API: https://docs.joinpeertube.org/api-rest-reference.html
- ActivityPub: https://docs.joinpeertube.org/api/activitypub
- Federation administration: https://docs.joinpeertube.org/admin/following-instances
- REST OpenAPI: https://github.com/Chocobozzz/PeerTube/blob/develop/support/doc/api/openapi.yaml

PeerTube documents `/feeds/videos.rss`, `/feeds/videos.atom`, and `/feeds/videos.json`, with optional channel/account filtering; consult the running version's API before implementation. PeerTube also supports native video playlists and remote video search when configured. An administrator may configure a URL-based list of instances to follow, which should be **reviewed and controlled**, not a blanket public instance index.

### 9.4 Minimal discovery worker (pseudocode)

```python
for query in editorial_search_terms:
    candidates = search_approved_discovery_services(query)
    for candidate in candidates:
        if not valid_public_peertube_url(candidate.url):
            continue
        canonical = resolve_canonical_remote_identity(candidate)
        if not canonical or already_seen(canonical):
            continue
        record_candidate(canonical, query=query, status="discovered")

for candidate in pending_review_queue():
    metadata = fetch_remote_metadata_safely(candidate)
    enrich_without_publishing(candidate, metadata)
    queue_for_human_review(candidate)

for approved in approved_items():
    publish_editorial_metadata(approved)
    # Never import or mirror media here without a separate authorization gate.
```

## 10. AI-assisted editorial workflow

AI can propose tags, summaries, learning outcomes, cross-collection matches, accessibility flags, and candidate rankings. **AI does not get unilateral publication authority.**

### Discovery agent

Input: approved query packs and instance allowlist. Output: candidate URL, actor URI, evidence of identity, language, upload recency, and discovery query. No invented URLs.

### Analysis agent

Input: fetched metadata, available transcript, references, and reviewer instructions. Output: a proposed structured record with confidence and uncertainty. If there is no transcript or direct content inspection, mark substantive judgments as `unverified`.

### Fact-check / context agent

Identify claims requiring verification; compare to primary evidence where possible; flag stale software demonstrations and unsupported numerical claims. Record source URLs and dates. Do not silently change creator claims.

### Editorial agent

Suggest primary and secondary collections, difficulty, learning outcomes, a short recommendation, and a practical next action. Never invent captions, licensing, credentials, or research findings.

### Human reviewer

Approve/reject, correct metadata, assess safety and rights, and decide feature placement. Preserve decisions and rationale in an audit trail.

### Refresh agent

Periodically check published items for availability, deleted content, changed metadata, outdated technical guidance, and reported problems. Flag rather than automatically republish replacements.

## 11. Editorial and moderation principles

1. **No algorithmic outrage farming.** Don't optimize solely for clicks, controversy, watch time, or virality.
2. **Evidence before agreement.** Legitimate disagreements belong in the catalog; misinformation should not be laundered as an equally supported claim.
3. **Context for dual-use security.** Prioritize defensive framing and legal/ethical boundaries; assess specific risks rather than treating security education as inherently disallowed.
4. **Credit original creators.** Preserve authorship, canonical links, licenses, and correction requests.
5. **Consent and rights matter.** Federation does not automatically grant redistribution or commercial reuse rights.
6. **Avoid harassment and doxxing.** Protect private individuals and at-risk communities.
7. **Label speculation.** Separate documented facts, inference, advocacy, fiction, and satire.
8. **Accessibility is editorial quality.** Prefer captions and transcripts; record gaps honestly.
9. **Make removal possible.** Offer a clear creator and viewer reporting path, including appeals.
10. **Respect diverse learners.** Make technical rigor accessible without oversimplifying it.

## 12. Launch plan

### Phase 0 — inspect deployment (P0)

- [ ] Determine PeerTube version, deployment model, installed plugins, and admin access.
- [ ] Confirm current federation configuration and instance moderation policies.
- [ ] Check whether remote search-index support is enabled.
- [ ] Inspect existing playlists, channels, tags, and homepage customization.
- [ ] Confirm whether this repository owns the UI, backend, infrastructure, or only configuration.
- [ ] Choose where editorial metadata lives; avoid modifying PeerTube core tables.

### Phase 1 — seed discovery (P0)

- [ ] Verify Waag instance and identify 3–10 appropriate videos, if available.
- [ ] Locate official/authorized PeerTube channels for Framasoft and hacker conference content.
- [ ] Search 10 topics per top-level collection using Sepia Search.
- [ ] Produce at least 60 unique candidates, with canonical URLs and provenance.
- [ ] Verify 20–30 high-priority videos before featuring any.
- [ ] Reject duplicates, unauthorized mirrors, and dead links.

### Phase 2 — first public collection (P0)

- [ ] Publish *Hack the Planet* and *The Machine Is Political* shelves.
- [ ] Publish a ten-video *Start Here* collection.
- [ ] Add creator attribution, source link, difficulty, and `Why we picked it` to each item.
- [ ] Provide a lightweight report/correction route.
- [ ] Test mobile playback, remote availability, and accessibility.

### Phase 3 — expand to 100 videos (P1)

- [ ] Fill all six collections approximately to target mix.
- [ ] Launch *Classroom Ready* and *Things They Didn't Teach You to Build*.
- [ ] Add curator notes and suggested student projects.
- [ ] Offer a submission form for creators and community recommendations.
- [ ] Add a weekly editorial review queue and stale-link checks.

### Phase 4 — personalization without surveillance (P2)

- [ ] Allow opt-in follows of collections, creators, and topics.
- [ ] Offer chronological and editorial views as defaults.
- [ ] Make recommendation rationale visible and understandable.
- [ ] Provide exportable subscriptions or feeds where feasible.
- [ ] Avoid invasive cross-site tracking or undisclosed behavioral profiling.

## 13. Metrics

**North star:** number of viewers who report learning something useful or starting a project, not raw watch hours.

Track: approved sources by category; percentage of curated items with verified provenance; broken-link rate; caption availability; creator diversity; new-to-topic completion; project clickthroughs; user-submitted corrections; moderation response time; review queue age.

Avoid interpreting raw clicks as learning or ideological agreement. Collect minimal analytics and publish what is measured.

## 14. Definition of done for initial release

- [ ] 20+ human-reviewed videos with real canonical URLs.
- [ ] At least two public editorial collections.
- [ ] No invented or unverified creator/channel identities.
- [ ] Every featured item has attribution and a short editorial reason.
- [ ] No media rehosting without explicit authorization.
- [ ] Working report/removal process.
- [ ] Federation follows are documented and independently approved.
- [ ] Basic mobile and accessibility QA completed.
- [ ] A maintainer can add, review, publish, and remove a recommendation without code changes.

## 15. Recommended repository layout

```text
docs/
  PEERTUBE_CURATION_STRATEGY.md
curation/
  sources.yaml                 # verified instance/channel registry
  search-queries.yaml          # editorial query packs
  collections.yaml             # collection definitions and ordering
  candidates/                  # unreviewed discovered items
  approved/                    # reviewed editorial records
  schemas/curated-video.json   # JSON Schema for content records
  moderation.md                # operational moderation policy
```

**Important:** This layout is a recommendation. Adapt it to the existing repository conventions rather than creating a parallel system.

## 16. Sources and technical references

- PeerTube project and documentation: https://docs.joinpeertube.org/
- Federation and instance follows: https://docs.joinpeertube.org/admin/following-instances
- ActivityPub federation: https://docs.joinpeertube.org/api/activitypub
- REST API and playlist/search/feed operations: https://docs.joinpeertube.org/api-rest-reference.html
- OpenAPI specification: https://github.com/Chocobozzz/PeerTube/blob/develop/support/doc/api/openapi.yaml
- PeerTube instance discovery: https://instances.joinpeertube.org/instances
- Sepia Search: https://search.joinpeertube.org/
- Waag PeerTube: https://tube.waag.org/
- CCC canonical video archive (editorial lead, not a verified PeerTube subscription): https://media.ccc.de/

---

**Maintainer note:** The first engineering action is to inspect the deployed instance and repository. The first editorial action is to verify actual channels and videos. Do not confuse a promising organization with a verified federated source, and do not conflate following with endorsing or mirroring.
