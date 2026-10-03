const html = \
John 15:4-11 NKJV - Abide in Me, and I in you. As the
Bible Gateway
https://www.biblegateway.com › passage
Abide in Me, and I in you. As the branch cannot bear fruit of itself, unless it abides in the vine, neither can you, unless you abide in Me.Read more
John 15:4 Remain in Me, and I will remain in you. Just as ...

Bible Hub
https://biblehub.com › john
Abide in me, and I in you. As the branch cannot bear fruit by itself, unless it abides in the vine, neither can you, unless you abide in me.Read more
\;

function parseScripture(raw) {
  const results = [];
  const seen    = new Set();

  const BOOKS = 'Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|' +
    '(?:1|2)\\\\s*Samuel|(?:1|2)\\\\s*Kings|(?:1|2)\\\\s*Chronicles|Ezra|Nehemiah|Esther|Job|' +
    'Psalms?|Proverbs|Ecclesiastes|Song of Songs?|Song of Solomon|Isaiah|Jeremiah|' +
    'Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|' +
    'Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|' +
    '(?:1|2)\\\\s*Corinthians|Galatians|Ephesians|Philippians|Colossians|' +
    '(?:1|2)\\\\s*Thessalonians|(?:1|2)\\\\s*Timothy|Titus|Philemon|Hebrews|James|' +
    '(?:1|2|3)\\\\s*Peter|(?:1|2|3)\\\\s*John|Jude|Revelation';

  // Make it more robust: match "Book Chap:Verse [optional versions/junk] - Text"
  // Or "Book Chap:Verse Text"
  // Let's refine the regex.
  const refPat = new RegExp(
    \((?:(?:1|2|3)\\\\s*)?(?:[A-Za-z]+))\\\\s+(\\\\d+:\\\\d+(?:\\\\s*[-–]\\\\s*\\\\d+)?)\,
    'gi'
  );

  let m;
  while ((m = refPat.exec(raw)) !== null) {
      console.log('Matched:', m[0]);
  }
}

parseScripture(html);
