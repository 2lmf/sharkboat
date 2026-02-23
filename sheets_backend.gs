function doPost(e) {
  var sheetId = '15FxPpMR_USGUAGE-Ap1i1FD7uYo4wajTPl7wKZPj3fY';
  var ss = SpreadsheetApp.openById(sheetId);
  var action = e.parameter.action;
  
  if (action === 'logRoute') {
    var sheet = ss.getSheetByName('Rute');
    if(!sheet) sheet = ss.insertSheet('Rute');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["ID", "Datum", "Vrijeme Polaska", "Vrijeme Dolaska", "Distance NM", "Distance KM"]);
    }
    sheet.appendRow([
      e.parameter.id,
      e.parameter.date,
      e.parameter.startTime,
      e.parameter.endTime,
      e.parameter.distanceNM,
      e.parameter.distanceKM
    ]);
    return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === 'logFuel') {
    var sheet = ss.getSheetByName('Gorivo');
     if(!sheet) sheet = ss.insertSheet('Gorivo');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["ID", "Datum", "Litra", "Cijena EUR", "Pređeno od zadnjeg NM", "L/NM"]);
    }
    sheet.appendRow([
      e.parameter.id,
      e.parameter.date,
      e.parameter.liters,
      e.parameter.price,
      e.parameter.distSince,
      e.parameter.efficiency
    ]);
    return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'logLocation') {
    try {
      var sheet = ss.getSheetByName('Lokacije');
      if(!sheet) sheet = ss.insertSheet('Lokacije');
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["ID", "Datum", "Naziv", "Kategorija", "Lat", "Lng"]);
      }
      sheet.appendRow([
        e.parameter.id,
        e.parameter.date,
        e.parameter.name,
        e.parameter.category,
        e.parameter.lat,
        e.parameter.lng
      ]);
      return ContentService.createTextOutput(JSON.stringify({"status": "success"})).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": err.toString()})).setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({"status": "error", "message": "Unknown action"})).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var sheetId = '15FxPpMR_USGUAGE-Ap1i1FD7uYo4wajTPl7wKZPj3fY';
  var ss = SpreadsheetApp.openById(sheetId);
  var type = e.parameter.type; // 'routes', 'fuel', or 'locations'
  
  var sheetName = '';
  if (type === 'routes') sheetName = 'Rute';
  else if (type === 'fuel') sheetName = 'Gorivo';
  else if (type === 'locations') sheetName = 'Lokacije';
  
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
     return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var result = [];
  
  if (data.length > 1) {
    if (type === 'routes') {
       for(var i=1; i<data.length; i++) {
         result.push({
            id: data[i][0],
            date: data[i][1],
            startTime: data[i][2],
            endTime: data[i][3],
            distanceNM: data[i][4],
            distanceKM: data[i][5]
         });
       }
    } else if (type === 'fuel') {
        for(var i=1; i<data.length; i++) {
         result.push({
            id: data[i][0],
            date: data[i][1],
            liters: data[i][2],
            price: data[i][3],
            distSince: data[i][4],
            efficiency: data[i][5]
         });
       }
    } else if (type === 'locations') {
        for(var i=1; i<data.length; i++) {
         result.push({
            id: data[i][0],
            date: data[i][1],
            name: data[i][2],
            category: data[i][3],
            lat: data[i][4],
            lng: data[i][5]
         });
       }
    }
  }
  
  // Sort by date/ID descending (newest first)
  result.reverse();
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
