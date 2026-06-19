export const fifaGroups: Record<string, string[]> = {
  A: ["mexico", "south-africa", "south-korea", "czechia"],
  B: ["canada", "bosnia-herzegovina", "qatar", "switzerland"],
  C: ["brazil", "morocco", "haiti", "scotland"],
  D: ["usa", "paraguay", "australia", "turkiye"],
  E: ["germany", "curacao", "ivory-coast", "ecuador"],
  F: ["netherlands", "japan", "sweden", "tunisia"],
  G: ["belgium", "egypt", "iran", "new-zealand"],
  H: ["spain", "cape-verde", "saudi-arabia", "uruguay"],
  I: ["france", "senegal", "iraq", "norway"],
  J: ["argentina", "algeria", "austria", "jordan"],
  K: ["portugal", "dr-congo", "uzbekistan", "colombia"],
  L: ["england", "croatia", "ghana", "panama"],
};

export const qualifiedNationIds = new Set(Object.values(fifaGroups).flat());
