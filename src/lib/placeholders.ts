/**
 * Protect printf-style placeholders during translation so they are not altered.
 * Supports: %@ %d %i %f %u %x %s %% %1$@ %2$d etc.
 *
 * Tokens use ASCII [PHn] form — NLLB/Opus-MT copy these more reliably than
 * fancy Unicode brackets.
 */

const PLACEHOLDER_RE =
  /%%|%(?:\d+\$)?(?:[-+0 #]*)?(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|h|ll|l|L|z|t|j)?[@dioxXufFeEgGaAcspSn%]/g;

export function protectPlaceholders(text: string): {
  protectedText: string;
  restore: (translated: string) => string;
} {
  const tokens: string[] = [];
  const protectedText = text.replace(PLACEHOLDER_RE, (match) => {
    const idx = tokens.length;
    tokens.push(match);
    return `[PH${idx}]`;
  });

  const restore = (translated: string): string => {
    let out = translated;
    tokens.forEach((token, idx) => {
      const patterns = [
        `\\[\\s*PH\\s*${idx}\\s*\\]`,
        `#\\s*PH\\s*${idx}\\s*#`,
        `⟦\\s*PH\\s*${idx}\\s*⟧`,
        `\\(\\s*PH\\s*${idx}\\s*#?\\s*\\)`,
        `__\\s*PH\\s*[_\\s-]*${idx}\\s*__`,
        // Model sometimes drops brackets but keeps PHn
        `(?<![A-Za-z0-9])PH\\s*${idx}(?![A-Za-z0-9])`,
      ];
      for (const src of patterns) {
        const probe = new RegExp(src, "gi");
        if (probe.test(out)) {
          out = out.replace(new RegExp(src, "gi"), token);
          break;
        }
      }
    });
    return out;
  };

  return { protectedText, restore };
}
