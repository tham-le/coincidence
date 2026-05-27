const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Connect to the Solid SQL Stock
const db = new sqlite3.Database(path.join(__dirname, 'coincidence.db'));

app.use(cors());
app.use(express.json());
const buildPath = path.resolve(__dirname, '../frontend/build');
console.log(`Serving static files from: ${buildPath}`);
app.use(express.static(buildPath));

app.get('/api/entity/:id', (req, res) => {
  const { id } = req.params;
  
  db.get("SELECT * FROM historical_entities WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: "Database error" });
    if (!row) return res.status(404).json({ error: "Entity not found" });

    if (row.summary) {
      // Return cached summary
      return res.json({
        ...row,
        summary: JSON.parse(row.summary)
      });
    }

    // Not cached, fetch from Wikipedia
    if (!row.wpTitle) return res.json(row);

    const wpUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(row.wpTitle.replace(/ /g, '_'))}`;
    
    axios.get(wpUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; CoincidenceBot/1.0; +http://example.com/bot)',
        'Accept': 'application/json; charset=utf-8'
      }
    })
      .then(response => {
        const summary = response.data;
        if (summary && summary.type !== 'disambiguation') {
          const summaryStr = JSON.stringify(summary);
          db.run("UPDATE historical_entities SET summary = ? WHERE id = ?", [summaryStr, id]);
          res.json({ ...row, summary });
        } else {
          // If disambiguation or no summary, try searching by title as a fallback
          res.json(row);
        }
      })
      .catch(err => {
        // Fallback: If 404, maybe the title has slight differences
        console.error(`Wikipedia fetch error for ${row.wpTitle}:`, err.message);
        res.json(row);
      });
  });
});

app.get('/api/search-name', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  const sql = `
    SELECT * FROM historical_entities 
    WHERE name LIKE ? 
    ORDER BY importance_score DESC 
    LIMIT 10
  `;

  db.all(sql, [`%${q}%`], (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(rows);
  });
});

// New Endpoint: Find everyone alive during a specific person's life (with optional category filter)
app.get('/api/contemporaries', (req, res) => {
  const { start, end, excludeId, category, lat, lon } = req.query;
  const s = parseInt(start);
  const e = parseInt(end);
  const focusLat = parseFloat(lat || 0);
  const focusLon = parseFloat(lon || 0);

  // Define "Active Peak" as 18 years after birth
  const activeStart = s + 18;

  let sql = `
    SELECT *,
    (CASE 
      WHEN (latitude BETWEEN 35 AND 72) AND (longitude BETWEEN -25 AND 45) THEN 0.3
      ELSE 1.0 
    END) as region_weight
    FROM historical_entities 
    WHERE id != ?
    AND (
      (start_year BETWEEN ? AND ?) OR 
      (end_year BETWEEN ? AND ?) OR
      (start_year <= ? AND end_year >= ?)
    )
  `;

  const params = [excludeId, s, e, s, e, s, e];

  if (category && category !== 'All') {
    sql += ` AND LOWER(category) = ? `;
    params.push(category.toLowerCase());
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });

    // Calculate Synchronicity Score for each row
    const scored = rows.map(r => {
      // 1. Temporal Overlap Score (favors shared "Active Peak")
      const overlapStart = Math.max(activeStart, r.start_year + 18);
      const overlapEnd = Math.min(e, r.end_year);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const temporalScore = overlap / (e - s);

      // 2. Spatial Symmetry Boost (favors the "other side of the world")
      // Simple distance-based boost: further away = higher boost
      const dist = Math.sqrt(Math.pow(r.latitude - focusLat, 2) + Math.pow(r.longitude - focusLon, 2));
      const symmetryBoost = 1 + (dist / 180); // Max boost around 2x

      // 3. Final Score
      const score = temporalScore * symmetryBoost * r.importance_score * r.region_weight;

      return { ...r, sync_score: score };
    });

    // Sort by sync_score and take top 40
    const finalResults = scored
      .sort((a, b) => b.sync_score - a.sync_score)
      .slice(0, 40);

    res.json(finalResults);
  });
});
app.get('/api/categories', (req, res) => {
  db.all("SELECT DISTINCT category FROM historical_entities WHERE category IS NOT NULL", (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });
    // Normalize to Title Case and remove duplicates
    const cats = [...new Set(rows.map(r => {
      const c = r.category.toLowerCase();
      return c.charAt(0).toUpperCase() + c.slice(1);
    }))];
    res.json(cats);
  });
});

// New Endpoint: Get counts per decade for the timeline sparkline
app.get('/api/history-density', (req, res) => {
  const sql = `
    SELECT (start_year / 20) * 20 as decade, COUNT(*) as count 
    FROM historical_entities 
    GROUP BY decade 
    ORDER BY decade ASC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json(rows);
  });
});

app.get('/api/search-region', (req, res) => {
  const { year, lat, lon } = req.query;
  const targetYear = parseInt(year);
  const targetLat = parseFloat(lat);
  const targetLon = parseFloat(lon);

  const windowSize = 30;
  const windowStart = targetYear - windowSize;
  const windowEnd = targetYear + windowSize;

  // Simple bounding box for 1000km (~9 degrees)
  const latMin = targetLat - 9;
  const latMax = targetLat + 9;
  const lonMin = targetLon - 9;
  const lonMax = targetLon + 9;

  const sql = `
    SELECT * FROM historical_entities 
    WHERE (start_year <= ? AND end_year >= ?)
    AND (latitude BETWEEN ? AND ?)
    AND (longitude BETWEEN ? AND ?)
    ORDER BY importance_score DESC
    LIMIT 10
  `;

  db.all(sql, [windowEnd, windowStart, latMin, latMax, lonMin, lonMax], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows);
  });
});

// New Endpoint: Get all entities for a specific year to show on the Chaos Map
app.get('/api/year-summary', (req, res) => {
  const { year } = req.query;
  const targetYear = parseInt(year);
  
  // Adaptive limit
  let limit = 150;
  if (targetYear > 1900) limit = 40;
  else if (targetYear > 1500) limit = 60;
  else if (targetYear > 500) limit = 100;

  // We fetch a larger pool to perform "Meanwhile" Category Balancing in JS
  const sql = `
    SELECT *, 
    (CASE 
      WHEN (latitude BETWEEN 35 AND 72) AND (longitude BETWEEN -25 AND 45)
      THEN importance_score * 0.3
      ELSE importance_score 
    END) as fairness_score
    FROM historical_entities 
    WHERE (start_year <= ? AND end_year >= ?)
    ORDER BY fairness_score DESC
    LIMIT 400
  `;

  db.all(sql, [targetYear, targetYear], (err, rows) => {
    if (err) {
      console.error("Database error in year-summary:", err);
      return res.status(500).json({ error: "Database error" });
    }
    
    if (!rows || rows.length === 0) return res.json([]);

    // "Meanwhile" Category Balancing Logic:
    const categoryMap = {
      'Leaders': ['leaders', 'leader', 'person', 'global history'],
      'Scientists': ['scientists', 'scientist'],
      'Artists': ['artists', 'artist'],
      'Philosophers': ['philosophers', 'philosopher'],
      'Event': ['event', 'events']
    };

    const balanced = [];
    const seen = new Set();

    // 1. Pick the top 3 from each major category first
    Object.keys(categoryMap).forEach(catName => {
      const variants = categoryMap[catName];
      const topInCat = rows
        .filter(r => r.category && variants.includes(r.category.toLowerCase()))
        .slice(0, 3);
      
      topInCat.forEach(r => {
        if (!seen.has(r.id)) {
          balanced.push(r);
          seen.add(r.id);
        }
      });
    });

    // 2. Fill the rest of the limit with the highest remaining fairness_scores
    const remaining = rows
      .filter(r => !seen.has(r.id))
      .sort((a, b) => b.fairness_score - a.fairness_score);
    
    const finalResults = [...balanced, ...remaining].slice(0, limit);

    res.json(finalResults);
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

app.listen(port, () => console.log(`Solid SQL Server active on port ${port}`));
