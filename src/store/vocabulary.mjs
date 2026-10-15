// The Store vocabulary, read out of the phone itself.
//
// Why this file exists: until now the one value in a served Store page that no
// archived response could confirm was the template it names, and that value was a
// guess carried in config. The guess is no longer necessary. The phone's own
// binaries name every token the page is made of, and this module is that reading,
// with the byte offset each name came from, so it can be re-derived and checked
// (tools/read-vocabulary.mjs) rather than believed.
//
// The device, for the record:
//
//   Nokia RM-941, Windows Phone 8.10.14219.0, screen 480x800.
//   H:\Windows\System32\ZMarketplace.dll     565,248 bytes, dated 2014-12-23
//   H:\Windows\System32\ZuneAssets480x800.dll 167,936 bytes, dated 2014-12-23
//
// The two are read together on purpose, because the vocabulary only closes when
// they agree. ZMarketplace.dll is the client that *parses* a store page, and it
// says which structural paths and which page types exist. ZuneAssets480x800.dll
// is the UI it draws the page with, and it says which template types are
// actually *styleable* on this screen. A page type named by the first but not
// styled by the second would be a name the client could ask for and never
// render, which is the exact failure this module exists to prevent.
//
// What it settles, and what it does not:
//
//   settled - the page type the phone asks for (`DynamicHub`), because the
//             phone's own request carries it and the parser names it.
//   settled - the template types this phone can style, and that they are
//             NUMBERS (000, 003, 004, 010, 015, 017), not names. This is what
//             makes `DynamicHub` and `GamesHub` the wrong kind of token for a
//             TEMPLATETYPE, and it is a correction of a guess, not a refinement.
//   settled - the content link types, because both the parser and a real
//             archived page spell them the same way.
//   not settled - whether TEMPLATETYPE is spelled as an attribute of <Template>
//             or as a child element. The parser holds it as a property name, not
//             as markup, so nothing read from the phone can decide it. It is
//             marked below and kept in one place for that reason.
//
// Names that look like templates but are not, recorded so the mistake is not
// made twice: `GamesHub`, `MarketplaceHub` and `MusicVideoHub` appear in
// ZMarketplace.dll at @38716, @39528 and @39884 inside one run of persisted
// settings keys (`MarketplaceSettings`, `AutoUpdateOn`, `TileCount`, ...). They
// name settings, not page templates. `GamesHub` has exactly three other owners
// on the phone - GamesShared.dll, ZMF_Client.dll, ZMF_Service.dll, the Xbox
// Games hub - and the Store client has none of them. Serving a page that names
// `GamesHub` is serving the Store a template that belongs to another app.
//
// Read on 2026-10-15 from the device mounted at H:.

/** Where every name below was read from, so a re-derivation has something to compare against. */
export const PROVENANCE = {
  device: 'Nokia RM-941 (Windows Phone 8.10.14219.0, 480x800)',
  readOn: '2026-10-15',
  mount: 'H:',
  binaries: {
    parser: { path: 'H:\\Windows\\System32\\ZMarketplace.dll', bytes: 565248, dated: '2014-12-23' },
    ui: { path: 'H:\\Windows\\System32\\ZuneAssets480x800.dll', bytes: 167936, dated: '2014-12-23' },
  },
};

/**
 * The page types this client knows, from the string run in the parser that also
 * holds the two structural paths of a page feed. `sDynamicHub` carries the `s`
 * prefix every string constant in that binary carries; the token the phone puts
 * on the wire is `DynamicHub`, which its own request proves:
 *
 *   GET /v9/catalog/storePages?typeId=DynamicHub.Main&os=8.10.14219.0&cc=IT
 *
 * `Main` is the page variant within the type, and it is the variant the Store
 * opens with.
 */
export const PAGE_TYPES = [
  { id: 'DynamicHub', variant: 'Main', parserOffset: 29010, namedAs: 'sDynamicHub' },
  { id: 'DynamicChart', parserOffset: 29036 },
  { id: 'Collection', parserOffset: 29064 },
  { id: 'PodcastCollection', parserOffset: 129332 },
];

/**
 * The template types the phone can actually style, per page family, each with the
 * UI asset names that prove it. The trailing character on each asset name is the
 * low byte of an ordinal the resource table appends, not part of the name.
 *
 * Per family rather than one list, because the client reads the type out of a
 * page it is about to render *as that family*: the hub page's types and the chart
 * page's type are separate vocabularies even though they share the spelling.
 *
 * What the names say about the layouts, for whoever has to pick one:
 *   000 - the page itself (Store_TemplateType000_Spacing: only spacing)
 *   003 - a plain list (..003ListItem_Padding, ..003List_Padding)
 *   004 - margins only, so a container rather than a list
 *   015 - a list whose items carry a button (..015_Button_Size, ..015_Button_Text_Margins)
 *   017 - a rich list item (..017_RightPanel, ..017_Price, ..017_SuggestedReason,
 *         ..017_UniversalGraphic) - the "why you might like this" layout
 *   010 - the chart page's list item (Store_Chart_..010ListItem_Padding)
 */
export const TEMPLATE_TYPES = {
  DynamicHub: [
    { id: '000', uiOffset: 56381, namedAs: 'Store_TemplateType000_Spacing' },
    { id: '003', uiOffset: 56412, namedAs: 'Store_Hub_TemplateType003ListItem_FirstItem_Padding' },
    { id: '004', uiOffset: 56547, namedAs: 'Store_Hub_TemplateType004_Margins' },
    { id: '015', uiOffset: 57947, namedAs: 'Store_Hub_TemplateType015_Button_Size' },
    { id: '017', uiOffset: 57460, namedAs: 'Store_Hub_TemplateType017_ListItem_Margins' },
  ],
  DynamicChart: [
    { id: '010', uiOffset: 56582, namedAs: 'Store_Chart_TemplateType010ListItem_Padding' },
  ],
};

/**
 * The layout this page suite uses by default, and why it is this one rather than
 * the richest available: a generated page's sections are plain ordered lists of
 * applications, with no price panel, no suggestion reason and no per-item button,
 * so `003` is the layout that describes them. `017` would ask the phone to style
 * elements the page does not carry, and `015` likewise for its button.
 */
export const DEFAULT_TEMPLATE_TYPE = '003';

/**
 * The UI style the page's own chrome is drawn with. `Store_DynamicHubStyle_*`
 * three entries in the UI assets is what makes `DynamicHub` the right name for a
 * `<templateName>` as well as for a page type - the page type and its style agree
 * on this phone, which is why the archived page's `GamesHub` was the wrong name
 * for both: no `Store_GamesHubStyle` exists.
 */
export const PAGE_STYLE_PREFIX = 'Store_DynamicHubStyle';

/** The style names behind PAGE_STYLE_PREFIX, as evidence. */
export const PAGE_STYLE_OFFSETS = [57209, 57252, 57288];

/**
 * The types a section's contents carry, in <link><type>. Both the parser and a
 * real archived page spell them this way, which is the one part of the page
 * grammar with an independent second witness.
 */
export const CONTENT_LINK_TYPES = ['Application', 'ApplicationCollection'];

/**
 * The structural paths the parser walks in a page feed, in the order its reader
 * holds them. These are what a generated page has to contain for the client to
 * find anything at all.
 */
export const FEED_PATHS = [
  { path: '/Panes/Pane', parserOffset: 28776 },
  { path: '/Templates/Template', parserOffset: 28824 },
  { path: '/feed/entry', parserOffset: 29272 },
  { path: '/feed/link', parserOffset: 29368 },
  { path: '/feed/isActionable', parserOffset: 29392 },
  { path: '/feed/impressionId', parserOffset: 29432 },
];

/**
 * The grammar of the template block, as far as the phone can settle it.
 *
 * `container` and `element` are the path the parser walks, so `/Templates/Template`
 * gives the element names directly. `typeKey` is held by the parser as a property
 * name, not as markup, so how it attaches to the element is the one thing left
 * open - see `TYPE_KEY_FORM` below.
 */
export const TEMPLATE_GRAMMAR = {
  container: 'Templates',
  element: 'Template',
  typeKey: 'TEMPLATETYPE',
  typeKeyOffset: 29088,
};

/**
 * Open question, kept here rather than spread through the builders: whether the
 * template type travels as an attribute of <Template> or as a child element.
 *
 * Nothing read from the phone can decide it. The parser holds `TEMPLATETYPE`
 * beside its element paths, which says it is a property the parse config maps an
 * element to, and a parse config is not markup. Both forms are written into a
 * page by default so that either reading finds it, and `templateTypeForm` in
 * config narrows to one once the device says which it accepts.
 */
export const TYPE_KEY_FORMS = ['attribute', 'element', 'both'];

/**
 * Every path a store page is read through, not just the six that were checked.
 *
 * Why this list is separate from `FEED_PATHS`: that one holds the paths somebody
 * picked out by hand while writing the builder, and it is what `read-vocabulary`
 * checks offsets against. This one is the parser's own run, from the page root down
 * into the offer inside an application, read from the same binary in the same pass.
 * The difference matters, because a page can carry all six of those and still hand
 * the client nothing to build a model from - the entry, the editorial items and the
 * offer were not among the six - and a check can only fail for paths somebody
 * already thought about.
 *
 * `scope` is how the path reads, and it is not decoration:
 *
 *   root     - the path starts at the document element (`/Panes/Pane` is the
 *              root's child `Panes`, then its child `Pane`). Asserted that way.
 *   anywhere - the parser reads this relative to a node it selects first (an
 *              entry, a link): the name has to be carried, the position does not
 *              follow from the string table alone.
 *
 * `required: false` marks a path the parser names that a page does not have to
 * carry, and `why` says what the evidence is. Nothing here is marked optional on
 * a guess: each one is absent from the archived response of the real service too.
 *
 * Spelling is held exactly as the binary spells it, case included, because the
 * spelling is the one thing about a path this phone can settle - and where the
 * real service's own page disagrees with these strings (the field names below),
 * that is recorded as a disagreement rather than resolved by lowercasing both.
 */
export const PAGE_PARSE_PATHS = [
  { path: '/StorePage', parserOffset: 30024, scope: 'root', why: 'the root element name, named in the same run as the selectors below' },
  { path: '/Panes/Pane', parserOffset: 28776, scope: 'root', why: 'beside the parser\'s own "Found %d Store Panes"' },
  { path: '/Templates/Template', parserOffset: 28824, scope: 'root', why: 'beside "Found %d Store Templates"' },
  { path: '/feed', parserOffset: 30012, scope: 'root' },
  { path: '/feed/entry', parserOffset: 29272, scope: 'root' },
  { path: '/feed/link', parserOffset: 29368, scope: 'root' },
  { path: '/feed/entry/id', parserOffset: 30048, scope: 'root' },
  { path: '/feed/impressionId', parserOffset: 29432, scope: 'root' },
  { path: '/feed/entry/editorialItems/editorialItem', parserOffset: 30200, scope: 'root' },
  { path: '/feed/entry/applications/application', parserOffset: 30288, scope: 'root' },
  { path: '/feed/entry/applications/application/id', parserOffset: 30368, scope: 'root' },
  { path: '/feed/entry/applications/application/offers/offer', parserOffset: 30816, scope: 'root' },
  { path: '/feed/entry/applications/application/offers/offer/displayPrice', parserOffset: 30448, scope: 'root' },
  { path: '/feed/entry/applications/application/offers/offer/price', parserOffset: 30576, scope: 'root' },
  { path: '/feed/entry/applications/application/offers/offer/licenseRight', parserOffset: 30688, scope: 'root' },
  { path: '/entry', parserOffset: 29996, scope: 'anywhere', why: 'the entry element named as a selector, not as a position from the root' },
  { path: '/title', parserOffset: 33056, scope: 'anywhere' },
  { path: '/link/target', parserOffset: 33028, scope: 'anywhere' },
  { path: '/link/type', parserOffset: 33172, scope: 'anywhere' },
  { path: '/hasLiveTile', parserOffset: 33196, scope: 'anywhere' },
  { path: '/backgroundImage/id', parserOffset: 33072, scope: 'anywhere' },
  { path: '/offers/offer/licenseRight', parserOffset: 33224, scope: 'anywhere' },
  {
    path: '/feed/isActionable',
    parserOffset: 29392,
    scope: 'root',
    required: false,
    why: 'the archived response of the real service does not carry it either, so a page '
      + 'without it did reach a client. Whether *this* client wants a value is not settled '
      + 'by anything read so far, and inventing one would be a second change at once',
  },
  {
    path: '/feed/entry/offers/offer',
    parserOffset: 31468,
    scope: 'root',
    required: false,
    why: 'an offer carried directly by the entry: the client reads both spellings, and this '
      + 'one is used by neither our page nor the archived response - ours sits under the '
      + 'application, which is the shape the real page used',
  },
  { path: '/feed/entry/offers/offer/displayPrice', parserOffset: 31168, scope: 'root', required: false, why: 'the same alternative spelling as the entry-level offer above' },
  { path: '/feed/entry/offers/offer/price', parserOffset: 31324, scope: 'root', required: false, why: 'the same alternative spelling as the entry-level offer above' },
  { path: '/feed/entry/offers/offer/licenseRight', parserOffset: 31392, scope: 'root', required: false, why: 'the same alternative spelling as the entry-level offer above' },
];

/**
 * What the rest of that string run holds, so the next reader does not have to
 * re-derive it to find out why it is not in the list above.
 *
 * Grouped rather than listed one by one, because the reason is a property of the
 * group: the paths at @29496-@31248 sit beside names of *other* responses, and the
 * field names at @32464-@33056 are spelled in a case the real page does not use.
 * Neither group is a claim about the page, and neither is asserted anywhere.
 */
export const PATHS_NEAR_THE_PAGE_GRAMMAR = [
  {
    why: 'the page-grammar run is interrupted by other response types, and these paths name '
      + 'them: a credit-card list, payment instrument types and instruments, the IAP detail '
      + 'response, the application detail response, and the chart/collection object model. '
      + 'They document those grammars, not this page - the archived hub page carries no '
      + 'StoreObject either.',
    paths: [
      { path: '/GetCreditCardResponse/CreditCards/ZuneCreditCard', parserOffset: 29496 },
      { path: '/BatchGetIapDetailsResponse/Resources/Resource/feed', parserOffset: 29600 },
      { path: '/PaymentInstrumentTypesResponse/PaymentInstrumentTypes/PaymentInstrumentType', parserOffset: 29704 },
      { path: '/PaymentInstrumentsResponse/PaymentInstruments/PaymentInstrument', parserOffset: 29864 },
      { path: '/BatchGetApplicationDetailsResponse/Resources/Resource/feed', parserOffset: 30080 },
      { path: '/feed/StoreObjects/StoreObject', parserOffset: 30936 },
      { path: '/feed/StoreObjects/StoreObject/Id', parserOffset: 31000 },
      { path: '/feed/StoreObjects/StoreObject/DisplayPrice', parserOffset: 31080 },
      { path: '/feed/StoreObjects/StoreObject/Price', parserOffset: 31248 },
    ],
  },
  {
    why: 'the field names of an entry\'s item as another response spells them: Pascal-case, '
      + 'beside `/Action/*`, `/Reason`, `/OverrideFilter` and the tile names. The archived '
      + 'page spells the same fields in camelCase (`averageUserRating`, `backgroundImage`) '
      + 'and carries no `/Action`, so which of the two a storePages page uses is settled by '
      + 'the page that worked and not by these strings - which is exactly why they are '
      + 'recorded here and not asserted. `/averageUserRating` in camelCase is carried by both.',
    paths: [
      { path: '/ShortDescription', parserOffset: 32464 },
      { path: '/AverageUserRating', parserOffset: 32500 },
      { path: '/UserRatingCount', parserOffset: 32540 },
      { path: '/HasLiveTile', parserOffset: 32576 },
      { path: '/HasTrial', parserOffset: 32604 },
      { path: '/PublisherName', parserOffset: 32624 },
      { path: '/ImageId', parserOffset: 32656 },
      { path: '/BackgroundImageId', parserOffset: 32676 },
      { path: '/Action/Type', parserOffset: 32716 },
      { path: '/Action/Subtype', parserOffset: 32744 },
      { path: '/Action/TargetId', parserOffset: 32776 },
      { path: '/Action/Context', parserOffset: 32812 },
      { path: '/Reason', parserOffset: 32844 },
      { path: '/OverrideFilter', parserOffset: 32860 },
      { path: '/ImageType', parserOffset: 32892 },
      { path: '/LiveTileText', parserOffset: 32916 },
      { path: '/LiveTileImage', parserOffset: 32944 },
      { path: '/content', parserOffset: 33112 },
      { path: '/text', parserOffset: 33132 },
      { path: '/link/context', parserOffset: 33144 },
    ],
  },
];

/** True when `id` is a page type this client asks for. */
export function isKnownPageType(id) {
  const wanted = String(id || '').trim();
  return PAGE_TYPES.some((page) => page.id.toLowerCase() === wanted.toLowerCase());
}

/** The template types a page family can be styled with. Empty for an unknown family. */
export function templateTypesForPageType(id) {
  const wanted = String(id || '').trim().toLowerCase();
  const family = Object.keys(TEMPLATE_TYPES).find((key) => key.toLowerCase() === wanted);
  return family ? TEMPLATE_TYPES[family].map((entry) => entry.id) : [];
}

/** True when `type` is a template type the given page family can be styled with. */
export function isKnownTemplateType(id, type) {
  return templateTypesForPageType(id).includes(String(type ?? '').trim());
}

/**
 * Names that read like templates but are not, with the reason. Kept as data so a
 * page builder can refuse them by name instead of a person having to remember.
 */
export const NOT_A_TEMPLATE = [
  {
    name: 'GamesHub',
    parserOffset: 39884,
    reason: 'a persisted settings key, and the name of the Xbox Games hub page. '
      + 'Owned by GamesShared.dll, ZMF_Client.dll and ZMF_Service.dll - not by the Store client.',
  },
  { name: 'MarketplaceHub', parserOffset: 38716, reason: 'a persisted settings key.' },
  { name: 'MusicVideoHub', parserOffset: 39528, reason: 'a persisted settings key.' },
];

/** The reason `name` cannot be a template type, or null when it is not a known decoy. */
export function whyNotATemplate(name) {
  const wanted = String(name || '').trim().toLowerCase();
  const found = NOT_A_TEMPLATE.find((entry) => entry.name.toLowerCase() === wanted);
  return found ? `${found.name}: ${found.reason}` : null;
}

/**
 * Answer the question a page builder actually has, in one call: is this template
 * type one the client can render for this page type?
 *
 * @returns {{ok: boolean, reason?: string, allowed: string[]}}
 */
export function checkTemplateType(pageType, templateType) {
  const allowed = templateTypesForPageType(pageType);
  const wanted = String(templateType ?? '').trim();
  if (!isKnownPageType(pageType)) {
    return {
      ok: false,
      reason: `page type "${pageType}" is not one this client asks for (known: ${PAGE_TYPES.map((p) => p.id).join(', ')})`,
      allowed,
    };
  }
  if (!allowed.length) {
    // A page type the parser names but the UI assets do not style: no template
    // type can be checked against it, so nothing is claimed.
    return { ok: false, reason: `no template types are known for page type "${pageType}"`, allowed };
  }
  const decoy = whyNotATemplate(templateType);
  if (decoy) return { ok: false, reason: decoy, allowed };
  if (!allowed.includes(wanted)) {
    return { ok: false, reason: `"${wanted}" is not a template type this phone styles (known: ${allowed.join(', ')})`, allowed };
  }
  return { ok: true, allowed };
}

/** The whole reading, for a report or a drift check. */
export function vocabulary() {
  return {
    provenance: PROVENANCE,
    pageTypes: PAGE_TYPES,
    templateTypes: TEMPLATE_TYPES,
    defaultTemplateType: DEFAULT_TEMPLATE_TYPE,
    contentLinkTypes: CONTENT_LINK_TYPES,
    feedPaths: FEED_PATHS,
    pageParsePaths: PAGE_PARSE_PATHS,
    pathsNearThePageGrammar: PATHS_NEAR_THE_PAGE_GRAMMAR,
    templateGrammar: TEMPLATE_GRAMMAR,
    typeKeyForms: TYPE_KEY_FORMS,
    notATemplate: NOT_A_TEMPLATE,
  };
}
