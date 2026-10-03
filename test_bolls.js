function parseReference(refStr) {
  const match = refStr.match(/^\s*(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/);
  if (!match) return null;
  return {
    book: match[1].trim(),
    chapter: parseInt(match[2], 10),
    verseStart: parseInt(match[3], 10),
    verseEnd: match[4] ? parseInt(match[4], 10) : parseInt(match[3], 10)
  };
}

function cleanBollsText(text) {
  if (!text) return "";
  // Strip Strong's numbers <S>1234</S>
  let cleaned = text.replace(/<S>\d+<\/S>/gi, "");
  // Strip any other HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  // Clean up multiple spaces
  cleaned = cleaned.replace(/\s+/g, " ");
  return cleaned.trim();
}

async function fetchVerseText(reference, translation) {
  const parsed = parseReference(reference);
  if (!parsed) {
    throw new Error("Could not parse reference: " + reference);
  }

  // 1. Try Bolls.life first if translation is supported
  const unsupportedBolls = ["BBE", "CSB"];
  if (!unsupportedBolls.includes(translation.toUpperCase())) {
    try {
      const url = `https://bolls.life/get-text/${translation}/${encodeURIComponent(parsed.book)}/${parsed.chapter}/`;
      const res = await fetch(url);
      if (res.ok) {
        const verses = await res.json();
        if (Array.isArray(verses) && verses.length > 0) {
          const matching = verses.filter(v => v.verse >= parsed.verseStart && v.verse <= parsed.verseEnd);
          if (matching.length > 0) {
            const text = matching.map(v => `${v.verse} ${cleanBollsText(v.text)}`).join(" ");
            return {
              text,
              source: `bolls.life (${translation})`
            };
          }
        }
      }
    } catch (e) {
      console.warn("Bolls.life failed, falling back to bible-api.com:", e.message);
    }
  }

  // 2. Fallback to bible-api.com
  try {
    let apiTrans = 'web';
    if (translation.toLowerCase().includes('kjv')) apiTrans = 'kjv';
    else if (translation.toLowerCase().includes('bbe')) apiTrans = 'bbe';
    
    const apiUrl = `https://bible-api.com/${encodeURIComponent(reference)}?translation=${apiTrans}`;
    const res = await fetch(apiUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.text) {
        return {
          text: data.text.trim(),
          source: `bible-api.com (${data.translation_id || 'web'})`
        };
      }
    }
  } catch (e) {
    console.warn("bible-api.com failed:", e.message);
  }

  return null;
}

async function run() {
  const tests = [
    { ref: "John 3:16", trans: "ESV" },
    { ref: "1 John 3:16-17", trans: "NIV" },
    { ref: "Genesis 1:1-2", trans: "KJV" },
    { ref: "John 3:16", trans: "BBE" },
    { ref: "Romans 12:1", trans: "NKJV" }
  ];
  for (const t of tests) {
    console.log(`Testing ${t.ref} in ${t.trans}...`);
    const res = await fetchVerseText(t.ref, t.trans);
    console.log("Result:", res);
  }
}
run();
