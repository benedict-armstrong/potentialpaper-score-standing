# Score standing

A [PotentialPaper](https://github.com/PotentialHedge/potentialpaper) plugin: where a paper's review scores stand
among the submissions at its venue, and a venue's whole distribution. The "where you stand" figure from acceptodds,
for review scores.

- **On a paper** (in the Submissions section, under each submission that has scores): the paper's mean over its
  reviews, marked on that venue's bar chart or curve, with the share of submissions below it shaded and its
  band ("Top 12%"). A paper that went to several venues (rejected at one, accepted at the next) gets a figure under
  each.
- **On a venue** (main column): the whole distribution, split by decision once decisions are out, which shows the
  accept rate at each score. A series gets a tab per edition.
- **On an organisation** (main column): each venue its papers went to, drawn whole from the venue's own page, with
  the organisation's submissions as open circles on the curve (and above their bars on the histogram), named on
  hover with their mean and band; up and down arrows step from one to the next, and a click or Enter opens the paper.
  A tab per venue. A venue with no page of its own (a track) shows the organisation's own distribution, still marked.

Two figures, switched by the toggle beside the summary line (the same height, so switching doesn't resize the
frame). Review scores are discrete (ICLR rates on {1, 3, 5, 6, 8, 10}), so means bunch at a few values: the
**bar chart** shows that bunching honestly. The **curve** is drawn as acceptodds draws it: a kernel density whose
kernel is 6% of the scale wide (so neighbouring thirds blend into one shape), scaled to peak at 1
(`src/distribution.ts`). Both span the venue's scale: the form's range, or else the means' extremes rounded out to
whole scores, so an axis never runs past the scale's ends. Hover a legend item to pick out that outcome.
Hover, or focus a figure and use the arrow keys, to read it off: a bar's range, count and share; on the curve, how
many papers are below a score and, split, the accept rate there.

## Settings

| Setting           | Values                                    | Default |
| ----------------- | ----------------------------------------- | ------- |
| `view`            | `histogram` (bar chart), `curve`          | `histogram` |
| `field`           | a score field's key (`rating`, `soundness`, …); empty is the venue's first, usually the overall rating | `""` |
| `splitByDecision` | `auto` (once decisions are out), `on`, `off` | `auto` |

The toggle and the score picker beside the summary line set `view` and `field`. In `settings.json` they are
`benedict-armstrong/score-standing.view` and so on.

## Permissions and data

- `scope.read`: the site's score statistics (`pp.scope.scores`), per venue and score field: every submission's
  mean, sorted, the bins and the split by outcome. On an organisation, the venue's own page (`venue.page` in the
  list) gives the whole distribution, and `{ marks: true }` on the organisation's field names its submissions with
  their means (up to 1,000; more are drawn without names). The figure needs nothing else.
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

- **Before and after rebuttal**: the paper's position from the review files' git history; needs a
  `reviews.history` method in the host.

MIT licence.
