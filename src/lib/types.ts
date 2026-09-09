export type LocalizedString = {
  id: string;
  key: string;
  value: string;
  locale: string;
  filePath: string;
  comment?: string;
  skip?: boolean;
  skipReason?: string;
};

export type ParseResult = {
  appName: string | null;
  locales: string[];
  /** Locales discovered before filtering. */
  allLocales: string[];
  stringCount: number;
  /** Count before locale filter / key dedupe / cap. */
  rawStringCount: number;
  strings: LocalizedString[];
  files: string[];
  /** Human-readable notes about extraction path / limits. */
  extractionNotes?: string[];
  /** True when translate list was truncated to maxStrings. */
  truncated?: boolean;
  truncatedFrom?: number;
};

export type ParseOptions = {
  /**
   * Which .lproj locales to keep.
   * - "base-en" (default): Base + en / en-* only
   * - "all": every locale
   * - string[]: explicit locale codes (case-insensitive)
   */
  localeFilter?: "base-en" | "all" | string[];
  /** Enable Mach-O binary scrape when no localization files. Default false. */
  enableBinaryExtraction?: boolean;
  /** Hard cap for binary phrases. Default 200. */
  binaryCap?: number;
  /**
   * Cap on returned strings after dedupe (translate list).
   * Default 1500. Pass 0 / Infinity for no cap.
   */
  maxStrings?: number;
};

export type TranslationRow = {
  id: string;
  key: string;
  original: string;
  translation: string;
  locale: string;
  filePath: string;
  skipped: boolean;
  skipReason?: string;
  /** True when the engine failed or returned a non-translation (kept original). */
  failed?: boolean;
  failReason?: string;
};

export type TranslateRequest = {
  strings: LocalizedString[];
  targetLang: string;
  sourceLang?: string;
};

export type TranslateProgress = {
  done: number;
  total: number;
  rows: TranslationRow[];
};
