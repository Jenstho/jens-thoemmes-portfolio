# jens-thoemmes.com

Academic portfolio of Jens Thoemmes, CNRS senior researcher (UTOPI, UMR 5311). Static site
served by GitHub Pages from the repository root.

## Structure

| Path | Contents |
| --- | --- |
| `index.html` | The entire site. Markup, CSS, publication data and logic in one file. |
| `assets/fulltext/` | Self-hosted open-access PDFs, one per publication, named by HAL id. |
| `assets/` | Social card image. |
| `sitemap.xml` | Page anchors plus every full-text PDF. |
| `robots.txt`, `CNAME` | Crawler rules, custom domain. |
| `tools/render-static.js` | Regenerates the static copy of the publication list. See below. |

## After changing publicationsData, run this

```sh
node tools/render-static.js
```

The list is drawn by `renderPublications()` at runtime, so a crawler that does not execute
JavaScript would otherwise see a page with no publications on it. Google Search renders JS;
Google Scholar's crawler and most AI fetchers do not. This script writes the same cards into
`#publicationsList` as plain HTML, between two markers. On load the runtime replaces them with
identical output, so a human visitor sees no difference.

Skipping it fails silently: the page looks perfect in a browser while every crawler reads a
stale list. The script needs no network and calls no external API, so unlike a HAL sync script
it cannot break when someone else's service changes.

Publication records live in the `publicationsData` object inside `index.html`, grouped into
`books`, `bookChapters`, `journalArticles`, `conferencePapers`, `technicalReports` and
`preprints`. Counts shown on the page are computed at runtime from that object, so the
static numbers in the markup and meta tags are only fallbacks for crawlers.

Fields used per entry:

- `url`: the HAL record. The archive of record.
- `fullText`: local path under `assets/fulltext/`. Renders the primary "Full text (PDF)" button.
- `doi`: bare DOI. Renders a "Published version" button linking to `https://doi.org/<doi>`,
  and is exported in BibTeX.
- `doiResolves: false`: suppresses the button for a DOI that is registered but whose publisher
  target is broken. The DOI stays in the BibTeX export.

Interface text is in the `translations` object (`en`, `fr`, `de`). Every user-visible string
belongs there, not in the markup, except the fallback copy that ships in the HTML for crawlers
and for readers without JavaScript.

## Why the PDFs are self-hosted

HAL runs Anubis, a proof-of-work anti-scraper gate, on every `hal.science` and
`shs.hal.science` URL: landing pages, `/document` and direct `/file/*.pdf` alike. The trigger is
the User-Agent, so any real browser is shown a "Making sure you're not a bot!" screen before the
file, and no URL form or request header avoids it. HAL's `robots.txt` separately blocks
`facebookexternalhit`, `ClaudeBot`, `GPTBot`, `PerplexityBot`, `Applebot` and others outright,
so link previews and AI assistants cannot reach the full texts at all.

Serving the PDFs from this domain removes both problems. HAL stays linked on every card as the
archive of record.

The same gate now runs at OpenEdition and Érudit, and Cairn and MDPI have their own bot walls.
So do not assume a publisher link is a working route to a PDF.

## Updating from HAL

Roughly three or four publications a year, so this is a manual pass, not a pipeline. There is
deliberately no script: at this frequency one would rot between runs faster than it would save
effort.

1. **List what HAL has.** The API needs no key:

   ```
   https://api.archives-ouvertes.fr/search/?q=authFullName_s:"Jens Thoemmes"
     &fl=halId_s,title_s,producedDateY_i,docType_s,fileMain_s,doiId_s,journalTitle_s
     &rows=500&wt=json
   ```

2. **Diff against the site.** Compare `halId_s` against the ids already in the `url` fields of
   `index.html`. Watch for duplicate HAL records of the same text: `hal-03095608` and
   `hal-01573501` are the same chapter, and only one is still returned by the API.

3. **Full text.** `fileMain_s` gives the PDF. Download it with **no User-Agent header**, which is
   what gets past the gate:

   ```
   curl -H "User-Agent:" -o assets/fulltext/<halId>.pdf https://hal.science/<halId>/document
   ```

   Then check it is a real file, not a saved challenge page: it must start with `%PDF-`, contain
   `%%EOF`, and match HAL's `content-length`.

4. **DOI.** Take it from `doiId_s`. When HAL has none, Crossref can be searched by title, but
   verify each hit by hand. One in twelve of those matches was wrong here: the PUF book
   *Vers la fin du temps de travail?* matched a DOI belonging to Claude Durand's review of it,
   because JSTOR lists reviewer and reviewed author together.

5. **Verify, do not trust.** A metadata field is a hypothesis. OpenAlex advertised publisher PDF
   URLs for thirteen items; when actually fetched, only three returned a PDF. Check the DOI
   resolves and, if it does not, work out whether the cause is a bot wall (fine for human
   visitors, leave it alone) or a dead target (set `doiResolves: false`).

6. **Then update:** add the entry, add the sitemap line for the new PDF, and refresh
   `dateModified` in the JSON-LD blocks and `lastmod` in `sitemap.xml`. The visible counts need
   no edit, but the fallback numbers in the meta tags and static markup do.

## Checking the mirror is current

Local copies go stale silently if a HAL deposit is revised. Compare byte sizes:

```sh
for f in assets/fulltext/*.pdf; do
  id=$(basename "$f" .pdf)
  # -L matters: halshs-* ids redirect from hal.science to shs.hal.science
  remote=$(curl -sIL -H "User-Agent:" "https://hal.science/$id/document" \
           | awk 'tolower($1)=="content-length:"{print $2}' | tr -d '\r' | tail -1)
  local=$(wc -c < "$f" | tr -d ' ')
  [ -n "$remote" ] || { echo "NO FILE ON HAL  $id"; continue; }
  [ "$remote" = "$local" ] || echo "STALE $id  local=$local remote=$remote"
done
```

## Rights

The mirrored PDFs are HAL deposits. Depositing in an open archive does not by itself license
redistribution from a personal website, and the monographs (Octarès, Routledge, PUF, Lexington)
are where that gap is widest. To withdraw one item, delete its file from `assets/fulltext/`, its
line from `sitemap.xml`, and point its `fullText` back at `https://hal.science/<halId>/document`.
