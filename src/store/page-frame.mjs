// The page's frame, read the way the client's parser reads it.
//
// WHY THIS IS A MODULE AND NOT A SCRIPT. Two things want the same answer: the
// `page-diff` tool, which reports it for a human, and the self-test, which asserts
// the invariant behind it - that the page this lab serves carries every path the
// client's own parser names (PAGE_PARSE_PATHS in vocabulary.mjs). A check that
// re-implemented the walk would drift from the report, so both read these.
//
// WHAT IS AND IS NOT DECIDED HERE. A path is reported in three states:
//
//   exact        the element is spelled the way the parser spells it
//   prefix-only  the element exists, its local name matches, but it travels under a
//                namespace prefix the parser's string does not carry (`a:feed` for
//                `/feed`). Whether the client's XML engine ignores prefixes is the
//                device's answer and is not guessed here.
//   missing      no element of that name at that position, by either spelling.
//
// `missing` is the only one that is a defect on the evidence: the client asks for a
// construct the document does not contain at all.

/** Split a tag body into a node: qualified name, prefix, local name, attributes. */
function makeNode(qname, attrText, parent) {
  const colon = qname.indexOf(':');
  const node = {
    qname,
    prefix: colon === -1 ? '' : qname.slice(0, colon),
    local: colon === -1 ? qname : qname.slice(colon + 1),
    attrs: {},
    children: [],
    parent,
  };
  for (const attr of String(attrText || '').matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    node.attrs[attr[1]] = attr[3] !== undefined ? attr[3] : attr[4];
  }
  return node;
}

const TOKEN = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;

/**
 * A walker, not a parser: enough XML to name elements, nest them and keep their
 * attributes. These documents are built by this lab and read here, so a general XML
 * library would be a dependency bought for one screen of output.
 */
export function parseXml(xml) {
  const root = { qname: '#document', local: '#document', prefix: '', attrs: {}, children: [], parent: null };
  const stack = [root];
  for (const match of String(xml).matchAll(TOKEN)) {
    const [, closing, qname, attrText, selfClosing] = match;
    if (!qname) continue; // declaration, comment, CDATA
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = makeNode(qname, attrText, stack[stack.length - 1]);
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function walk(node, visit, trail = []) {
  for (const child of node.children) {
    const localTrail = [...trail, child.local];
    visit(child, localTrail);
    walk(child, visit, localTrail);
  }
}

function qualifiedTrail(node) {
  const trail = [];
  let cursor = node;
  while (cursor && cursor.qname !== '#document') {
    trail.unshift(cursor.qname);
    cursor = cursor.parent;
  }
  return trail;
}

/**
 * Every element of a document under both of its names: with prefixes as written and
 * by local name alone. That pair is what makes the prefix-only state reportable.
 */
export function collect(xml) {
  const root = parseXml(xml);
  const rootElement = root.children[0] || null;
  const elements = [];
  if (rootElement) {
    walk({ children: [rootElement], local: '#document' }, (node, localTrail) => {
      elements.push({ localTrail, qTrail: qualifiedTrail(node) });
    });
  }
  return { root, rootElement, elements };
}

/**
 * How many elements satisfy one parser path, by each spelling.
 *
 * @param {{elements: {localTrail: string[], qTrail: string[]}[]}} doc from collect()
 * @param {{path: string, scope?: 'root'|'anywhere'}} entry one PAGE_PARSE_PATHS item
 * @returns {{exactHits: number, localHits: number}}
 */
export function coverage(doc, { path: parserPath, scope }) {
  const key = parserPath.split('/').filter(Boolean).join('/');
  let exactHits = 0;
  let localHits = 0;
  for (const element of doc.elements) {
    const local = element.localTrail.join('/');
    const qualified = element.qTrail.join('/');
    if (scope === 'root' || !scope) {
      // A root-scoped path may name the document element itself (`/feed`, when the
      // document is a plain feed) or a child of it (`/feed/entry` inside a page whose
      // root is `StorePage`). Both readings are tried, because the parser describes
      // both documents.
      const localMatches = local === key || element.localTrail.slice(1).join('/') === key;
      const exactMatches = qualified === key || element.qTrail.slice(1).join('/') === key;
      if (localMatches) localHits += 1;
      if (exactMatches) exactHits += 1;
      continue;
    }
    if (!local.endsWith(key)) continue;
    localHits += 1;
    if (qualified.slice(-key.length) === key) exactHits += 1;
  }
  return { exactHits, localHits };
}

/** 'exact' | 'prefix-only' | 'missing' for one coverage() result. */
export function verdictOf({ exactHits, localHits }) {
  if (exactHits > 0) return 'exact';
  if (localHits > 0) return 'prefix-only';
  return 'missing';
}

/** The first element with this local name, depth first - a pane, for its own fields. */
export function findFirst(doc, localName) {
  let found = null;
  const search = (node) => {
    if (found) return;
    for (const child of node.children) {
      if (child.local === localName) {
        found = child;
        return;
      }
      search(child);
      if (found) return;
    }
  };
  if (doc.rootElement) search(doc.rootElement);
  return found;
}

/**
 * Every path below `node`, by local name, without the node itself: `DataSource/Type`,
 * `BackgroundImage/id`, and so on. This is the shape the pane's property map is read
 * in, one level deeper than the page's own paths.
 */
export function pathsUnder(node) {
  const paths = new Set();
  if (!node) return paths;
  const visit = (current, trail) => {
    for (const child of current.children) {
      const next = [...trail, child.local];
      paths.add(next.join('/'));
      visit(child, next);
    }
  };
  visit(node, []);
  return paths;
}

/** The document element's name and declared default namespace, for a report line. */
export function describe(doc) {
  // Reported together with the children, because the children are what a reader
  // compares first when two frames disagree.
  return {
    rootQname: doc.rootElement?.qname || '(none)',
    rootNs: doc.rootElement?.attrs?.xmlns || '(none)',
    childNames: (doc.rootElement?.children || []).map((child) => child.qname),
  };
}
