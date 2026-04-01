
import fetch from 'node-fetch';
import * as XLSX from 'xlsx';
import { format, parse, isValid } from 'date-fns';

async function checkVios() {
  const url = 'https://docs.google.com/spreadsheets/d/1-RHwQ4LumsxPR1CXXtQjQb6cJ4v98x6GA2RiLE9OkTo/export?format=xlsx';
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    
    const sheetName = 'Vios';
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    console.log(`Sheet: ${sheetName}, Rows: ${rows.length}`);
    let foundCount = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.includes(2000)) {
        const dateVal = row[0];
        let dateStr = dateVal;
        if (typeof dateVal === 'number') {
          const d = new Date((dateVal - 25569) * 86400 * 1000);
          dateStr = format(d, 'yyyy-MM-dd');
        }
        console.log(`Found 2000 in row ${i}, Date: ${dateStr}`);
        foundCount++;
        if (foundCount > 5) break;
      }
    }
    if (foundCount === 0) console.log('2000 not found in Vios tab.');
  } catch (error) {
    console.error('Error:', error);
  }
}

checkVios();
