// Wikidata occupation (P106) ids grouped into the categories the site shows.
//
// A person usually has several occupations. We count how many land in each
// category and pick the winner, so Einstein (physicist, mathematician,
// scientist, but also "writer") comes out a Scientist, and Leonardo (painter,
// sculptor, architect, but also engineer) comes out an Artist.

const OCCUPATION_CATEGORIES = {
  Leaders: [
    'Q82955',    // politician
    'Q116',      // monarch
    'Q48352',    // head of state
    'Q39018',    // emperor
    'Q30461',    // president
    'Q14212',    // prime minister
    'Q372436',   // statesperson
    'Q1097498',  // ruler
    'Q3242115',  // revolutionary
    'Q12097',    // sovereign
    'Q193391',   // diplomat
    'Q2285706',  // head of government
    'Q611644',   // Catholic priest turned office holder (popes)
    'Q19546',    // pope
    'Q207360',   // sultan
    'Q1064692',  // caliph
  ],
  Military: [
    'Q47064',    // military personnel
    'Q189290',   // military officer
    'Q83460',    // general
    'Q1210167',  // admiral
    'Q1364400',  // condottiero
    'Q4991371',  // marshal
    'Q10871364', // samurai
    'Q102039658',// warrior
    'Q12414919', // terrorist
    'Q21512362', // jihadist
    'Q16267607', // guerrilla fighter
    'Q1397808',  // resistance fighter
    'Q13365117', // mercenary
    'Q4351576',  // pirate
  ],
  Scientists: [
    'Q901',      // scientist
    'Q169470',   // physicist
    'Q593644',   // chemist
    'Q170790',   // mathematician
    'Q864503',   // biologist
    'Q11063',    // astronomer
    'Q39631',    // physician
    'Q205375',   // inventor
    'Q81096',    // engineer
    'Q18805',    // naturalist
    'Q2374149',  // astrologer-astronomer
    'Q520549',   // geologist
    'Q15895020', // computer scientist
    'Q13582652', // civil engineer
    'Q3055126',  // statistician
    'Q10872101', // biochemist
    'Q212980',   // botanist
    'Q350979',   // zoologist
  ],
  Artists: [
    'Q1028181',  // painter
    'Q1281618',  // sculptor
    'Q36834',    // composer
    'Q36180',    // writer
    'Q49757',    // poet
    'Q6625963',  // novelist
    'Q639669',   // musician
    'Q42973',    // architect
    'Q2526255',  // film director
    'Q214917',   // playwright
    'Q483501',   // artist
    'Q1930187',  // journalist
    'Q3391743',  // visual artist
    'Q266569',   // calligrapher
    'Q158852',   // conductor
    'Q33231',    // photographer
    'Q644687',   // illustrator
    'Q1925963',  // graphic artist
    'Q486748',   // pianist
    'Q1259917',  // singer in classical music
  ],
  Thinkers: [
    'Q4964182',  // philosopher
    'Q1234713',  // theologian
    'Q201788',   // historian
    'Q188094',   // economist
    'Q2306091',  // sociologist
    'Q4773904',  // anthropologist
    'Q14467526', // religious figure
    'Q3400985',  // monk
    'Q42857',    // prophet
    'Q1234713',  // theologian
    'Q182436',   // jurist
    'Q6051619',  // legal scholar
    'Q250867',   // Catholic priest
    'Q432386',   // imam
    'Q1281050',  // rabbi
    'Q733786',   // missionary
    'Q1231865',  // educator
    'Q121594',   // professor
    'Q10076267', // linguist
  ],
  Explorers: [
    'Q11900058', // explorer
    'Q11144108', // navigator
    'Q1734662',  // cartographer
    'Q13382576', // mountaineer
    'Q11774891', // seafarer
    'Q2003804',  // aviator
  ],
  // Kept separate so ranking can push them out of the way. A footballer is
  // not a bad row, it just should not outrank an 18th century emperor.
  Sport: [
    'Q937857',   // association football player
    'Q2066131',  // athlete
    'Q3665646',  // basketball player
    'Q10833314', // tennis player
    'Q11774156', // boxer
    'Q13141064', // cyclist
    'Q12299841', // cricketer
  ],
  Business: [
    'Q43845',    // businessperson
    'Q131524',   // entrepreneur
    'Q806798',   // banker
    'Q63755054', // building contractor
    'Q1662561',  // merchant
  ],
  Entertainment: [
    'Q33999',    // actor
    'Q177220',   // singer
    'Q10800557', // film actor
    'Q10798782', // television actor
    'Q947873',   // television presenter
    'Q4610556',  // model
    'Q245068',   // comedian
    'Q753110',   // songwriter
  ],
};

// A ruling or fighting role says more about why someone is remembered than a
// side occupation does, so those two get a small nudge in the count.
const CATEGORY_WEIGHT = {
  Leaders: 1.4, Military: 1.3, Explorers: 1.2,
  Scientists: 1.0, Artists: 1.0, Thinkers: 1.0,
  Sport: 0.9, Entertainment: 0.9, Business: 0.95,
};

// Occupations are not equally telling. Wikidata lists every role a person ever
// held, so a general who published his memoirs picks up writer, journalist,
// essayist and poet, and a plain count then makes him an artist. That is what
// happened to Võ Nguyên Giáp.
//
// Weight above 1 marks a role that defines why someone is remembered. Weight
// below 1 marks a role almost anyone notable can accumulate. Anything not
// listed counts as 1.
const OCCUPATION_WEIGHT = {
  // Defining
  'Q116': 3.0,       // monarch
  'Q39018': 3.0,     // emperor
  'Q12097': 2.6,     // sovereign
  'Q19546': 2.6,     // pope
  'Q207360': 2.6,    // sultan
  'Q1064692': 2.6,   // caliph
  'Q48352': 2.4,     // head of state
  'Q30461': 2.4,     // president
  'Q14212': 2.4,     // prime minister
  'Q2285706': 2.4,   // head of government
  'Q83460': 2.4,     // general
  'Q1210167': 2.4,   // admiral
  'Q189290': 2.2,    // military officer
  'Q372436': 2.0,    // statesperson
  'Q3242115': 2.0,   // revolutionary
  'Q12414919': 2.0,  // terrorist
  'Q21512362': 2.0,  // jihadist
  'Q1097498': 2.0,   // ruler
  'Q47064': 1.8,     // military personnel
  'Q1028181': 2.0,   // painter
  'Q169470': 2.0,    // physicist
  'Q593644': 2.0,    // chemist
  'Q11063': 1.8,     // astronomer
  'Q864503': 1.8,    // biologist
  'Q4964182': 1.8,   // philosopher
  'Q11900058': 2.0,  // explorer
  'Q11144108': 1.8,  // navigator
  'Q36834': 1.8,     // composer
  'Q1281618': 1.6,   // sculptor
  'Q82955': 1.5,     // politician

  // Roles many notable people also hold, which should not decide a category
  'Q36180': 0.6,     // writer
  'Q1930187': 0.5,   // journalist
  'Q11774202': 0.4,  // essayist
  'Q12144794': 0.4,  // prose writer
  'Q49757': 0.8,     // poet
  'Q1622272': 0.4,   // university teacher
  'Q121594': 0.4,    // professor
  'Q1231865': 0.5,   // educator
  'Q182436': 0.5,    // librarian or jurist, depending on the item
  'Q901': 0.7,       // scientist, the generic form
  'Q483501': 0.6,    // artist, the generic form
  'Q33999': 0.7,     // actor
  'Q43845': 0.8,     // businessperson
};

// Building the lookup fails loudly on a duplicate. Silently letting the last
// category win is how "military officer" ended up meaning Business, which then
// filed Võ Nguyên Giáp under the wrong heading.
const OCC_TO_CATEGORY = new Map();
for (const [cat, ids] of Object.entries(OCCUPATION_CATEGORIES)) {
  for (const id of ids) {
    const existing = OCC_TO_CATEGORY.get(id);
    if (existing && existing !== cat) {
      throw new Error(`occupation ${id} is listed under both ${existing} and ${cat}`);
    }
    OCC_TO_CATEGORY.set(id, cat);
  }
}

// occs: array of Q-ids from P106. Returns a category name or null.
function categoryFromOccupations(occs) {
  const score = {};
  for (const q of occs) {
    const cat = OCC_TO_CATEGORY.get(q);
    if (!cat) continue;
    score[cat] = (score[cat] || 0) + CATEGORY_WEIGHT[cat] * (OCCUPATION_WEIGHT[q] ?? 1);
  }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

module.exports = { categoryFromOccupations, OCCUPATION_CATEGORIES };
