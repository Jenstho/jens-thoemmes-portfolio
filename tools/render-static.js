#!/usr/bin/env node
/*
 * Writes the publication list into index.html as plain HTML.
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
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'index.html');
const BEGIN = '<!-- BEGIN generated publication list. Produced by tools/render-static.js, do not edit by hand. -->';
const END = '<!-- END generated publication list -->';

const html = fs.readFileSync(FILE, 'utf8');

// Pull publicationsData and the English labels out of the inline script, without a DOM.
const scripts = [...html.matchAll(/<script(?![^>]*src=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).join('\n;\n');
const start = scripts.indexOf('const translations');
const end = scripts.indexOf('// Combine all publications');
if (start === -1 || end === -1) {
  console.error('Could not locate the data block in index.html. Has the file been restructured?');
  process.exit(1);
}
const { translations, publicationsData } =
  new Function(scripts.slice(start, end) + '; return { translations, publicationsData };')();

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
          <h3 class="publication-title">${esc(pub.title)}</h3>
          <span class="publication-year">${esc(pub.year)}</span>
        </div>
${pub.authors ? `        <div class="publication-authors">${esc(pub.authors)}</div>\n` : ''}        <div class="publication-meta">
            ${meta(pub)}
        </div>
${pub.editors ? `        <div style="margin-top: 0.5rem; font-style: italic; color: var(--text-tertiary); font-size: 0.875rem;">Edited by: ${esc(pub.editors)}</div>\n` : ''}${pub.tags && pub.tags.length ? `        <div style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
${pub.tags.map(tag => `          <span class="publication-tag">${esc(tag)}</span>`).join('\n')}
        </div>\n` : ''}        <div class="publication-actions">
${pub.fullText ? `          <a href="${esc(pub.fullText)}" target="_blank" rel="noopener noreferrer" class="action-button action-button-primary">${esc(t.viewFullText)}</a>\n` : ''}${pub.doi && pub.doiResolves !== false && !pub.url.includes('ssrn.com') ? `          <a href="https://doi.org/${esc(pub.doi)}" target="_blank" rel="noopener noreferrer" class="action-button">${esc(t.viewPublished)}</a>\n` : ''}${pub.url ? `          <a href="${esc(pub.url)}" target="_blank" rel="noopener noreferrer" class="action-button">${esc(
    pub.url.includes('ssrn.com') ? t.viewOnSSRN : pub.url.includes('.pdf') ? t.viewPDF : t.viewOnHAL)}</a>\n` : ''}        </div>
      </div>`;

const block = [BEGIN, ...all.map(card), END].join('\n');

const container = /(<div id="publicationsList" class="publications-container">\n)([\s\S]*?)(\n    <\/div>)/;
if (!container.test(html)) {
  console.error('Could not find the #publicationsList container in index.html.');
  process.exit(1);
}
fs.writeFileSync(FILE, html.replace(container, (_m, open, _old, close) => open + block + close), 'utf8');

const withFullText = all.filter(p => p.fullText).length;
const withDoi = all.filter(p => p.doi && p.doiResolves !== false && !p.url.includes('ssrn.com')).length;
console.log(`Wrote ${all.length} publication cards into index.html as static HTML.`);
console.log(`  full-text links: ${withFullText}`);
console.log(`  DOI links:       ${withDoi}`);
console.log('Re-run this after any change to publicationsData.');
