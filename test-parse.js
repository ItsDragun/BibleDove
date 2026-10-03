const fs = require('fs');
fetch('https://www.biblegateway.com/quicksearch/?quicksearch=love&version=KJV')
  .then(r => r.text())
  .then(html => {
    // We can use DOMParser in the browser, but here we use regex for the test
    const results = [];
    const refRegex = /class="bible-item-title.*?>(.*?)<\/a>/g;
    const textRegex = /class="bible-item-text">(.*?)<\/div>/g;
    
    let refMatch, textMatch;
    while ((refMatch = refRegex.exec(html)) !== null && (textMatch = textRegex.exec(html)) !== null) {
      results.push({
        ref: refMatch[1].replace(/<[^>]+>/g, '').trim(),
        text: textMatch[1].replace(/<[^>]+>/g, '').trim()
      });
    }
    console.log(results.slice(0, 3));
  });
