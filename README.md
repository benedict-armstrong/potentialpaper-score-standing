# Score standing

A [PotentialPaper](https://github.com/PotentialHedge/potentialpaper) plugin: where a paper's review scores stand
among the submissions at its venue, and a venue's whole distribution. The "where you stand" figure from acceptodds,
for review scores.

- **On a paper** (side column): the paper's mean over its reviews, marked on the venue's histogram and on a curve,
  with the share of submissions below it shaded and its band ("Top 12%"). A paper that went to several venues
  (rejected at one, accepted at the next) gets a tab per venue.
- **On a venue** (main column): the whole distribution, split by decision once decisions are out, which shows the
  accept rate at each score. A series gets a tab per edition.
- **On an organisation**: its papers' distribution at each venue, drawn as on a venue. The view the plan describes
  (the venue's distribution with the org's papers as open circles, named on hover) waits for organisation pages to
  have members; see "Later".

Two figures, because review scores are discrete (ICLR rates on {1, 3, 5, 6, 8, 10}), so means bunch at a few
values. The **histogram** shows that bunching honestly. The **curve** is a kernel density whose bandwidth is never
narrower than 0.8 times the widest gap between the values that hold 90% of the submissions, so it doesn't invent
modes between them (`src/distribution.ts`, tested on simulated ICLR-sized venues in `test/distribution.test.ts`).
Hover, or focus a figure and use the arrow keys, to read it off: a bar's range, count and share; on the curve, how
many papers are below a score and, split, the accept rate there.

## Settings

| Setting           | Values                                    | Default |
| ----------------- | ----------------------------------------- | ------- |
| `view`            | `both`, `histogram`, `curve`              | `both`  |
| `field`           | a score field's key (`rating`, `soundness`, …); empty is the venue's first, usually the overall rating | `""` |
| `splitByDecision` | `auto` (once decisions are out), `on`, `off` | `auto` |

The field switcher above the figure sets `field`. In `settings.json` they are
`benedict-armstrong/score-standing.view` and so on.

## Permissions and data

- `scope.read`: the site's score statistics (`pp.scope.scores`), per venue and score field: every submission's
  mean, sorted, the bins and the split by outcome. The figure needs nothing else.
- `reviews.read`: the paper's own reviews (`pp.reviews.forPaper`), for its mean.

No network access of its own. Each field fetched is kept in the plugin's own IndexedDB, stamped with the
statistics' `computedAt`; moving between papers at the same venue only asks for the list of fields (small) and
reuses the values. If the site holds statistics back until a venue's decisions are out
(`plugins.venueStats.hideUntil`), the panel says so.

## Develop

    npm install
    npm run dev          # rebuilds dist/ on change, serves the repo with CORS on http://localhost:5175/
    npm test             # the figure maths, the panel in a DOM against a fake host
    npm run typecheck

Then, on your local PotentialPaper (`npm run dev` there), open `/settings/plugins` and load `http://localhost:5175/`
under "Load from localhost".

`dist/` is committed: PotentialPaper serves a plugin's files from the repo at a pinned commit and never builds.
CI fails if `dist/` doesn't match a fresh build, so run `npm run build` and commit `dist/` with your change
(`npm run check` does all of it).

## Release

Bump `version` in `potentialpaper-plugin.json` and `package.json`, build, commit, and tag `v<version>`. Readers who
installed it see "Update" on `/settings/plugins`. The repo carries the `potentialpaper-plugin` topic, so it is listed
under Discover.

## Later

- **Org view** (v0.2, when organisation pages have members): the venue's whole distribution, with the org's papers
  as open circles on the curve, named on hover.
- **Before and after rebuttal** (v0.2): the paper's position from the review files' git history; needs a
  `reviews.history` method in the host.

MIT licence.
