export type GoldItemCategory =
  | 'Chains'
  | 'Earrings'
  | 'Rings'
  | 'Pendants & Necklaces'
  | 'Bangles & Bracelets'
  | 'Coins & Other';

export interface GoldItemOption {
  code: string;
  shortLabel: string;
  name: string;
  category: GoldItemCategory;
}

export interface GoldItemGroup {
  category: GoldItemCategory;
  items: GoldItemOption[];
}

export const GOLD_ITEM_CATEGORY_ORDER: GoldItemCategory[] = [
  'Chains',
  'Earrings',
  'Rings',
  'Pendants & Necklaces',
  'Bangles & Bracelets',
  'Coins & Other',
];

/**
 * Canonical Gold & Vault Item Catalog shared across Pawning, Stock/EOD,
 * Approvals, Reporting, and Backend inference.
 */
export const GOLD_ITEM_CATALOG: GoldItemOption[] = [
  // Chains
  { code: 'CH', shortLabel: 'Chain', name: 'Chain (CH)', category: 'Chains' },
  { code: 'VCH', shortLabel: 'V Chain', name: 'V Chain (VCH)', category: 'Chains' },
  { code: 'DCH', shortLabel: 'Diamond Chain', name: 'Diamond Chain (DCH)', category: 'Chains' },
  { code: 'SPCH', shortLabel: 'Singapore Chain', name: 'Singapore Chain (SPCH)', category: 'Chains' },

  // Earrings
  { code: 'EAR', shortLabel: 'Earrings', name: 'Earrings (EAR)', category: 'Earrings' },
  { code: 'WJ', shortLabel: 'Wire Gypsy', name: 'Wire Gypsy (WJ)', category: 'Earrings' },
  { code: 'BJ', shortLabel: 'Ball Gypsy', name: 'Ball Gypsy (BJ)', category: 'Earrings' },
  { code: 'SPJ', shortLabel: 'Spring Gypsy', name: 'Spring Gypsy (SPJ)', category: 'Earrings' },
  { code: 'TS', shortLabel: 'Tassel', name: 'Tassel (TS)', category: 'Earrings' },

  // Rings
  { code: 'PR', shortLabel: 'Ring', name: 'Ring (PR)', category: 'Rings' },
  { code: 'BPR', shortLabel: 'Baby Ring', name: 'Baby Ring (BPR)', category: 'Rings' },
  { code: 'CR', shortLabel: 'Carved Ring', name: 'Carved Ring (CR)', category: 'Rings' },

  // Pendants & Necklaces
  { code: 'PP', shortLabel: 'Pendant', name: 'Pendant (PP)', category: 'Pendants & Necklaces' },
  { code: 'NL', shortLabel: 'Necklace', name: 'Necklace (NL)', category: 'Pendants & Necklaces' },

  // Bangles, Bracelets & Anklets
  { code: 'PB', shortLabel: 'Bangle', name: 'Bangle (PB)', category: 'Bangles & Bracelets' },
  { code: 'BRC', shortLabel: 'Bracelet', name: 'Bracelet (BRC)', category: 'Bangles & Bracelets' },
  { code: 'ANK', shortLabel: 'Anklets', name: 'Anklets (ANK)', category: 'Bangles & Bracelets' },

  // Bullion, Coins & Other
  { code: 'COIN', shortLabel: 'Gold Coin / Bar', name: 'Gold Coin / Bar (COIN)', category: 'Coins & Other' },
  { code: 'NA', shortLabel: 'Not Applicable', name: 'Not Applicable (NA)', category: 'Coins & Other' },
];

export const PAWN_ITEM_OPTIONS: GoldItemOption[] = [
  ...GOLD_ITEM_CATALOG,
  { code: 'OTHER', shortLabel: 'Other', name: 'Other (Custom)', category: 'Coins & Other' },
];

function groupOptionsByCategory(options: GoldItemOption[]): GoldItemGroup[] {
  return GOLD_ITEM_CATEGORY_ORDER.map((category) => ({
    category,
    items: options.filter((opt) => opt.category === category),
  })).filter((g) => g.items.length > 0);
}

export const GOLD_ITEM_GROUPS: GoldItemGroup[] = groupOptionsByCategory(GOLD_ITEM_CATALOG);
export const PAWN_ITEM_GROUPS: GoldItemGroup[] = groupOptionsByCategory(PAWN_ITEM_OPTIONS);

export const VALID_GOLD_ITEM_CODES = new Set<string>(GOLD_ITEM_CATALOG.map((it) => it.code));
export const ALL_KNOWN_GOLD_CODES = new Set<string>(PAWN_ITEM_OPTIONS.map((it) => it.code));

export const LEGACY_GOLD_CODE_ALIASES: Record<string, string> = {
  BLCT: 'PB',
  BKT: 'PB',
  BGL: 'PB',
};

const PAREN_CODE_REGEX = /\((EAR|PR|CH|PP|NL|BRC|PB|CR|WJ|BJ|ANK|DCH|SPCH|VCH|BKT|COIN|NA|TS|SPJ|BPR|BLCT|BGL|OTHER)\)/i;

const CATALOG_BY_CODE = new Map<string, GoldItemOption>(
  PAWN_ITEM_OPTIONS.map((opt) => [opt.code, opt])
);

function mapLegacyCode(code: string): string {
  const upper = code.toUpperCase();
  return LEGACY_GOLD_CODE_ALIASES[upper] || upper;
}

/**
 * Infer a single canonical stock/pawn code from messy or descriptive text
 * (without 18K prefix handling). Specific multi-word items run before generic ones.
 */
export function inferGoldItemCodeFromText(rawText: string): string | null {
  if (!rawText) return null;
  const upper = rawText.toUpperCase();

  // Check explicit parenthesized code first e.g. "V Chain (VCH)"
  const paren = upper.match(PAREN_CODE_REGEX);
  if (paren) {
    return mapLegacyCode(paren[1]);
  }

  // Exact word tokens for subtype abbreviations
  if (/\bVCH\b|\bV[\s-]*CHAIN\b/.test(upper)) return 'VCH';
  if (/\bDCH\b|\bDIAMOND\s+CHAIN\b/.test(upper)) return 'DCH';
  if (/\bSPCH\b|\bSINGAPORE\s+CHAIN\b/.test(upper)) return 'SPCH';
  if (/\bWJ\b|\bWIRE\s+GY[SP]{2}Y\b/.test(upper)) return 'WJ';
  if (/\bBJ\b|\bBALL\s+GY[SP]{2}Y\b/.test(upper)) return 'BJ';
  if (/\bSPJ\b|\bSPRING\s+GY[SP]{2}Y\b/.test(upper)) return 'SPJ';
  if (/\bTS\b|\bTASSEL\b/.test(upper)) return 'TS';
  if (/\bBPR\b|\bBABY\s+RING\b/.test(upper)) return 'BPR';
  if (/\bCR\b|\bCARVED\s+RING\b/.test(upper)) return 'CR';
  if (/\bANK\b|\bANKLET/.test(upper)) return 'ANK';
  if (/\bBLCT\b|\bBKT\b|\bBGL\b|\bPB\b|\bBANGLE|වළලු|වලලු/.test(upper)) return 'PB';
  if (/\bCOIN\b|GOLD\s+COIN/.test(upper)) return 'COIN';

  // Generic categories
  if (/\bCH\b|CHAIN|මාලය/.test(upper)) return 'CH';
  if (/\bPR\b|RING|මුද්ද|මුදුව/.test(upper)) return 'PR';
  if (/\bEAR\b|EARRING|STUD|කරාබු/.test(upper)) return 'EAR';
  if (/\bPP\b|PENDANT|පෙන්ඩන්ට්/.test(upper)) return 'PP';
  if (/\bBRC\b|BRACELET|බ්‍රේස්ලට්/.test(upper)) return 'BRC';
  if (/\bNL\b|NECKLACE/.test(upper)) return 'NL';
  if (/\bNA\b/.test(upper)) return 'NA';
  if (/\bOTHER\b/.test(upper)) return 'OTHER';

  return null;
}

/**
 * Normalize any messy or legacy item token into canonical abbreviation
 * (e.g. EAR, VCH, WJ, 18K-PP, PB).
 */
export function normalizeGoldItemToken(rawToken: string): string {
  if (!rawToken) return '';
  let clean = rawToken.trim();
  if (!clean) return '';

  let is18K = false;
  if (/^18[KC][ -]/i.test(clean)) {
    is18K = true;
    clean = clean.replace(/^18[KC][ -]/i, '').trim();
  }

  // 1. Check explicit parenthesized code e.g. "(VCH)", "(WJ)", "(BGL)", "(BKT)"
  const paren = clean.match(PAREN_CODE_REGEX);
  if (paren) {
    const code = mapLegacyCode(paren[1]);
    return is18K ? `18K-${code}` : code;
  }

  // 2. Strip purity/weight annotations like (22K), (4500mg)
  clean = clean.replace(/\s*\(\d+(?:\.\d+)?(?:K|mg|g)\)/gi, '').trim();

  // 3. Strip trailing sub-item numbering like -1, -2 or _1, _2
  clean = clean.replace(/[-_]\d+$/g, '').trim();

  // 4. Exact match of known code or code + count (e.g. EAR3, WJ2, BLCT, BKT)
  const codeMatch = clean.match(/^([A-Za-z]+)(\d*)$/);
  if (codeMatch) {
    const mapped = mapLegacyCode(codeMatch[1]);
    if (ALL_KNOWN_GOLD_CODES.has(mapped)) {
      const count = codeMatch[2] || '';
      return (is18K ? `18K-${mapped}` : mapped) + count;
    }
  }

  // 5. Ordered keyword match (specific before generic)
  const inferred = inferGoldItemCodeFromText(clean);
  if (inferred) {
    return is18K ? `18K-${inferred}` : inferred;
  }

  return is18K ? `18K-${clean.toUpperCase()}` : clean.toUpperCase();
}

/**
 * Human-readable item display string with code suffix (e.g. "V Chain (VCH)", "18K Wire Gypsy (WJ) (2)").
 */
export function getGoldItemDisplayName(codeWithCount: string): string {
  if (!codeWithCount) return '';
  if (codeWithCount.includes(',')) {
    return codeWithCount
      .split(',')
      .map((t) => getGoldItemDisplayName(t.trim()))
      .filter(Boolean)
      .join(' + ');
  }

  const trimmedUpper = codeWithCount.trim().toUpperCase();
  if (trimmedUpper === 'BLCT' || trimmedUpper === 'BKT' || trimmedUpper === 'BGL') {
    return 'Bangle (PB)';
  }

  let is18K = false;
  let cleanCode = codeWithCount.trim();
  if (/^18[KC][ -]/i.test(cleanCode)) {
    is18K = true;
    cleanCode = cleanCode.substring(4).trim();
  }

  const match = cleanCode.match(/^([A-Za-z]+)(\d*)$/);
  if (match) {
    const mappedCode = mapLegacyCode(match[1]);
    const count = match[2] ? parseInt(match[2], 10) : 1;
    const found = CATALOG_BY_CODE.get(mappedCode);
    const baseName = found ? found.name : mappedCode;
    const prefixStr = is18K ? '18K ' : '';
    const fullName = `${prefixStr}${baseName}`;
    return count > 1 ? `${fullName} (${count})` : fullName;
  }

  const mappedWhole = mapLegacyCode(cleanCode);
  const found = CATALOG_BY_CODE.get(mappedWhole);
  const baseName = found ? found.name : cleanCode.toUpperCase();
  const prefixStr = is18K ? '18K ' : '';
  return `${prefixStr}${baseName}`;
}

/**
 * Resolve stored pawn item_type + description into a canonical PAWN_ITEM_OPTIONS code
 * for edit modal prefill and fallback normalization.
 */
export function resolvePawnItemCode(rawItemType?: string | null, rawDesc?: string | null): string {
  const typeClean = String(rawItemType || '').trim();
  const descClean = String(rawDesc || '').trim();

  if (typeClean.toUpperCase() === 'BKT' || typeClean.toUpperCase() === 'BLCT' || typeClean.toUpperCase() === 'BGL') {
    return 'PB';
  }

  const fromType = normalizeGoldItemToken(typeClean).replace(/^18K-/i, '').replace(/\d+$/, '');
  if (fromType && ALL_KNOWN_GOLD_CODES.has(fromType)) {
    return fromType;
  }

  const inferred = inferGoldItemCodeFromText(descClean);
  if (inferred && ALL_KNOWN_GOLD_CODES.has(inferred)) {
    return inferred;
  }

  return typeClean ? 'OTHER' : 'CH';
}

const FAMILY_FILTER_CODES: Record<string, string[]> = {
  ring: ['PR', 'BPR', 'CR'],
  chain: ['CH', 'VCH', 'DCH', 'SPCH'],
  earrings: ['EAR', 'WJ', 'BJ', 'SPJ', 'TS'],
  necklace: ['NL'],
  bangle: ['PB', 'BGL', 'BKT', 'BLCT'],
  pendant: ['PP'],
  bracelet: ['BRC'],
};

/**
 * Match a pawn ticket (including its child pawn_items) against a category or specific code filter.
 */
export function matchesPawnCategoryFilter(pawn: any, filterCategory: string): boolean {
  if (!filterCategory || filterCategory === 'ALL') return true;
  const fLower = filterCategory.toLowerCase().trim();
  const fUpper = filterCategory.toUpperCase().trim();
  const desc = String(pawn?.description || '').toLowerCase();

  const itemCodes = Array.isArray(pawn?.items)
    ? pawn.items.map((it: any) => resolvePawnItemCode(it.item_type, it.description || pawn?.description))
    : [];
  const rawItemTypesUpper = Array.isArray(pawn?.items)
    ? pawn.items.map((it: any) => String(it.item_type || '').toUpperCase().trim())
    : [];

  // Exact catalog code match (e.g. VCH, DCH, WJ, BJ, SPJ, PB, CR, etc.)
  if (ALL_KNOWN_GOLD_CODES.has(fUpper)) {
    if (itemCodes.includes(fUpper) || rawItemTypesUpper.includes(fUpper)) return true;
    const descToken = inferGoldItemCodeFromText(desc);
    if (descToken === fUpper) return true;
    if (desc.includes(`(${fLower})`) || desc.includes(`${fLower}_`) || desc.includes(`${fLower}-`)) return true;
    const opt = CATALOG_BY_CODE.get(fUpper);
    if (opt && desc.includes(opt.shortLabel.toLowerCase())) return true;
    return false;
  }

  // Broad category family filter
  const familyCodes = FAMILY_FILTER_CODES[fLower];
  if (familyCodes) {
    if (itemCodes.some((c: string) => familyCodes.includes(c))) return true;
    if (fLower === 'ring') {
      return /\bring\b|\(pr\)|pr_|pr-|\(bpr\)|\(cr\)/.test(desc);
    }
    if (fLower === 'chain') {
      return desc.includes('chain') || /\((?:ch|vch|dch|spch)\)/.test(desc);
    }
    if (fLower === 'earrings') {
      return desc.includes('ear') || desc.includes('gypsy') || desc.includes('gyspy') || desc.includes('tassel') || /\((?:ear|wj|bj|spj|ts)\)/.test(desc);
    }
    if (fLower === 'pendant') {
      return desc.includes('pendant') || /\(pp\)|pp_|pp-/.test(desc);
    }
    if (fLower === 'bracelet') {
      return desc.includes('bracelet') || /\(brc\)|brc_|brc-/.test(desc);
    }
    if (fLower === 'bangle') {
      return desc.includes('bangle') || /\((?:pb|bgl|bkt)\)|bgl_/.test(desc);
    }
    if (fLower === 'necklace') {
      return desc.includes('necklace') || /\(nl\)|nl_/.test(desc);
    }
  }

  return desc.includes(fLower);
}

/**
 * Dashboard portfolio chart category classifier supporting all gold sub-types.
 */
export function classifyDashboardLoanCategory(
  pawn: any
): 'Rings' | 'Chains & Necklaces' | 'Pendants' | 'Earrings & Studs' | 'Bangles & Bracelets' | 'Other Articles' {
  const itemCodes = Array.isArray(pawn?.items)
    ? pawn.items.map((it: any) => resolvePawnItemCode(it.item_type, it.description || pawn?.description))
    : [];
  const primary = itemCodes[0] || inferGoldItemCodeFromText(String(pawn?.description || ''));

  if (primary === 'PR' || primary === 'BPR' || primary === 'CR') return 'Rings';
  if (primary === 'CH' || primary === 'VCH' || primary === 'DCH' || primary === 'SPCH' || primary === 'NL') return 'Chains & Necklaces';
  if (primary === 'PP') return 'Pendants';
  if (primary === 'EAR' || primary === 'WJ' || primary === 'BJ' || primary === 'SPJ' || primary === 'TS') return 'Earrings & Studs';
  if (primary === 'PB' || primary === 'BRC' || primary === 'ANK' || primary === 'BGL' || primary === 'BKT') return 'Bangles & Bracelets';
  return 'Other Articles';
}
