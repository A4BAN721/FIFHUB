const banglaNumerals: Record<string, string> = {
  "0": "০",
  "1": "১",
  "2": "২",
  "3": "৩",
  "4": "৪",
  "5": "৫",
  "6": "৬",
  "7": "৭",
  "8": "৮",
  "9": "৯",
};

const banglaNameOverrides: Record<string, string> = {
  "Lionel Messi": "লিওনেল মেসি",
  "Cristiano Ronaldo": "ক্রিস্টিয়ানো রোনালদো",
  Neymar: "নেইমার",
  "Kylian Mbappe": "কিলিয়ান এমবাপে",
  "Kylian Mbappé": "কিলিয়ান এমবাপে",
  "Harry Kane": "হ্যারি কেইন",
  "Kevin De Bruyne": "কেভিন ডি ব্রুইন",
  "Erling Haaland": "এর্লিং হালান্ড",
  "Vinicius Junior": "ভিনিসিয়ুস জুনিয়র",
  "Vinícius Júnior": "ভিনিসিয়ুস জুনিয়র",
  "Jude Bellingham": "জুড বেলিংহ্যাম",
  "Luka Modric": "লুকা মদ্রিচ",
  "Luka Modrić": "লুকা মদ্রিচ",
  "Mohamed Salah": "মোহামেদ সালাহ",
  "Virgil van Dijk": "ভিরজিল ভ্যান ডাইক",
  "Son Heung-min": "সন হিউং-মিন",
  "Sadio Mane": "সাদিও মানে",
  "Sadio Mané": "সাদিও মানে",
  "Karim Benzema": "করিম বেনজেমা",
  "Antoine Griezmann": "আন্তোয়ান গ্রিজমান",
  "Manuel Neuer": "মানুয়েল নয়্যার",
  "Thibaut Courtois": "থিবো কুর্তোয়া",
  "Alisson Becker": "আলিসন বেকার",
  "Achraf Hakimi": "আশরাফ হাকিমি",
  "Lautaro Martinez": "লাউতারো মার্তিনেজ",
  "Lautaro Martínez": "লাউতারো মার্তিনেজ",
  "Julian Alvarez": "হুলিয়ান আলভারেজ",
  "Julián Álvarez": "হুলিয়ান আলভারেজ",
};

const tokenOverrides: Record<string, string> = {
  de: "দে",
  da: "দা",
  di: "দি",
  del: "দেল",
  van: "ভ্যান",
  von: "ফন",
  al: "আল",
  el: "এল",
  jr: "জুনিয়র",
};

export function formatBanglaNumber(value: string | number) {
  return String(value).replace(/\d/g, (digit) => banglaNumerals[digit] ?? digit);
}

export function formatLocalizedNumber(value: string | number, language: "en" | "bn") {
  return language === "bn" ? formatBanglaNumber(value) : String(value);
}

export function formatLocalizedPlayerName(name: string, language: "en" | "bn") {
  if (language !== "bn") return name;
  return banglaNameOverrides[name] ?? transliterateLatinNameToBangla(name);
}

function transliterateLatinNameToBangla(name: string) {
  return name
    .split(/(\s+|-|')/)
    .map((part) => {
      if (!part.trim() || part === "-" || part === "'") return part;
      const normalized = stripAccents(part).toLowerCase().replace(/[^a-z]/g, "");
      return tokenOverrides[normalized] ?? transliterateToken(normalized);
    })
    .join("");
}

function transliterateToken(token: string) {
  let output = "";
  let index = 0;

  while (index < token.length) {
    const three = token.slice(index, index + 3);
    const two = token.slice(index, index + 2);
    const one = token[index];

    if (threeMap[three]) {
      output += threeMap[three];
      index += 3;
      continue;
    }

    if (twoMap[two]) {
      output += twoMap[two];
      index += 2;
      continue;
    }

    output += oneMap[one] ?? one;
    index += 1;
  }

  return output;
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const threeMap: Record<string, string> = {
  sch: "শ",
  tch: "চ",
};

const twoMap: Record<string, string> = {
  aa: "আ",
  ae: "এ",
  ai: "আই",
  au: "আউ",
  aw: "ও",
  ay: "েই",
  ch: "চ",
  ck: "ক",
  ee: "ই",
  ei: "েই",
  eu: "ইউ",
  ey: "েই",
  gh: "ঘ",
  gn: "ন",
  ia: "িয়া",
  ie: "িয়ে",
  io: "িও",
  kh: "খ",
  ll: "ল",
  mb: "ম্ব",
  mm: "ম",
  nn: "ন",
  ny: "নিয়",
  oo: "উ",
  ou: "উ",
  ph: "ফ",
  qu: "কু",
  rr: "র",
  sh: "শ",
  ss: "স",
  th: "থ",
  ts: "ৎস",
  tt: "ত",
  ue: "ুয়ে",
  ui: "ুই",
  ya: "য়া",
  ye: "য়ে",
  yo: "য়ো",
};

const oneMap: Record<string, string> = {
  a: "া",
  b: "ব",
  c: "ক",
  d: "দ",
  e: "ে",
  f: "ফ",
  g: "গ",
  h: "হ",
  i: "ি",
  j: "জ",
  k: "ক",
  l: "ল",
  m: "ম",
  n: "ন",
  o: "ো",
  p: "প",
  q: "ক",
  r: "র",
  s: "স",
  t: "ত",
  u: "ু",
  v: "ভ",
  w: "ও",
  x: "ক্স",
  y: "য়",
  z: "জ",
};
