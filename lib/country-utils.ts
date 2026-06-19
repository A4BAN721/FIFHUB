export function normalizeCountryName(name: string): string {
  const directNameMap: Record<string, string> = {
    "Bosnia & Herzegovina": "bosnia-herzegovina",
    "United States": "usa",
    USA: "usa",
    "Côte d'Ivoire": "ivory-coast",
    "Cote d'Ivoire": "ivory-coast",
    "Côte d’Ivoire": "ivory-coast",
    "Cote d’Ivoire": "ivory-coast",
    "DR Congo": "dr-congo",
    "Congo DR": "dr-congo",
    "Democratic Republic of Congo": "dr-congo",
    "Cabo Verde": "cape-verde",
    "Cape Verde": "cape-verde",
    "Cape Verde Island": "cape-verde",
    "South Korea": "south-korea",
    "Korea Republic": "south-korea",
    "Türkiye": "turkiye",
    "Curaçao": "curacao",
    Curacao: "curacao",
  };

  if (directNameMap[name]) return directNameMap[name];

  const normalizedName = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .trim();

  const normalizedNameMap: Record<string, string> = {
    "bosnia & herzegovina": "bosnia-herzegovina",
    "united states": "usa",
    usa: "usa",
    "cote divoire": "ivory-coast",
    "dr congo": "dr-congo",
    "congo dr": "dr-congo",
    "democratic republic of congo": "dr-congo",
    "cabo verde": "cape-verde",
    "cape verde": "cape-verde",
    "cape verde island": "cape-verde",
    curacao: "curacao",
    "south korea": "south-korea",
    "korea republic": "south-korea",
    turkiye: "turkiye",
  };

  return normalizedNameMap[normalizedName] || normalizedName.replace(/\s+/g, "-");
}
