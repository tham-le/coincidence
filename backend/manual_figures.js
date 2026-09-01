// Figures Wikidata cannot place or date, filled in by hand.
//
// These are almost all ancient or non-European, which is the same gap that
// shows up everywhere else in this dataset: Wikidata has a precise birth date
// and birth-place coordinate for a minor European noble and nothing at all for
// a Nubian pharaoh or the founder of Majapahit.
//
// Every date here is approximate and is stored with date_prec 'circa', so the
// interface can print "c. 1280" and never claim a day. Coordinates are the
// place the person is most associated with, not necessarily a birth place.
//
// Keys are the titles used in curated_list.js.

module.exports = {
  // Vietnam
  'Trưng Trắc':      { start: 14,    end: 43,    lat: 21.18, lon: 105.70 }, // Mê Linh
  'Lý Nam Đế':       { start: 503,   end: 548,   lat: 21.03, lon: 105.85 }, // Red River delta
  'Lê Đại Hành':     { start: 941,   end: 1005,  lat: 20.25, lon: 105.90 }, // Hoa Lư

  // Southeast Asia
  'Raden Wijaya':    { start: 1256,  end: 1309,  lat: -7.55, lon: 112.38 }, // Trowulan, Majapahit

  // South Asia
  'Kalidasa':        { start: 370,   end: 450,   lat: 23.18, lon: 75.78 },  // Ujjain
  'Rajaraja I':      { start: 947,   end: 1014,  lat: 10.79, lon: 79.14 },  // Thanjavur

  // Persia and Mesopotamia
  'Zoroaster':       { start: -1000, end: -930,  lat: 36.75, lon: 66.90 },  // Balkh
  'Gilgamesh':       { start: -2800, end: -2700, lat: 31.32, lon: 45.64 },  // Uruk

  // Egypt, Nubia and Ethiopia
  'Imhotep':         { start: -2680, end: -2610, lat: 29.87, lon: 31.22 },  // Saqqara
  'Akhenaten':       { start: -1380, end: -1336, lat: 27.65, lon: 30.90 },  // Amarna
  'Piye':            { start: -750,  end: -714,  lat: 18.53, lon: 31.83 },  // Napata
  'Taharqa':         { start: -710,  end: -664,  lat: 18.53, lon: 31.83 },  // Napata
  'Ezana of Axum':   { start: 300,   end: 360,   lat: 14.13, lon: 38.72 },  // Axum

  // West and Central Africa
  'Mansa Musa':      { start: 1280,  end: 1337,  lat: 11.38, lon: -8.42 },  // Niani, Mali
  'Queen Nzinga':    { start: 1583,  end: 1663,  lat: -9.30, lon: 14.90 },  // Ndongo
  'Yaa Asantewaa':   { start: 1840,  end: 1921,  lat: 6.70,  lon: -1.47 },  // Ejisu, Asante

  // Americas
  'Nezahualcoyotl':  { start: 1402,  end: 1472,  lat: 19.51, lon: -98.88 }, // Texcoco

  // Mediterranean
  'Homer':           { start: -800,  end: -740,  lat: 38.42, lon: 27.14 },  // Ionia
  'Pythagoras':      { start: -570,  end: -495,  lat: 37.75, lon: 26.98 },  // Samos
  'Seneca the Younger':     { start: -4,   end: 65,   lat: 37.88, lon: -4.78 },  // Corduba
  'Galen':                  { start: 129,  end: 216,  lat: 39.12, lon: 27.18 },  // Pergamon
  'Constantine the Great':  { start: 272,  end: 337,  lat: 43.32, lon: 21.90 },  // Naissus

  // Oceania
  'Kupe':            { start: 1200,  end: 1270,  lat: -35.50, lon: 173.40 }, // Hokianga
};
