import { normalizeCountryName } from "./country-utils";

const fifaAbbreviationsByNationId: Record<string, string> = {
  algeria: "ALG",
  argentina: "ARG",
  australia: "AUS",
  austria: "AUT",
  belgium: "BEL",
  "bosnia-herzegovina": "BIH",
  brazil: "BRA",
  "cape-verde": "CPV",
  cameroon: "CMR",
  canada: "CAN",
  chile: "CHI",
  colombia: "COL",
  croatia: "CRO",
  curacao: "CUW",
  czechia: "CZE",
  denmark: "DEN",
  "dr-congo": "COD",
  ecuador: "ECU",
  egypt: "EGY",
  england: "ENG",
  france: "FRA",
  germany: "GER",
  ghana: "GHA",
  haiti: "HAI",
  iran: "IRN",
  iraq: "IRQ",
  "ivory-coast": "CIV",
  italy: "ITA",
  japan: "JPN",
  jordan: "JOR",
  mexico: "MEX",
  morocco: "MAR",
  netherlands: "NED",
  "new-zealand": "NZL",
  nigeria: "NGA",
  norway: "NOR",
  panama: "PAN",
  paraguay: "PAR",
  poland: "POL",
  portugal: "POR",
  qatar: "QAT",
  "saudi-arabia": "KSA",
  scotland: "SCO",
  senegal: "SEN",
  serbia: "SRB",
  "south-africa": "RSA",
  "south-korea": "KOR",
  spain: "ESP",
  sweden: "SWE",
  switzerland: "SUI",
  tunisia: "TUN",
  turkiye: "TUR",
  uruguay: "URU",
  usa: "USA",
  uzbekistan: "UZB",
  venezuela: "VEN",
};

const displayNameByNationId: Record<string, string> = {
  usa: "United States",
};

export function getTeamDisplayName(teamName: string): string {
  if (teamName === "TBD") return teamName;

  const nationId = normalizeCountryName(teamName);
  return displayNameByNationId[nationId] ?? teamName;
}

export function getFifaAbbreviation(teamName: string): string {
  if (teamName === "TBD") return teamName;

  const nationId = normalizeCountryName(teamName);
  return fifaAbbreviationsByNationId[nationId] ?? teamName;
}
