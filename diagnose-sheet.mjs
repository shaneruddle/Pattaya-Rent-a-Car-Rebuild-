
import fetch from 'node-fetch';
import Papa from 'papaparse';
import { format, parse, isValid } from 'date-fns';

async function diagnose() {
  const url = 'https://docs.google.com/spreadsheets/d/1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo/export?format=csv&gid=1568141421';
  try {
    const response = await fetch(url);
    const text = await response.text();
    const results = Papa.parse(text, { skipEmptyLines: true });
    const rows = results.data;
    
    console.log('Total rows:', rows.length);
    const headers = rows[0];
    console.log('Headers:', headers.slice(0, 10).join(', '));

    const targetDate = '2026-03-26';
    let foundRow = null;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const dateStr = row[0]?.trim();
      if (!dateStr) continue;

      let parsedDate = null;
      const formats = ["MM/dd/yyyy", "M/d/yyyy", "yyyy-MM-dd", "dd/MM/yyyy"];
      for (const fmt of formats) {
        const d = parse(dateStr, fmt, new Date());
        if (isValid(d)) {
          parsedDate = d;
          break;
        }
      }

      if (parsedDate && format(parsedDate, 'yyyy-MM-dd') === targetDate) {
        foundRow = row;
        break;
      }
    }

    if (foundRow) {
      console.log(`Data for ${targetDate}:`, foundRow.slice(0, 10).join(', '));
      // Index 3 is duration 2
      console.log(`Rate for 2 days (Index 3):`, foundRow[3]);
    } else {
      console.log(`Date ${targetDate} not found in sheet.`);
      // Show some dates that ARE there
      console.log('First 5 dates:', rows.slice(1, 6).map(r => r[0]).join(', '));
      console.log('Last 5 dates:', rows.slice(-5).map(r => r[0]).join(', '));
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

diagnose();
