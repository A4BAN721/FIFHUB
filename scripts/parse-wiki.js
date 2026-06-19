const https = require('https');
const fs = require('fs');
const url = 'https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup_squads&prop=text&format=json&formatversion=2';
const opts = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } };
https.get(url, opts, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const html = json.parse.text;
    const teamSectionRegex = /<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g;
    const sections = [...html.matchAll(teamSectionRegex)];
    const map = {};
    for (const sec of sections) {
      const table = sec[2];
      const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
      for (const row of rows) {
        const cols = [...row[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/g)].map(match => match[1].replace(/<[^>]+>/g, '').replace(/\u00A0/g, ' ').trim());
        if (cols.length >= 3) {
          const num = cols[0].replace(/[^0-9]/g, '');
          const name = cols[2].replace(/\(captain\)/gi, '').trim();
          if (num && name) {
            map[name] = parseInt(num, 10);
          }
        }
      }
    }
    fs.writeFileSync('scripts/wiki-jersey-map.json', JSON.stringify(map, null, 2));
    console.log('mapped names', Object.keys(map).length);
    console.log('sample', Object.entries(map).slice(0,20).map(([n,v]) => `${v}:${n}`).join(' | '));
  });
}).on('error', console.error);
