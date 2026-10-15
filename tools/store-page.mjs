#!/usr/bin/env node
// Render the Store page the device would be served, and show what is on it.
//
//   node tools/store-page.mjs
//   node tools/store-page.mjs --out /tmp/page.xml
//   node tools/store-page.mjs --catalog src/store/fixtures/sample-catalog.json
//
// Why this exists: the page has to be *looked at*, and for most of this project's
// life the only thing that could look at it was a Lumia whose answer was a single
// assert code. A page that is served, well formed and wrong is indistinguishable
// from a page that is right until somebody reads it, so this reads it.
//
// It builds the page with the same builder the lab uses, from the same config and
// the same catalog file - but in-process and offline, so it works with the lab
// stopped and cannot be confused by a stale in-memory catalog. The query it
// answers is the phone's own, copied from the capture, because the page echoes it
// back in its self link.
//
// What it is not: a rendering of the Store. It shows what the page *carries*, in
// the order the device reads it. Whether the device turns that into tiles is a
// question only the device answers.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.mjs';
import { buildStorePageFeed, normalizePageFormat } from '../src/store/catalog-feed.mjs';
import { pageSections } from '../src/store/protocol.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const configPath = path.resolve(flag('config', 'config.json'));
const config = loadConfig(configPath);
const protocol = config.livestore?.protocol || {};
const catalogFile = flag('catalog', protocol.catalogFile || 'src/store/fixtures/sample-catalog.json');
const outFile = flag('out', path.join(ROOT, '.selftest', 'store-page.xml'));

/** The query the capture shows the phone sending when it opens the Store. */
const PHONE_QUERY = '/v9/catalog/storePages?typeId=DynamicHub.Main&os=8.10.14219.0&cc=IT&lang=it-IT'
  + '&hw=402699266&dm=RM-941_eu_france_308&oemId=NOKIA&moId=&cf=&optedOut=true';

let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(path.resolve(ROOT, catalogFile), 'utf8'));
} catch (err) {
  console.error(`cannot read the catalog at ${catalogFile}: ${err.message}`);
  process.exit(2);
}

const apps = catalog.apps || [];
const sections = pageSections(catalog, protocol.pageSize || 25);
const typeId = new URL(PHONE_QUERY, 'http://x').searchParams.get('typeId') || 'DynamicHub.Main';
const cc = new URL(PHONE_QUERY, 'http://x').searchParams.get('cc') || 'US';

const xml = buildStorePageFeed({
  sections,
  selfHref: PHONE_QUERY,
  title: `${typeId}-${cc}-WindowsPhone81`,
  id: `${typeId}-${cc}-WindowsPhone81-ALL-ALL`,
  templateName: protocol.hubTemplate || 'DynamicHub',
  templateType: protocol.templateType || '003',
  typeKeyForm: protocol.templateTypeForm || 'both',
  pageFormat: normalizePageFormat(protocol.pageFormat),
});

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, xml, 'utf8');

// What the document is rooted at, read back from what was written rather than
// from what the builder was asked for - the question is what is in the file.
const root = (xml.match(/^<\?xml[^?]*\?>\s*<([A-Za-z:]+)/) || [])[1] || '(none)';
const templateType = (xml.match(/<(?:Template [^>]*TEMPLATETYPE="|[A-Z]*TEMPLATETYPE>)([^"<]*)/) || [])[1] || '(none)';

const money = (app) => {
  const price = app.price === undefined || app.price === null ? 0 : Number(app.price);
  if (app.displayPrice) return String(app.displayPrice);
  return price === 0 ? 'Gratis' : String(price);
};

console.log(`catalog : ${catalogFile} - ${apps.length} app(s), ${(catalog.categories || []).length} categor(y/ies)`);
console.log(`page    : <${root}> root, template ${templateType}, pageFormat ${normalizePageFormat(protocol.pageFormat)}, ${xml.length} bytes`);
// Where the items are, which is the whole difference between the two page-rooted
// formats: inside the panes, or only in the feed underneath them.
const insidePanes = (xml.split('</Panes>')[0] || '').split('<editorialItem>').length - 1;
const totalItems = xml.split('<editorialItem>').length - 1;
console.log(`items   : ${totalItems} in the document, ${insidePanes} of them inside the panes`
  + (insidePanes ? '' : ' (the panes carry a reference, not the items)'));
console.log(`file    : ${path.relative(ROOT, outFile) || outFile}`);
console.log(`query   : ${PHONE_QUERY}`);
console.log('');

if (!sections.length) {
  console.log('The page carries no sections: the catalog declares no category with an app in it.');
  process.exit(0);
}

const widest = Math.max(...sections.map((section) => section.title.length));
console.log(`${sections.length} section(s):`);
for (const [index, section] of sections.entries()) {
  console.log('');
  console.log(`  ${String(index + 1).padStart(2)}. ${section.title.padEnd(widest)}  ${section.items.length} app`);
  for (const app of section.items) {
    const rating = app.rating === undefined || app.rating === null ? '-' : `${app.rating}/10`;
    const count = app.ratingCount === undefined || app.ratingCount === null ? '' : ` (${app.ratingCount})`;
    console.log(`        ${money(app).padStart(9)}  ${rating}${count}  ${app.name}`);
  }
}

const declared = (catalog.categories || []).map((name) => String(name).trim().toLowerCase());
const stray = apps.filter((app) => !declared.includes(String(app.category || '').trim().toLowerCase()));
const empty = declared.filter((name) => !sections.some((section) => section.title.toLowerCase() === name));
if (stray.length || empty.length) {
  console.log('');
  if (stray.length) console.log(`  ! ${stray.length} app(s) in no declared category: ${stray.map((a) => a.name).join(', ')}`);
  if (empty.length) console.log(`  ! declared but empty: ${empty.join(', ')}`);
}

console.log('');
console.log('Whether the device draws this is not answerable here: open the Store with the lab');
console.log('running and read what it asks for next. What this shows is what it would be given.');
