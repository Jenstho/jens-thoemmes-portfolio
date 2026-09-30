#!/usr/bin/env node
/*
 * Writes the publication list into index.html as plain HTML, one page per publication
 * under p/, and the matching block of sitemap.xml.
 *
 * Why this exists. The list is held in the `publicationsData` object and drawn by
 * renderPublications() at runtime, so a crawler that does not execute JavaScript sees
 * a page with no publications on it. Google Search renders JS; Google Scholar's crawler
 * and most AI fetchers do not. This script emits the same cards as static markup between
 * two markers inside #publicationsList. On load, renderPublications() replaces them with
 * identical output, so nothing changes for a human visitor.
 *
 * Unlike a HAL sync script, this one touches no network and no external API, so it cannot
 * rot when someone else's service changes. It is committed because skipping it is silent:
 * add a publication without re-running this and the static list simply goes stale for
 * every crawler while looking perfect in a browser.
 *
 * Run from the repository root, after any change to publicationsData:
 *
 *     node tools/render-static.js
 *
 * It rewrites index.html in place and prints what it did. Re-running is safe.
 *
 * The pages under p/ exist for Google Scholar, which reads citation_* meta tags only from
 * a page describing exactly one work, and for anyone who wants to link to one publication.
 * The whole p/ directory is deleted and rebuilt on every run, so do not edit it by hand.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'index.html');
const BEGIN = '<!-- BEGIN generated publication list. Produced by tools/render-static.js, do not edit by hand. -->';
const END = '<!-- END generated publication list -->';

const html = fs.readFileSync(FILE, 'utf8');

// Pull publicationsData, the English labels and the citation helpers out of the inline
// script, without a DOM.
const scripts = [...html.matchAll(/<script(?![^>]*src=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).join('\n;\n');
const start = scripts.indexOf('const translations');
const end = scripts.indexOf('// Combine all publications');
if (start === -1 || end === -1) {
  console.error('Could not locate the data block in index.html. Has the file been restructured?');
  process.exit(1);
}
const {
  translations, publicationsData, publicationAbstracts, recordLabel, cardExtrasHtml, versionNote,
  pageSlug, formatReference, bibtexEntry, risEntry, citationKey, parseAuthors, parseEditors, splitVolume
} = new Function(scripts.slice(start, end) + `; return {
  translations, publicationsData, publicationAbstracts, recordLabel, cardExtrasHtml, versionNote,
  pageSlug, formatReference, bibtexEntry, risEntry, citationKey, parseAuthors, parseEditors, splitVolume
};`)();

const all = Object.values(publicationsData).flat()
  .sort((a, b) => parseInt(b.year) - parseInt(a.year));
const t = translations.en;

// Static output is escaped properly, which the runtime template does not need to do
// because it assigns through innerHTML.
const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const meta = pub => {
  const bits = [
    `<span>${esc((t.typeLabelsSingular && t.typeLabelsSingular[pub.type]) || t.typeLabels[pub.type] || pub.type.replace('-', ' '))}</span>`,
    `<span>•</span>`,
    `<span>${esc(pub.language.toUpperCase())}</span>`,
  ];
  const add = (cond, label) => { if (cond) bits.push('<span>•</span>', `<span>${esc(label)}</span>`); };
  add(pub.journal, pub.journal);
  add(pub.publisher, pub.publisher);
  add(pub.inBook, `In: ${pub.inBook}`);
  add(pub.conference, `Conference: ${pub.conference}`);
  add(pub.location, pub.location);
  add(pub.pages, pub.pages);
  add(pub.volume, `Vol. ${pub.volume}`);
  return bits.join('\n            ');
};

const card = pub => `      <div class="publication-card">
        <div class="publication-header">
          <h3 class="publication-title"><a href="p/${pageSlug(pub)}/">${esc(pub.title)}</a></h3>
          <span class="publication-year">${esc(pub.year)}</span>
        </div>
${pub.authors ? `        <div class="publication-authors">${esc(pub.authors)}</div>\n` : ''}        <div class="publication-meta">
            ${meta(pub)}
        </div>
${pub.editors ? `        <div style="margin-top: 0.5rem; font-style: italic; color: var(--text-tertiary); font-size: 0.875rem;">Edited by: ${esc(pub.editors)}</div>\n` : ''}${pub.tags && pub.tags.length ? `        <div style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
${pub.tags.map(tag => `          <span class="publication-tag">${esc(tag)}</span>`).join('\n')}
        </div>\n` : ''}        <div class="publication-actions">
${pub.fullText ? `          <a href="${esc(pub.fullText)}" target="_blank" rel="noopener noreferrer" class="action-button action-button-primary">${esc(t.viewFullText)}</a>\n` : ''}${pub.doi && pub.doiResolves !== false && !pub.url.includes('ssrn.com') ? `          <a href="https://doi.org/${esc(pub.doi)}" target="_blank" rel="noopener noreferrer" class="action-button">${esc(t.viewPublished)}</a>\n` : ''}${pub.url ? `          <a href="${esc(pub.url)}" target="_blank" rel="noopener noreferrer" class="action-button">${esc(recordLabel(pub, t))}</a>\n` : ''}        </div>
        ${cardExtrasHtml(pub, t)}
      </div>`;

const block = [BEGIN, ...all.map(card), END].join('\n');

const container = /(<div id="publicationsList" class="publications-container">\n)([\s\S]*?)(\n    <\/div>)/;
if (!container.test(html)) {
  console.error('Could not find the #publicationsList container in index.html.');
  process.exit(1);
}
fs.writeFileSync(FILE, html.replace(container, (_m, open, _old, close) => open + block + close), 'utf8');

// ---------------------------------------------------------------------------
// One page per publication
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..');
const SITE = 'https://jens-thoemmes.com';
const PAGES = path.join(ROOT, 'p');
// Full author names, for citation_author. Entries missing here fall back to initials.
const fullNames = JSON.parse(fs.readFileSync(path.join(__dirname, 'author-names.json'), 'utf8'));

const slugs = all.map(pageSlug);
const duplicate = slugs.find((s, i) => slugs.indexOf(s) !== i);
if (duplicate) {
  console.error(`Two publications share the page address "${duplicate}".`);
  process.exit(1);
}

const typeLabel = pub => t.typeLabelsSingular[pub.type] || pub.type;
const doiUrl = pub => pub.doi && pub.doiResolves !== false && !pub.url.includes('ssrn.com')
  ? `https://doi.org/${pub.doi}` : '';
const authorNames = pub => fullNames[pub.id] ||
  parseAuthors(pub.authors).map(a => `${a.family}, ${a.given}`);

// Where the work appeared, as one line
const sourceLine = pub => [
  pub.journal && [pub.journal, pub.volume].filter(Boolean).join(', '),
  pub.inBook && `In: ${pub.inBook}`,
  pub.editors,
  pub.conference,
  pub.location,
  pub.publisher,
  pub.pages && pub.type !== 'book' && `pp. ${pub.pages}`
].filter(Boolean).join(' · ');

const metaTags = pub => {
  const { volume, issue } = splitVolume(pub.volume);
  const [first, last] = pub.type !== 'book' && pub.pages ? pub.pages.split('-') : [];
  const container = {
    'journal-article': 'citation_journal_title',
    'preprint': 'citation_journal_title',
    'book-chapter': 'citation_inbook_title',
    'conference': 'citation_conference_title'
  }[pub.type];
  return [
    ['citation_title', pub.title],
    ...authorNames(pub).map(name => ['citation_author', name]),
    ['citation_publication_date', pub.year],
    [container, pub.journal || pub.inBook || pub.conference],
    ['citation_volume', volume],
    ['citation_issue', issue],
    ['citation_firstpage', first],
    ['citation_lastpage', last],
    [pub.type === 'report' ? 'citation_technical_report_institution' : 'citation_publisher', pub.publisher],
    ['citation_isbn', pub.isbn],
    ['citation_doi', pub.doi],
    ['citation_language', pub.language],
    ['citation_pdf_url', pub.fullText && `${SITE}/${pub.fullText}`],
    ['citation_abstract_html_url', `${SITE}/p/${pageSlug(pub)}/`]
  ].filter(([name, value]) => name && value)
    .map(([name, value]) => `  <meta name="${name}" content="${esc(value)}">`).join('\n');
};

const jsonLd = pub => {
  const abstract = publicationAbstracts[pub.id];
  const container = pub.journal || pub.inBook;
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': { 'book': 'Book', 'book-chapter': 'Chapter', 'report': 'Report' }[pub.type] || 'ScholarlyArticle',
    name: pub.title,
    author: authorNames(pub).map(name => ({ '@type': 'Person', name })),
    datePublished: pub.year,
    inLanguage: pub.language,
    isPartOf: container ? { '@type': pub.journal ? 'Periodical' : 'Book', name: container } : undefined,
    publisher: pub.publisher ? { '@type': 'Organization', name: pub.publisher } : undefined,
    pagination: pub.type !== 'book' ? pub.pages : undefined,
    abstract: abstract ? abstract[1] : undefined,
    identifier: pub.doi ? `https://doi.org/${pub.doi}` : undefined,
    url: `${SITE}/p/${pageSlug(pub)}/`,
    sameAs: pub.url
  }, null, 2).replace(/</g, '\\u003c');
};

const PAGE_CSS = `
    :root { --bg: #ffffff; --panel: #f3f4f6; --text: #111827; --muted: #4b5563; --border: #e5e7eb; --primary: #0e7490; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0f172a; --panel: #1e293b; --text: #f1f5f9; --muted: #cbd5e1; --border: #334155; --primary: #22d3ee; }
    }
    * { box-sizing: border-box; margin: 0; }
    body { background: var(--bg); color: var(--text); line-height: 1.6;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    a { color: var(--primary); }
    header, main, footer { max-width: 860px; margin: 0 auto; padding: 1.25rem 1.25rem 0; }
    header { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; font-size: 0.95rem; }
    header a { text-decoration: none; font-weight: 600; }
    h1 { font-size: 1.7rem; line-height: 1.3; margin: 1.5rem 0 0.75rem; }
    h2 { font-size: 1.1rem; margin: 2rem 0 0.5rem; }
    .authors { font-size: 1.05rem; }
    .source, .note { color: var(--muted); font-size: 0.95rem; margin-top: 0.25rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1.25rem; }
    .actions a { border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 1rem;
      text-decoration: none; font-size: 0.9rem; }
    .actions a.primary { background: var(--primary); border-color: var(--primary); color: var(--bg); font-weight: 600; }
    .box { background: var(--panel); border-radius: 6px; padding: 0.75rem 1rem; overflow-wrap: anywhere; }
    pre.box { font-size: 0.8rem; white-space: pre-wrap; margin-top: 0.75rem; }
    .themes { margin-top: 0.5rem; font-size: 0.9rem; }
    footer { color: var(--muted); font-size: 0.85rem; padding-bottom: 2.5rem; margin-top: 2.5rem; }
`;

const page = pub => {
  const slug = pageSlug(pub);
  const abstract = publicationAbstracts[pub.id];
  const reference = formatReference(pub);
  const description = (abstract ? abstract[1] : reference).replace(/\s+/g, ' ').slice(0, 300);
  const doi = doiUrl(pub);
  return `<!DOCTYPE html>
<!-- Generated by tools/render-static.js from publicationsData in index.html. Do not edit by hand. -->
<html lang="${esc(pub.language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(pub.title)} | Jens Thoemmes</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}/p/${slug}/">
  <link rel="icon" href="/favicon.png" sizes="32x32" type="image/png">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
${metaTags(pub)}
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(pub.title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${SITE}/p/${slug}/">
  <meta property="og:image" content="${SITE}/assets/social-card.png">
  <script type="application/ld+json">
${jsonLd(pub)}
  </script>
  <style>${PAGE_CSS}  </style>
</head>
<body>
  <header lang="en">
    <a href="/">Jens Thoemmes</a>
    <a href="/#publications">All publications</a>
  </header>
  <main>
    <h1>${esc(pub.title)}</h1>
    <p class="authors">${esc(pub.authors)}</p>
    <p class="source" lang="en">${esc([typeLabel(pub), pub.year, sourceLine(pub)].filter(Boolean).join(' · '))}</p>
    <div class="actions" lang="en">
${[
    pub.fullText && `      <a class="primary" href="/${esc(pub.fullText)}">${esc(t.viewFullText)}</a>`,
    doi && `      <a href="${esc(doi)}" rel="noopener">${esc(t.viewPublished)}</a>`,
    pub.url && `      <a href="${esc(pub.url)}" rel="noopener">${esc(recordLabel(pub, t))}</a>`
  ].filter(Boolean).join('\n')}
    </div>
    ${versionNote(pub, t).replace('class="fulltext-version"', 'class="note" lang="en"')}
${abstract ? `    <h2 lang="en">${esc(t.abstract)}</h2>
    <p lang="${esc(abstract[0])}">${esc(abstract[1])}</p>\n` : ''}    <h2 lang="en">${esc(t.cite)}</h2>
    <p class="box">${esc(reference)}</p>
    <pre class="box">${esc(bibtexEntry(pub))}</pre>
    <p class="note" lang="en"><a download="${citationKey(pub)}.ris" href="data:application/x-research-info-systems;charset=utf-8,${encodeURIComponent(risEntry(pub))}">RIS</a></p>
${pub.themes && pub.themes.length ? `    <p class="themes" lang="en">${pub.themes.map(theme =>
    `<a href="/?theme=${encodeURIComponent(theme)}#publications">${esc(theme)}</a>`).join(' · ')}</p>\n` : ''}  </main>
  <footer lang="en">
    <a href="/">jens-thoemmes.com</a>
  </footer>
</body>
</html>
`;
};

fs.rmSync(PAGES, { recursive: true, force: true });
all.forEach(pub => {
  const dir = path.join(PAGES, pageSlug(pub));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(pub), 'utf8');
});

// The sitemap lists every page, between two markers
const MAP = path.join(ROOT, 'sitemap.xml');
const MAP_BEGIN = '  <!-- BEGIN publication pages. Produced by tools/render-static.js -->';
const MAP_END = '  <!-- END publication pages -->';
const mapBlock = [MAP_BEGIN, ...slugs.map(slug => `  <url>
    <loc>${SITE}/p/${slug}/</loc>
    <changefreq>yearly</changefreq>
    <priority>0.8</priority>
  </url>`), MAP_END].join('\n');
let sitemap = fs.readFileSync(MAP, 'utf8');
if (sitemap.includes(MAP_BEGIN)) {
  sitemap = sitemap.slice(0, sitemap.indexOf(MAP_BEGIN)) + mapBlock +
    sitemap.slice(sitemap.indexOf(MAP_END) + MAP_END.length);
} else {
  sitemap = sitemap.replace('</urlset>', mapBlock + '\n\n</urlset>');
}
fs.writeFileSync(MAP, sitemap, 'utf8');

const withFullText = all.filter(p => p.fullText).length;
const withDoi = all.filter(p => p.doi && p.doiResolves !== false && !p.url.includes('ssrn.com')).length;
console.log(`Wrote ${all.length} publication cards into index.html as static HTML.`);
console.log(`  full-text links: ${withFullText}`);
console.log(`  DOI links:       ${withDoi}`);
console.log(`Wrote ${all.length} pages under p/ and listed them in sitemap.xml.`);
console.log('Re-run this after any change to publicationsData.');
