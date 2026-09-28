var ADMIN_EMAIL = "luckypuppynyack@gmail.com";

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Bookings");
    const data = JSON.parse(e.postData.contents);
    const now = new Date();
    const bookingId = data.bookingId;

    sheet.appendRow([
      bookingId,
      now.toLocaleString(),
      'Pending',
      data.service,
      data.firstName,
      data.lastName,
      data.phone,
      data.email,
      data.numberOfDogs || 1,
      data.dogs,
      data.dates,
      data.startDate,
      data.endDate,
      data.notes
    ]);

    var scriptUrl  = ScriptApp.getService().getUrl();
    var acceptUrl  = scriptUrl + "?action=accept&bookingId="  + bookingId;
    var declineUrl = scriptUrl + "?action=decline&bookingId=" + bookingId;

    var emailBody =
      "<h2>New Booking Request</h2>" +
      "<p><strong>Booking ID:</strong> " + bookingId + "</p>" +
      "<p><strong>Service:</strong> " + data.service + "</p>" +
      "<p><strong>Owner:</strong> " + data.firstName + " " + data.lastName + "</p>" +
      "<p><strong>Phone:</strong> " + data.phone + "</p>" +
      "<p><strong>Email:</strong> " + data.email + "</p>" +
      "<p><strong>Number of Dogs:</strong> " + (data.numberOfDogs || 1) + "</p>" +
      "<p><strong>Dogs:</strong> " + data.dogs + "</p>" +
      "<p><strong>Dates:</strong> " + data.dates + "</p>" +
      (data.notes ? "<p><strong>Notes:</strong> " + data.notes + "</p>" : "") +
      "<br>" +
      "<a href='" + acceptUrl  + "' style='background:#1D9E75;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;margin-right:12px;font-family:sans-serif'>Accept Booking</a>" +
      "<a href='" + declineUrl + "' style='background:#c0392b;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-family:sans-serif'>Decline Booking</a>";

    GmailApp.sendEmail(
      ADMIN_EMAIL,
      "New Booking Request: " + bookingId + " - " + data.firstName + " " + data.lastName,
      "New booking request received. Please view in HTML.",
      { htmlBody: emailBody }
    );

    return ContentService
      .createTextOutput(JSON.stringify({ bookingId: bookingId }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    var errSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Bookings");
    errSheet.appendRow(['ERROR', new Date(), err.message, err.stack]);
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var action    = e.parameter.action;
  var bookingId = e.parameter.bookingId;
  var invoiceId = e.parameter.invoiceId;

  // ── Send boarding invoice to client ──
  if (action === 'sendInvoice' && invoiceId && bookingId) {
    try {
      sendInvoiceToClient(invoiceId, bookingId);
      return invoiceSentPage(invoiceId);
    } catch(err) {
      return HtmlService.createHtmlOutput('<h2>Error: ' + err.message + '</h2>');
    }
  }

  // ── Send daycare invoice to client ──
  if (action === 'sendDaycareInvoice' && invoiceId) {
    try {
      sendDaycareInvoiceToClient(invoiceId);
      return invoiceSentPage(invoiceId);
    } catch(err) {
      return HtmlService.createHtmlOutput('<h2>Error: ' + err.message + '</h2>');
    }
  }

  // ── Booking accept/decline ──
  if (!action || !bookingId) {
    return HtmlService.createHtmlOutput("<h2>Invalid request.</h2>");
  }

  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Bookings");
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];

  var bookingIdCol = headers.indexOf('Booking ID');
  var statusCol    = headers.indexOf('Status');
  var serviceCol   = headers.indexOf('Service');
  var firstNameCol = headers.indexOf('First Name');
  var lastNameCol  = headers.indexOf('Last Name');
  var phoneCol     = headers.indexOf('Phone');
  var emailCol     = headers.indexOf('Email');
  var numDogsCol   = headers.indexOf('Number of Dogs');
  var dogsCol      = headers.indexOf('Dog Name');
  var datesCol     = headers.indexOf('Dates');
  var startDateCol = headers.indexOf('Start Date');
  var endDateCol   = headers.indexOf('End Date');
  var notesCol     = headers.indexOf('Notes');

  var bookingRow  = -1;
  var bookingData = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][bookingIdCol] === bookingId) {
      bookingRow = i + 1;
      headers.forEach(function(h, idx) { bookingData[h] = data[i][idx]; });
      break;
    }
  }

  if (bookingRow === -1) {
    return HtmlService.createHtmlOutput("<h2>Booking not found.</h2>");
  }

  if (bookingData['Status'] === 'Confirmed' || bookingData['Status'] === 'Declined') {
    return HtmlService.createHtmlOutput("<h2>This booking has already been " + bookingData['Status'].toLowerCase() + ".</h2>");
  }

  if (action === 'accept') {
    sheet.getRange(bookingRow, statusCol + 1).setValue('Confirmed');

    var calendar   = CalendarApp.getDefaultCalendar();
    var eventTitle = bookingData['Dog Name'] + " | " + bookingData['Service'].split('(')[0].trim() + " | " + bookingId;
    var eventDesc  =
      "Booking ID: " + bookingId + "\n" +
      "Owner: " + bookingData['First Name'] + " " + bookingData['Last Name'] + "\n" +
      "Phone: " + bookingData['Phone'] + "\n" +
      "Email: " + bookingData['Email'] + "\n" +
      "Dogs: " + bookingData['Dog Name'] + "\n" +
      "Dates: " + bookingData['Dates'] + "\n" +
      (bookingData['Notes'] ? "Notes: " + bookingData['Notes'] : "");

    if (bookingData['Service'].indexOf('Daycare') !== -1) {
      var dates = String(bookingData['Dates']).split(',').map(function(d) { return d.trim(); });
      dates.forEach(function(dateStr) {
        var d = new Date(dateStr);
        calendar.createAllDayEvent(eventTitle, d, { description: eventDesc, guests: bookingData['Email'] });
      });
    } else {
      var startDate = new Date(bookingData['Start Date']);
      var endDate   = bookingData['End Date'] ? new Date(bookingData['End Date']) : new Date(startDate);
      endDate.setDate(endDate.getDate() + 1);
      calendar.createAllDayEvent(eventTitle, startDate, endDate, { description: eventDesc, guests: bookingData['Email'] });
    }

    GmailApp.sendEmail(
      bookingData['Email'],
      "Your Lucky Puppy Booking is Confirmed!",
      "Your booking has been confirmed.",
      {
        htmlBody:
          "<h2>You're confirmed!</h2>" +
          "<p>Hi " + bookingData['First Name'] + ", your booking with Lucky Puppy has been confirmed.</p>" +
          "<p><strong>Booking ID:</strong> " + bookingId + "</p>" +
          "<p><strong>Service:</strong> " + bookingData['Service'] + "</p>" +
          "<p><strong>Dogs:</strong> " + bookingData['Dog Name'] + "</p>" +
          "<p><strong>Dates:</strong> " + bookingData['Dates'] + "</p>" +
          "<br><p>Questions? Reply to this email or call/text us at 973-902-3483.</p>" +
          "<p>- Lucky Puppy, Nyack NY</p>"
      }
    );

    return HtmlService.createHtmlOutput(
      "<h2 style='font-family:sans-serif;color:#1D9E75'>Booking " + bookingId + " confirmed!</h2>" +
      "<p style='font-family:sans-serif'>Calendar event created and confirmation email sent to " + bookingData['Email'] + ".</p>"
    );

  } else if (action === 'decline') {
    sheet.getRange(bookingRow, statusCol + 1).setValue('Declined');

    GmailApp.sendEmail(
      bookingData['Email'],
      "Update on Your Lucky Puppy Booking Request",
      "Please view this email in HTML.",
      {
        htmlBody:
          "<h2>Booking Update</h2>" +
          "<p>Hi " + bookingData['First Name'] + ", unfortunately we are unable to accommodate your booking request for those dates.</p>" +
          "<p><strong>Booking ID:</strong> " + bookingId + "</p>" +
          "<p>Please reach out to us to find alternative dates - we would love to have " + bookingData['Dog Name'] + " join us!</p>" +
          "<p>Call/text: 973-902-3483 or email: luckypuppynyack@gmail.com</p>" +
          "<p>- Lucky Puppy, Nyack NY</p>"
      }
    );

    return HtmlService.createHtmlOutput(
      "<h2 style='font-family:sans-serif;color:#c0392b'>Booking " + bookingId + " declined.</h2>" +
      "<p style='font-family:sans-serif'>Decline email sent to " + bookingData['Email'] + ".</p>"
    );
  }

  return HtmlService.createHtmlOutput("<h2>Unknown action.</h2>");
}

function invoiceSentPage(invoiceId) {
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;max-width:500px;margin:40px auto;text-align:center;">' +
    '<div style="font-size:48px;">&#x1F43E;</div>' +
    '<h2 style="color:#27500A;">Invoice Sent!</h2>' +
    '<p style="color:#555;">Invoice <strong>' + invoiceId + '</strong> has been sent to the client and logged as Sent.</p>' +
    '</div>'
  );
}