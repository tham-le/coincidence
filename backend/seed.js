const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));

const seedData = [
  { id: "Q1", name: "Charlemagne", wpTitle: "Charlemagne", type: "person", start_year: 742, end_year: 814, lat: 48.8566, lon: 2.3522, importance_score: 200, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Charlemagne_by_Louis_Felix_Amiel.jpg/220px-Charlemagne_by_Louis_Felix_Amiel.jpg" },
  { id: "Q2", name: "Julius Caesar", wpTitle: "Julius_Caesar", type: "person", start_year: -100, end_year: -44, lat: 41.8902, lon: 12.4922, importance_score: 195, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Cajus_Iulius_Caesar_%28Vatican_Museums%29.jpg/220px-Cajus_Iulius_Caesar_%28Vatican_Museums%29.jpg" },
  { id: "Q3", name: "Jayavarman VII", wpTitle: "Jayavarman_VII", type: "person", start_year: 1125, end_year: 1218, lat: 13.4125, lon: 103.8670, importance_score: 180, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Jayavarman_VII.jpg/220px-Jayavarman_VII.jpg" },
  { id: "Q4", name: "Napoleon", wpTitle: "Napoleon", type: "person", start_year: 1769, end_year: 1821, lat: 41.9267, lon: 8.7369, importance_score: 198, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Jacques-Louis_David_-_The_Emperor_Napoleon_in_His_Study_at_the_Tuileries_-_Google_Art_Project.jpg/220px-Jacques-Louis_David_-_The_Emperor_Napoleon_in_His_Study_at_the_Tuileries_-_Google_Art_Project.jpg" },
  { id: "Q50", name: "Hadrian", wpTitle: "Hadrian", type: "person", start_year: 76, end_year: 138, lat: 41.8902, lon: 12.4922, importance_score: 196, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Hadrian_Musei_Capitolini_MC817.jpg/220px-Hadrian_Musei_Capitolini_MC817.jpg" },
  { id: "Q60", name: "Leif Erikson", wpTitle: "Leif_Erikson", type: "person", start_year: 970, end_year: 1020, lat: 60.0, lon: -45.0, importance_score: 185, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Leiv_Eirikson_oppdager_Amerika.jpg/300px-Leiv_Eirikson_oppdager_Amerika.jpg" },
  { id: "Q61", name: "Avicenna", wpTitle: "Avicenna", type: "person", start_year: 980, end_year: 1037, lat: 39.9, lon: 64.4, importance_score: 190, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Avicenna_Portrait.jpg/220px-Avicenna_Portrait.jpg" },
  { id: "Q51", name: "Kanishka", wpTitle: "Kanishka", type: "person", start_year: 78, end_year: 144, lat: 34.01, lon: 71.58, importance_score: 170, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Kanishka_statue.jpg/220px-Kanishka_statue.jpg" },
  { id: "Q5", name: "Leonardo da Vinci", wpTitle: "Leonardo_da_Vinci", type: "person", start_year: 1452, end_year: 1519, lat: 43.7667, lon: 11.25, importance_score: 199, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Francesco_Melzi_-_Portrait_of_Leonardo.png/220px-Francesco_Melzi_-_Portrait_of_Leonardo.png" },
  { id: "Q6", "name": "Confucius", "wpTitle": "Confucius", "type": "person", "start_year": -551, "end_year": -479, "lat": 35.59, "lon": 116.98, "importance_score": 190, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Confucius_Small.jpg/220px-Confucius_Small.jpg" },
  { id: "Q7", "name": "Cleopatra", "wpTitle": "Cleopatra", "type": "person", "start_year": -69, "end_year": -30, "lat": 31.2001, "lon": 29.9187, "importance_score": 185, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Cleopatra_VII_Altes_Museum_Berlin.jpg/220px-Cleopatra_VII_Altes_Museum_Berlin.jpg" },
  { id: "Q8", "name": "Albert Einstein", "wpTitle": "Albert_Einstein", "type": "person", "start_year": 1879, "end_year": 1955, "lat": 48.4, "lon": 9.9833, "importance_score": 210, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Einstein_1921_by_F_Schmutzer_-_restoration.jpg/220px-Einstein_1921_by_F_Schmutzer_-_restoration.jpg" },
  { id: "Q101", "name": "French Revolution", "wpTitle": "French_Revolution", "type": "event", "start_year": 1789, "end_year": 1799, "lat": 48.8566, "lon": 2.3522, "importance_score": 190, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Prise_de_la_Bastille.jpg/220px-Prise_de_la_Bastille.jpg" },
  { id: "Q102", "name": "Fall of Rome", "wpTitle": "Fall_of_the_Western_Roman_Empire", "type": "event", "start_year": 395, "end_year": 476, "lat": 41.8902, "lon": 12.4922, "importance_score": 185, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/The_Course_of_Empire_The_Destruction_1836.jpg/220px-The_Course_of_Empire_The_Destruction_1836.jpg" },
  { id: "Q103", "name": "Black Death", "wpTitle": "Black_Death", "type": "event", "start_year": 1346, "end_year": 1353, "lat": 48.0, "lon": 15.0, "importance_score": 195, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/The_Triumph_of_Death_by_Pieter_Bruegel_the_Elder.jpg/300px-The_Triumph_of_Death_by_Pieter_Bruegel_the_Elder.jpg" },
  { id: "Q104", "name": "Great Pyramid", "wpTitle": "Great_Pyramid_of_Giza", "type": "event", "start_year": -2580, "end_year": -2560, "lat": 29.9792, "lon": 31.1342, "importance_score": 199, thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Kheops-Pyramid.jpg/220px-Kheops-Pyramid.jpg" }
];

db.serialize(() => {
    db.run("DROP TABLE IF EXISTS historical_entities");
    db.run(`CREATE TABLE historical_entities (
        id TEXT PRIMARY KEY,
        name TEXT,
        wpTitle TEXT,
        type TEXT,
        start_year INTEGER,
        end_year INTEGER,
        latitude REAL,
        longitude REAL,
        importance_score INTEGER,
        thumbnailUrl TEXT
    )`);

    const stmt = db.prepare("INSERT INTO historical_entities VALUES (?,?,?,?,?,?,?,?,?,?)");
    seedData.forEach(d => {
        stmt.run(d.id, d.name, d.wpTitle, d.type, d.start_year, d.end_year, d.lat, d.lon, d.importance_score, d.thumb);
    });
    stmt.finalize();
    console.log("✅ Database stocked with Thumbnails.");
});
db.close();
