# Naming research

Status: research notes, 2026-10-19. Publisher: The Multiverse School.

This is a screen, not legal clearance. Web searches, app-store queries and RDAP lookups
can show that a conflict **exists**. They cannot show that a name is **free**. Absence
of a hit below means "not found by these searches", nothing more. Every conflict listed
is cited; nothing here is inferred from memory.

## What the name has to carry

From `README.md` and `DESIGN.md`:

- Recommendations come from **people you choose**, not a platform algorithm:
  - follows
  - "subscribe to someone's taste" (taste lists)
  - private, mutual, expiring **matches** with chosen peers, and later small circles
- Videos **spread person to person**.
- Federated (PeerTube + Nostr), ranked **on the device**, censorship-resistant, **no token**.

The repo already uses "Match Feed" as its working title, so it is checked below
alongside the owner's four candidates.

Rejected before this research: **MemeCore**. It is an existing EVM Layer 1 blockchain
with an `$M` token, listed on exchanges from July 2025
([CoinMarketCap](https://coinmarketcap.com/cmc-ai/memecore/what-is/),
[AAP/Cision release](https://www.aap.com.au/aapreleases/cision20250704ae24234)).
A no-token project should not share a name with a token. The same logic counts against
any "Meme…" name (see the Meme Video row).

## How the checks were done

| Check | Method | What worked |
|---|---|---|
| Apple App Store | `site:apps.apple.com` web search, then the iTunes Search API (`itunes.apple.com/search?entity=software&country=us`) for titles containing the name | Worked. The API rate-limited some queries; gaps are marked "not checked" |
| Google Play | `site:play.google.com` web search **ignored the site filter** and returned no Play pages, so Play's own search page (`play.google.com/store/search?q=…&c=apps`) was fetched with curl and app titles were read from it | Worked |
| Companies / crypto | Web search for the name plus "app", "company", "token" | Worked |
| US trademarks | WebFetch on `tmsearch.uspto.gov` returned only the page shell ("Trademark search"), because the site is a JavaScript app; a POST to its API returned HTTP 405. **USPTO search did not work from here.** Justia trademark pages were found by web search; fetching Justia directly returned HTTP 403, so status details come from **search-result snippets** and may be stale | Partial |
| Domains | RDAP via `https://rdap.org/domain/<domain>` (200 = registered; 404 = no record, a signal that it may be available), then `curl` to see what registered domains serve. `whois` is not installed | Worked. Some `.video` lookups were rate-limited and retried |
| §2(e)(1) | Judgment against TMEP §1209: a mark is merely descriptive if it "immediately conveys information" about a feature, function or purpose of the goods or services ([TMEP 1209 via BitLaw](https://www.bitlaw.com/source/tmep/1209.html)) | Judgment, not a ruling |

Domain legend: **reg** = RDAP record exists. **free?** = RDAP 404, which suggests the
domain may be unregistered (not proof; premium or reserved names can still be unavailable).
**parked** = registered, and the site only redirects to `/lander`, a typical parking page.

## 1. Brainstorm (48 names)

Names marked † are on the shortlist. The others were not cleared. A few have a `.com`
RDAP result noted because it was cheap to check.

**Spreading / contagion puns**

1. Meme Video † (owner's working name)
2. Viral Video † (owner)
3. Contagion Video † (owner)
4. Murmuration † (a starling flock turning together: many small local decisions, no leader)
5. Contagious
6. Catching
7. Spreadable
8. Ripple
9. Wildfire
10. Carrier
11. Chain Reel
12. Word Spreads
13. Memeplex (`.com` reg)
14. Viralry (`.com` reg)
15. Spreadly (`.com` reg)

**Taste / blend / mix**

16. Feed Blender † (owner)
17. Match Feed † (current repo name)
18. Tastemate / Tastemates †
19. Tastebloom †
20. Blendroll † (`.com` free?)
21. Taste Swap
22. Palate
23. Mixtape Video
24. Kindred
25. Same Wavelength
26. Tastewave (`.com` reg)
27. Tastetrail (`.com` reg)
28. Tastelink (`.com` reg)
29. Kinreel (`.com` reg)

**Word of mouth / passing along**

30. Grapevine †
31. Passalong †
32. Handpassed † (`.com` free?)
33. Hearsay †
34. Pass It On
35. Hand-Me-Down
36. Tip-Off
37. Say-So
38. Vouch / Vouchreel (`vouchreel.com` reg)
39. Pickpass (`.com` reg)
40. Passwise (`.com` reg)
41. Rumorreel (`.com` reg)

**Coined / short invented brandables**

42. Kithly † (from "kith and kin")
43. Kinfeed (`.com` reg)
44. Peerpick (`.com` reg)
45. Sharewave (`.com` reg)
46. Mouthful (`.com` reg)
47. Memeo
48. Vidder

## 2. Shortlist (14)

| Name | Vibe | Conflicts found (cited) | TM risk | Domain signals (.com / .video / .app / .tv) | Search collision | Notes |
|---|---|---|---|---|---|---|
| **Meme Video** (owner) | Playful; "memes" are units that spread person to person, which fits the mechanism | No app titled exactly "Meme Video" in either store, but dozens of meme-maker video apps: [Meta Meme](https://apps.apple.com/us/app/meta-meme-video-image-maker/id1173783944), [Green Screen Memes Maker](https://apps.apple.com/us/app/id6475052755), [MemeKings](https://apps.apple.com/us/app/-/id1507353181), [MeMee](https://apps.apple.com/ng/app/memee-meme-maker-generator/id6444485595). MeMedia LLC holds MEME marks; one (serial 77003545) covers "software for broadcasting and delivery of audio, video and/or multimedia content" (snippet only, status not verified) ([Justia owner page](https://trademarks.justia.com/owners/memedia-llc-1332797)). Crypto: [MemeCore $M](https://coinmarketcap.com/cmc-ai/memecore/what-is/) (already rejected), [Memecoin MEM](https://www.coinbase.com/price/meme-coin), [Memerot](https://www.fxempire.com/crypto/memerot), a TikTok "tokenize virality" launcher | **High.** "Meme video" is a content genre ([definition, VideoStudio](https://www.videostudiopro.com/en/tips/how-to-meme-video/)), so it is likely merely descriptive or generic for a video app under §2(e)(1). Prior MEME marks also cover video software | parked / free? / reg / free? (`meme.video` reg) | Very high. The phrase means a kind of clip | In Turkish, "meme" means breast ([WordReference](https://jann.wordreference.com/entr/boob), [Wiktionary](https://en.wiktionary.org/wiki/g%C3%B6%C4%9F%C3%BCs)). "Meme" also pulls toward memecoins, which works against a no-token project |
| **Viral Video** (owner) | Familiar, energetic | 12 App Store titles contain it, e.g. [Viral Videos Daily](https://apps.apple.com/us/app/viral-videos-daily/id1490697176), [Hook − Viral Video Content](https://apps.apple.com/us/app/hook-viral-video-content/id6737547221), [TikViral](https://apps.apple.com/us/app/tikviral-go-viral-video-tools/id6754115018), [Viral Vid](https://apps.apple.com/us/app/viral-vid/id6752995361). Play: "Viral Video Maker", "Nsketch: Viral Video Generator", "Vidulk: Clipping Viral Videos" (Play search). Marks: VIRAL VIDEO SHOW (class 41, registered 2021, "VIDEO SHOW" disclaimed) ([Justia](https://trademarks.justia.com/902/18/viral-video-90218558.html)) and VIRAL VIDEO SHOWDOWN ([Justia](https://trademarks.justia.com/902/18/viral-video-90218677.html)) | **Very high.** Generic term for a kind of video ([Wikipedia](https://en.wikipedia.org/wiki/Viral_video)), so likely unregistrable for video services | reg (no usable site) / reg / parked / free? | Total: the phrase has its own encyclopedia article | "Viral" also reads as disease, mildly (see Contagion). It promises reach, which the design deliberately caps (per-list caps, explore slots) |
| **Contagion Video** (owner) | Edgy, epidemiological | CONTAGION, Reg. 6162508, class 9 video game software, Monochrome Inc. ([Justia](https://trademark.justia.com/887/89/contagion-88789652.html), [owner](https://trademark.justia.com/owners/monochrome-inc-4319104)). Play: "Contagion Mobile" (`com.limitlease.contagion`, survival game) and "Contagion Protocol" (`com.thewingsmission.contagionprotocol`, "spread the signal" strategy game). App Store: [Contagion](https://apps.apple.com/us/app/contagion/id6791471286) (Medical category). The 2011 Warner Bros. pandemic film ([Wikipedia](https://en.wikipedia.org/wiki/Contagion_(2011_film))) | **Medium-high.** Class 9 overlap with a registered mark (games vs. video software is arguable, but both are downloadable software). Less descriptive than the other three | free? / free? / free? / free? (all four `contagionvideo.*`); `contagion.app` reg | High: the film, epidemiology, and "crypto contagion" as a market-crash term ([CoinDesk tag](https://www.coindesk.com/tag/contagion/2)) | **Policy risk.** Google Play bans apps that "capitalize on or are insensitive toward" sensitive events, including "public health emergencies" ([Play policy](https://support.google.com/googleplay/android-developer/answer/9878810)). Google Ads bars using sensitive-event keywords to drive traffic and added "public health emergency" in 2020 ([Google Ads policy update](https://support.google.com/adspolicy/answer/10014384), [Search Engine Land](https://searchengineland.com/google-updates-its-ads-policy-for-inappropriate-content-to-include-public-health-emergency-331971)). In 2020 Play suspended apps that merely mentioned COVID ([Reclaim The Net](https://reclaimthenet.org/google-blocks-church-app)). A name alone is unlikely to trigger removal, but it invites review friction and ad rejections during any outbreak |
| **Feed Blender** (owner) | Utilitarian, maker-ish | **FeedBlendr**, a 2007-era web service that merged RSS feeds into one, i.e. the same concept ([Genbeta](https://www.genbeta.com/sindicacion/feedblendr-nos-permitira-unificar-los-feed-en-uno-solo), [Hipertextual](https://hipertextual.com/software/feedblendr-feed-de-feeds/)). It is probably defunct; no trademark record was found. No app with this title on either store | **Medium-high.** Describes the function (blends feeds), so §2(e)(1) risk | reg (no response) / free? / free? / free? | Low-medium. "Feed blender" also means agricultural feed mixers | "Blender" sits next to well-known software brands. A Blender Foundation trademark check was **not done** |
| **Match Feed** (repo name) | Clear about matches | No app by this name. The phrase is in use for sports: Crystal Palace FC's "Match Feed" ([cpfc.co.uk](https://www.cpfc.co.uk/news/information/follow-our-premier-league-match-live-in-our-new-match-centre/)), Mingle Sport's "Match Feed" ([help center](https://intercom.help/mingle-sport/en/collections/3604333-scorekeeping-match-content)). **Match Group** enforces "match" names: it won its UK case against Muzmatch, which rebranded to Muzz ([Al Jazeera](https://www.aljazeera.com/features/2023/5/8/a-david-vs-goliath-battle-unfolding-in-the-dating-app-industry)), and it has opposed MATCHMACHINE at the TTAB ([Docket Alarm](https://www.docketalarm.com/trademarks/98182980/MATCHMACHINE)) | **Medium-high.** An app built around user "matches" invites a Match Group opposition. Also descriptive | parked / free? / reg / reg | High (sports scores) | "Match" also reads as dating |
| **Grapevine** | Warm, human, word of mouth | App Store: [AA Grapevine](https://apps.apple.com/us/app/6450056498) (Alcoholics Anonymous Grapevine, Inc.), [Grapevine Uni](https://apps.apple.com/us/app/grapevine-uni/id6740167118) (Social Networking), [Grapevine – Jobs, Salary, Social](https://apps.apple.com/us/app/grapevine-jobs-salary-social/id1641708426); 18 titles contain it. Play: "Grapevine – Real Work Talk" (`com.app.gvine`), "Grapevine" (`com.gograpevine.app.prod`). Marks: GRAPEVINE serial 90552855 for software to share electronic media (suspended 2021) ([Justia](https://trademark.justia.com/905/52/grapevine-90552855.html)), GRAPEVINE 87114606 for sharing videos ([Justia](https://trademarks.justia.com/871/14/grapevine-87114606.html)). Crypto: GrapeVine (GRAPE) on Avalanche ([CoinMarketCap](https://www.coinmarketcap.com/currencies/grapevine/)). **grapevinevideo.com is "Grapevine Video – silent movies and classic cinema on DVD"** (fetched page title) | **High.** Crowded in class 9 and social | reg (Grapevine Video, active) / free? / free? / free? (`grapevinevideo.*`) | High: a common idiom and many businesses | Strongest meaning of the batch, but the most crowded |
| **Passalong** | Friendly; "pass it along" | Past marks PASSALONG (serial 78786626) and PASSALONG NETWORKS (78475054), both **abandoned/inactive** ([trademarkregistration.app](https://trademarkregistration.app/Trademark/Details/78786626), [same](https://trademarkregistration.app/Trademark/Details/78475054)). PassAlong Networks was a Tennessee digital-music company, 2002–~2010 ([Wikipedia](https://en.wikipedia.org/wiki/PassAlong_Networks)). THE PASSALONG PAK, 1983 direct-mail mark ([Justia](https://trademark.justia.com/owners/graphic-services-corporation-307573)). No app with this title on either store | **Low-medium.** Suggestive rather than descriptive. Dead prior marks are a good sign, but an attorney should check for live ones | **passalong.com is listed for sale** (fetched page title: "PassAlong.com for sale \| Spaceship.com") / free? / reg / free? | Medium. "Pass-along rate" is a marketing term | No negative meanings found |
| **Tastemate(s)** | Social, cozy | **Tastemates**: a 2016 startup that matched people by shared movie, TV and music taste, the same concept ([TechCrunch](https://techcrunch.com/2016/05/02/tastemates-helps-you-find-people-who-like-what-you-like/)); current status unknown. [tastemate – food with friends](https://apps.apple.com/us/app/tastemate-food-with-friends/id6756938394) (Apple, plus Play `app.tastemate`), [TasteMate: AI Wellness Recipes](https://apps.apple.com/us/app/tastemate-ai-wellness-recipes/id6479318665), [TasteMate: Airfryer recipes](https://apps.apple.com/us/app/tastemate-airfryer-recipes/id6473123974). tastemate.app is a live "TasteMate" restaurant-picker site. TASTE MATE mark for foods, Reg. 6202307 ([Justia](https://trademarks.justia.com/888/28/tastemate-in-red-surrounded-with-yellow-spoon-and-88828148.html)) | **Medium.** Food marks are a different class; the 2016 Tastemates is the real issue if it is still alive | parked / free? / reg (live site) / free?; `tastemates.com` reg | Low-medium | Crowded with food apps |
| **Murmuration** | Poetic, collective, leaderless | MURMURATION, Reg. 5709924, class 35, education-reform nonprofit ([Justia](https://trademarks.justia.com/864/61/murmuration-86461857.html)); its app "Organizer by Murmuration" is on Play (`org.murmuration.canvassingandroid`). Play game "Murmur: Starling Murmuration". Murmuras, a Bonn startup named after the word ([about](https://murmuras.com/about)). [Murmuration 666](https://opensea.io/zh-TW/collection/murmuration-666/overview) NFT collection | **Medium.** Registered in a different class; arbitrary for video | reg / free? / parked / free? | Medium: nature videos, poems, music | Hard to spell and say; four syllables |
| **Kithly** | Warm coined name ("kith and kin") | **[Kithly: Safe Family Social](https://apps.apple.com/us/app/kithly-safe-family-social/id6793655846)** (App Store, Social Networking; also Play `com.kithly.kithly`, "Capture life, Together"). [kithly](https://apps.apple.com/us/app/kithly/id6751573588) (productivity). A Kithly **video-gift** service ([LinkedIn](https://sg.linkedin.com/in/priyathg)). Kithly relationship app, 2012 ([Gust](https://gust.com/companies/kithly_2)). Kith streetwear brand ([Wikipedia](https://en.wikipedia.org/wiki/Kith_(brand))) | **High.** A live social app with the same name | parked / free? / reg (live site) / free? | Low | Taken in practice |
| **Hearsay** | Gossipy, wry | Hearsay Social / Hearsay Systems marks: HEARSAY SOCIAL Reg. 4236941 (SaaS), HEARSAY RELATE (downloadable messaging apps) and others ([Justia](https://trademark.justia.com/855/68/hearsay-85568497.html), [owner](https://trademark.justia.com/owners/hearsay-social-inc-5307602)). App Store: [Hearsay Mobile by Yext](https://apps.apple.com/us/app/hearsay-mobile-by-yext/id1058665351), [Hearsay: Family Party Game](https://apps.apple.com/us/app/hearsay-family-party-game/id6793556159), [Hearsay.](https://apps.apple.com/us/app/hearsay/id6757171549) (Social Networking) | **High.** Live marks for software and messaging apps | free? / not checked (rate-limited) / free? / free? (`hearsayvideo.*`) | High: a legal term | Means unreliable second-hand evidence, the opposite of "trusted recommendations" |
| **Tastebloom** | Soft, growth, discovery | None found. Search returned Teabloom, a blooming-tea brand ([listing](https://www.ubuy.com.eg/en/brand/teabloom)), which sells different goods. No app with this title on either store | **Low** (signal only). Suggestive | reg (no response) / free? / free? / free? | Low | Reads as food or cosmetics more than video |
| **Handpassed** | Human, tactile, "passed hand to hand" | None found by web search. No Play title. **App Store not checked** (the API rate-limited). Nearest: [OneHandPass](https://apps.apple.com/mx/app/onehandpass/id6751720999), a password tool | **Low** (signal only). Suggestive, not descriptive | **free? / free? / free? / free?** | Low. "Handpass" is a move in Australian rules football (general knowledge, not checked) | Past tense reads a little flat; works as "Handpassed: videos your people pass you" |
| **Blendroll** | Taste blend plus a reel or roll | None found. Nearest: BrightRoll, a discontinued Yahoo/Verizon video-ad platform ([Wikipedia](https://en.wikipedia.org/wiki/BrightRoll)); "blending roll" abrasives (3M, Walter). No title on Apple (0 name matches) or Play | **Low** (signal only). Suggestive | **free? / free? / free? / free?** | Low | Spotify "Blend" is cited in DESIGN.md as prior art. A Spotify BLEND trademark check was **not done** |

Store queries behind the table: Google Play search pages fetched 2026-10-19
(`https://play.google.com/store/search?q=<name>&c=apps`); App Store queries through
`https://itunes.apple.com/search?term=<name>&entity=software&country=us`. RDAP:
`https://rdap.org/domain/<domain>`.

## 3. Strongest picks (options, not a verdict)

**A. Passalong**

- Why it fits: says exactly how videos move ("passed along by people you chose"). It is plain English, easy to spell, and has no disease or crypto baggage.
- Upside:
  - The prior US marks found are dead.
  - The `.com` is openly listed for sale.
  - `.video` and `.tv` look unregistered.
- Tradeoffs:
  - `passalong.com` will cost money; `passalong.app` is taken.
  - "Pass-along rate" is marketing jargon, so search ranking will take time.
  - A defunct music company once used the name.

**B. Handpassed**

- Why it fits: the most person-to-person name on the list.
- Upside: cleanest signals found, with all four domains showing no RDAP record and no apps, companies or marks found.
- Tradeoffs:
  - Unfamiliar word, and the past tense is a little flat.
  - The App Store check was incomplete.
  - The football meaning is minor in the US but real in Australia.

**C. Blendroll**

- Why it fits: carries the "taste blend / matches" idea and a video "reel/roll".
- Upside: all four domains showed no RDAP record, and no conflicts were found.
- Tradeoffs:
  - It says less about people than A or B.
  - "Blend" points at Spotify Blend; check whether Spotify holds a BLEND mark.
  - It echoes BrightRoll, a dead video-ad brand, which matters little.

**D. Tastebloom**

- Why it fits: the warmest "taste" name, suggesting discovery that grows.
- Upside: no conflicts found, and `.video`/`.app`/`.tv` show no RDAP record.
- Tradeoffs:
  - `.com` is registered.
  - It reads like food or skincare.
  - It does not say "video" or "people".

**E. Keep "Meme Video" as a descriptor, not the brand**

- How it works: the owner's working name describes the idea well (memes spread person to person). Use it as a tagline under a distinctive brand, for example "Passalong — meme video from people you trust".
- Tradeoffs:
  - As a registered brand it is weak: probably descriptive or generic for a video app, with MEME marks for video software and the memecoin and MemeCore association.
  - "Meme" means breast in Turkish.

**Names to avoid, given the evidence:**

- **Contagion Video:** a registered class 9 mark, two same-name Play apps, and pandemic-sensitivity policy risk on Play and Google Ads.
- **Viral Video:** generic.
- **Kithly:** a live social app with the same name.
- **Hearsay:** live software marks, and the meaning is wrong for trusted recommendations.
- **Grapevine:** crowded, including an existing "Grapevine Video".

**Weak but possible:**

- **Feed Blender:** FeedBlendr was prior art for the same concept, and the name is descriptive.
- **Match Feed:** Match Group enforcement risk.
- **Tastemates:** a 2016 startup had the same concept.
- **Murmuration:** a different-class registration, and the name is hard to spell.

## 4. Next steps

1. **Formal knockout search** on USPTO Trademark Search (`tmsearch.uspto.gov`; it did not work from this environment) for the 2–3 finalists. Cover:
   - class 9 (downloadable software)
   - class 38 (transmission and streaming)
   - class 41 (entertainment, video)
   - class 42 (SaaS)
   - class 45 (online social networking)
   Include phonetic variants (Pass-Along, Passalong, Pass Along; Hand Passed; Blend Roll). Confirm the live or dead status of every record cited here in TSDR.
2. **Attorney clearance** before public launch. Ask for:
   - a full search, including common-law use and state registrations
   - an EUIPO/WIPO check, because a federated network has users abroad 
   - a view on §2(e)(1) for the chosen name
3. **Check the open items noted above:**
   - Spotify BLEND (for Blendroll)
   - Blender Foundation (for Feed Blender)
   - whether the 2016 Tastemates is still alive
   - the App Store result for Handpassed
4. **Buy domains for the finalist promptly.** RDAP "no record" is only a signal, and searches like these can tip off domain speculators:
   - `.com`; for Passalong, negotiate the for-sale listing
   - `.app`, which requires HTTPS (HSTS-preloaded TLD)
   - `.video` and `.tv`
   - typo variants
5. **Reserve handles** on Nostr (a NIP-05 identifier on the chosen domain), PeerTube, GitHub, Bluesky and Mastodon, plus store developer names.
6. **Language check:** native-speaker screen of the finalist in the top languages of the PeerTube user base (French, German, Spanish, Italian, Japanese, Turkish).
