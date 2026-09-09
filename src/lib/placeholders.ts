/**
 * Protect printf-style placeholders during translation so they are not altered.
 * Supports: %@ %d %i %f %u %x %s %% %1$@ %2$d etc.
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
    // Unicode brackets — rarely altered by MT; restore tolerates spacing
    return `⟦PH${idx}⟧`;
  });

  const restore = (translated: string): string => {
    let out = translated;
    tokens.forEach((token, idx) => {
      const patterns = [
        `⟦\\s*PH\\s*${idx}\\s*⟧`,
        `\\[\\s*PH\\s*${idx}\\s*\\]`,
        `__\\s*PH\\s*[_\\s-]*${idx}\\s*__`,
      ];
      for (const src of patterns) {
        const re = new RegExp(src, "gi");
        if (re.test(out)) {
          out = out.replace(new RegExp(src, "gi"), token);
          break;
        }
      }
    });
    return out;
  };

  return { protectedText, restore };
}
