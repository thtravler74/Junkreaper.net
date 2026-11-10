/** Well-known progressions, keyed by a normalised Roman-numeral sequence. */
const KNOWN: Record<string, string> = {
  "I-V-vi-IV": "the four-chord \"Axis\" progression that underpins a huge share of modern pop and rock",
  "vi-IV-I-V": "the \"Axis\" progression rotated to start on vi, often heard as the melancholic pop loop",
  "IV-I-V-vi": "a rotation of the \"Axis\" progression starting on IV",
  "V-vi-IV-I": "a rotation of the \"Axis\" progression starting on V",
  "I-vi-IV-V": "the classic 1950s doo-wop progression",
  "I-IV-V": "the three-chord progression at the heart of blues, rock and folk",
  "I-IV-V-IV": "a three-chord rock vamp",
  "I-V-IV": "a three-chord rock progression",
  "ii-V-I": "the jazz turnaround (ii–V–I)",
  "I-vi-ii-V": "the \"rhythm changes\" turnaround",
  "I-IV-vi-V": "a common pop progression",
  "I-♭VII-IV": "the Mixolydian rock progression (I–♭VII–IV)",
  "i-♭VII-♭VI-♭VII": "a minor-key rock/EDM loop",
  "i-♭VI-♭III-♭VII": "the minor-key pop loop (i–♭VI–♭III–♭VII), the Axis progression in its minor spelling",
  "i-♭VI-♭VII": "the epic/trailer minor progression (i–♭VI–♭VII)",
  "i-iv-V": "the minor three-chord progression",
  "i-♭VII-♭VI-V": "the Andalusian cadence",
  "i-iv-♭VII-♭III": "a descending-fifths minor sequence",
  "I-iii-IV-V": "a classic pop progression (I–iii–IV–V)",
  "I-V-vi-iii-IV-I-IV-V": "the Pachelbel's Canon progression",
  "vi-V-IV-V": "a looping minor-flavoured pop progression",
  "I-ii-iii-IV": "a stepwise ascending progression",
  "I-IV": "a two-chord I–IV vamp",
  "i-♭VII": "a two-chord minor vamp (i–♭VII)",
  "I-V": "a two-chord tonic–dominant vamp",
};

export function normaliseRoman(r: string): string {
  return r.replace(/(maj7|7|sus4|°|\+)/g, "").replace(/♮/g, "");
}

export function describeProgression(romans: string[]): string | null {
  const key = romans.map(normaliseRoman).join("-");
  if (KNOWN[key]) return KNOWN[key]!;
  // Also check rotations of 4-chord loops.
  if (romans.length === 4) {
    for (let r = 1; r < 4; r++) {
      const rot = [...romans.slice(r), ...romans.slice(0, r)].map(normaliseRoman).join("-");
      if (KNOWN[rot]) return `a rotation of ${KNOWN[rot]!}`;
    }
  }
  return null;
}
