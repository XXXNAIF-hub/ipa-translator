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
  stringCount: number;
  strings: LocalizedString[];
  files: string[];
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
