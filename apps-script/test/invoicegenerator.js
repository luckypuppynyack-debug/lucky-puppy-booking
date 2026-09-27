// ============================================================
// LUCKY PUPPY — Invoice Generator
//
// BOARDING:  runInvoicesForToday()       — daily 8am
// DAYCARE:   runDaycareInvoicesForWeek() — every Friday 8am
//
// Rates pulled from "Rates and Services" sheet.
// Day types pulled from "calendar" sheet.
// Dog names from Bookings sheet, puppy status from intake form.
// Holiday rate = base rate × HOLIDAY_PREMIUM multiplier.
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
var CONFIG = {
  SHEET_NAME:           'Bookings',
  INVOICE_SHEET_NAME:   'Invoices',
  RATES_SHEET_NAME:     'Rates and Services',
  CALENDAR_SHEET_NAME:  'calendar',
  INTAKE_SHEET_NAME:    'Form Responses 1',
  INVOICE_FOLDER_ID:    '1DbK2shQmlWrGqPkwv8vbZ_PJeThLwrQ0',
  FROM_NAME:            'Lucky Puppy',
  ADMIN_EMAIL:          'luckypuppynyack@gmail.com',
  PAYMENT_DUE_DAYS:     3,
  EXTENDED_STAY_NIGHTS: 16,
  STATUS: {
    CONFIRMED: 'Confirmed',
    DECLINED:  'Declined',
    PENDING:   'Pending',
  },
  INVOICE_STATUS: {
    UNSENT:  'Unsent',
    SENT:    'Sent',
    PAID:    'Paid',
    OVERDUE: 'Overdue',
  },
};

// ── COLUMN MAP — Bookings ────────────────────────────────────
var COL = {
  BOOKING_ID:  1,  TIMESTAMP:  2,  STATUS:     3,  SERVICE:    4,
  FIRST_NAME:  5,  LAST_NAME:  6,  PHONE:      7,  EMAIL:      8,
  NUM_DOGS:    9,  DOGS:       10, DATES:      11, START_DATE: 12,
  END_DATE:    13, TRANSPORT:  14, NOTES:      15,
};

// ── COLUMN MAP — Invoices ────────────────────────────────────
var INV_COL = {
  INVOICE_ID:   1,  BOOKING_ID:   2,  CLIENT_NAME:  3,  SERVICE:    4,
  PACK_TYPE:    5,  AMOUNT:       6,  INVOICE_DATE: 7,  DUE_DATE:   8,
  STATUS:       9,  PAID_DATE:    10,
};

// ============================================================
// DATA LOADERS
// ============================================================

function loadRates() {
  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.RATES_SHEET_NAME);
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var rates   = {};
  for (var i = 1; i < data.length; i++) {
    var row = {};
    headers.forEach(function(h, idx) { row[h] = data[i][idx]; });
    var code = row['rate_code'];
    if (!code) continue;
    rates[code] = {
      adult:  parseFloat((row['adult_price'] || '0').toString().replace('$', '')),
      puppy:  parseFloat((row['puppy_price'] || '0').toString().replace('$', '')),
      unit:   row['unit'],
      active: row['active'],
    };
  }
  return rates;
}

function loadCalendar() {
  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.CALENDAR_SHEET_NAME);
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var cal     = {};
  for (var i = 1; i < data.length; i++) {
    var row = {};
    headers.forEach(function(h, idx) { row[h] = data[i][idx]; });
    var rawKey = row['date_key'];
    var key = rawKey instanceof Date
      ? Utilities.formatDate(rawKey, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : (rawKey || '').toString().trim();
    if (key) cal[key] = row['day_type'];
  }
  return cal;
}

function getDateKey(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getDayType(date, cal) {
  return cal[getDateKey(date)] || 'Weekday';
}

function loadClientDogs(email, dogNamesStr, numDogs) {
  var nameList   = (dogNamesStr || '').split(',').map(function(s) { return s.trim(); });
  var sheet      = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.INTAKE_SHEET_NAME);
  var data       = sheet.getDataRange().getValues();
  var headers    = data[0];
  var today      = new Date();
  var oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  var dobMap     = {};

  for (var i = 1; i < data.length; i++) {
    var row = {};
    headers.forEach(function(h, idx) { row[h] = data[i][idx]; });
    var rowEmail = (row['Email'] || '').toString().trim().toLowerCase();
    if (rowEmail !== email.trim().toLowerCase()) continue;

    var singleName = (row['Dog Name'] || '').toString().trim().toLowerCase();
    var singleDob  = row['Dog Date of Birth'] ? new Date(row['Dog Date of Birth']) : null;
    if (singleName) dobMap[singleName] = singleDob ? singleDob > oneYearAgo : false;

    [{ name: 'Dog 1 Name', dob: 'Dog 1 Date of Birth' },
     { name: 'Dog 2 Name', dob: 'Dog 2 Date of Birth' },
     { name: 'Dog 3 Name', dob: 'Dog 3 Date of Birth' }].forEach(function(f) {
      var n = (row[f.name] || '').toString().trim().toLowerCase();
      if (!n) return;
      var d = row[f.dob] ? new Date(row[f.dob]) : null;
      dobMap[n] = d ? d > oneYearAgo : false;
    });
    break;
  }

  var dogs = [];
  for (var d = 0; d < numDogs; d++) {
    var name    = nameList[d] || ('Dog ' + (d + 1));
    var isPuppy = dobMap[name.toLowerCase()] !== undefined ? dobMap[name.toLowerCase()] : false;
    dogs.push({ name: name, isPuppy: isPuppy });
  }
  return dogs;
}

// ============================================================
// BOARDING CHARGE CALCULATOR
// ============================================================

function calculateBoardingCharges(booking, rates, cal) {
  var nights     = daysBetween(booking.startDate, booking.endDate);
  var isExtended = nights >= CONFIG.EXTENDED_STAY_NIGHTS;
  var numDogs    = booking.numDogs;
  var dogs       = loadClientDogs(booking.email, booking.dogs, numDogs);
  var premium    = (rates['HOLIDAY_PREMIUM'] && rates['HOLIDAY_PREMIUM'].adult) || 1.20;

  while (dogs.length < numDogs) {
    dogs.push({ name: 'Dog ' + (dogs.length + 1), isPuppy: false });
  }

  var nightLines = [];
  var grandTotal = 0;

  for (var n = 0; n < nights; n++) {
    var nightDate = new Date(booking.startDate);
    nightDate.setDate(booking.startDate.getDate() + n);
    var dayType   = getDayType(nightDate, cal);
    if (dayType === 'Weekend') dayType = 'Weekday'; // no weekend rate for boarding
    var isHoliday = dayType === 'Holiday';
    var nightTotal = 0;
    var dogLines   = [];

    for (var d = 0; d < numDogs; d++) {
      var dog     = dogs[d];
      var isFirst = (d === 0);
      var isPuppy = dog.isPuppy;
      var baseRate, rate, rateLabel;

      if (isExtended) {
        baseRate  = isPuppy ? rates['BOARDING_EXTENDED_STAY'].puppy : rates['BOARDING_EXTENDED_STAY'].adult;
        rate      = isHoliday ? Math.round(baseRate * premium * 100) / 100 : baseRate;
        rateLabel = 'Extended stay' + (isHoliday ? ' (holiday)' : '');
      } else if (isFirst) {
        baseRate  = isPuppy ? rates['BOARDING_STANDARD'].puppy : rates['BOARDING_STANDARD'].adult;
        rate      = isHoliday ? Math.round(baseRate * premium * 100) / 100 : baseRate;
        rateLabel = isHoliday ? 'Holiday rate' : (isPuppy ? 'Puppy rate' : 'Standard rate');
      } else {
        baseRate  = isPuppy ? rates['BOARDING_ADDITIONAL_DOG'].puppy : rates['BOARDING_ADDITIONAL_DOG'].adult;
        rate      = isHoliday ? Math.round(baseRate * premium * 100) / 100 : baseRate;
        rateLabel = isHoliday ? 'Additional dog (holiday)' : (isPuppy ? 'Additional puppy' : 'Additional dog');
      }

      nightTotal += rate;
      dogLines.push({ dogName: dog.name, rate: rate, rateLabel: rateLabel, isPuppy: isPuppy });
    }

    grandTotal += nightTotal;
    nightLines.push({ date: nightDate, dayType: dayType, dogLines: dogLines, total: nightTotal });
  }

  return { nights: nights, isExtended: isExtended, nightLines: nightLines, total: grandTotal };
}

// ============================================================
// DAYCARE CHARGE CALCULATOR
// ============================================================

function calculateDaycareCharges(client, rates, cal) {
  var numDogs = client.numDogs;
  var dogs    = loadClientDogs(client.email, client.dogs, numDogs);
  var premium = (rates['HOLIDAY_PREMIUM'] && rates['HOLIDAY_PREMIUM'].adult) || 1.20;

  while (dogs.length < numDogs) {
    dogs.push({ name: 'Dog ' + (dogs.length + 1), isPuppy: false });
  }

  var dayLines   = [];
  var grandTotal = 0;

  client.days.forEach(function(day) {
    var dayType   = getDayType(day, cal);
    var isHoliday = dayType === 'Holiday';
    var isWeekend = dayType === 'Weekend';
    var dayTotal  = 0;
    var dogLines  = [];

    for (var d = 0; d < numDogs; d++) {
      var dog     = dogs[d];
      var isFirst = (d === 0);
      var isPuppy = dog.isPuppy;
      var baseRate, rate, rateLabel;

      if (isFirst) {
        if (isWeekend && !isHoliday) {
          baseRate  = isPuppy ? rates['DAYCARE_WEEKEND'].puppy : rates['DAYCARE_WEEKEND'].adult;
          rate      = baseRate;
          rateLabel = isPuppy ? 'Weekend puppy rate' : 'Weekend rate';
        } else {
          baseRate  = isPuppy ? rates['DAYCARE_STANDARD'].puppy : rates['DAYCARE_STANDARD'].adult;
          rate      = isHoliday ? Math.round(baseRate * premium * 100) / 100 : baseRate;
          rateLabel = isHoliday ? 'Holiday rate' : (isPuppy ? 'Puppy rate' : 'Standard rate');
        }
      } else {
        baseRate  = isPuppy ? rates['DAYCARE_ADDITIONAL_DOG'].puppy : rates['DAYCARE_ADDITIONAL_DOG'].adult;
        rate      = isHoliday ? Math.round(baseRate * premium * 100) / 100 : baseRate;
        rateLabel = isHoliday ? 'Additional dog (holiday)' : (isPuppy ? 'Additional puppy' : 'Additional dog');
      }

      dayTotal += rate;
      dogLines.push({ dogName: dog.name, rate: rate, rateLabel: rateLabel, isPuppy: isPuppy });
    }

    grandTotal += dayTotal;
    dayLines.push({ date: day, dayType: dayType, dogLines: dogLines, total: dayTotal });
  });

  return { dayLines: dayLines, total: grandTotal };
}

// ============================================================
// BOARDING — daily 8am
// ============================================================
function runInvoicesForToday() {
  var today = new Date();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  var data  = sheet.getDataRange().getValues();
  var rates = loadRates();
  var cal   = loadCalendar();
  var generated = 0;

  for (var i = 1; i < data.length; i++) {
    var row     = data[i];
    var status  = row[COL.STATUS - 1];
    var service = (row[COL.SERVICE - 1] || '').toString();
    var endDate = new Date(row[COL.END_DATE - 1]);

    if (status !== CONFIG.STATUS.CONFIRMED)  continue;
    if (service.indexOf('Daycare') !== -1)   continue;
    if (!isSameDay(endDate, today))          continue;

    try {
      generateInvoiceForApproval(row, rates, cal);
      generated++;
      Logger.log('SUCCESS — boarding invoice for: ' + row[COL.BOOKING_ID - 1]);
    } catch (e) {
      Logger.log('ERROR on row ' + (i + 1) + ': ' + e.message);
    }
  }
  Logger.log('Boarding done. ' + generated + ' invoice(s) for ' + formatDate(today));
}


// ============================================================
// DAYCARE — every Friday 8am, Sat–Fri window
// ============================================================
function runDaycareInvoicesForWeek() {
  var today    = new Date();
  var dow      = today.getDay();
  var sinceFri = (dow - 5 + 7) % 7;
  var friday   = new Date(today);
  friday.setDate(today.getDate() - sinceFri);

  var windowStart = new Date(friday);
  windowStart.setDate(friday.getDate() - 6);
  windowStart.setHours(0, 0, 0, 0);
  var windowEnd = new Date(friday);
  windowEnd.setHours(23, 59, 59, 999);

  Logger.log('Daycare window: ' + formatDate(windowStart) + ' to ' + formatDate(windowEnd));

  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  var data    = sheet.getDataRange().getValues();
  var rates   = loadRates();
  var cal     = loadCalendar();
  var clients = {};

  for (var i = 1; i < data.length; i++) {
    var row     = data[i];
    var status  = row[COL.STATUS - 1];
    var service = (row[COL.SERVICE - 1] || '').toString();

    if (status !== CONFIG.STATUS.CONFIRMED) continue;
    if (service.indexOf('Daycare') === -1)  continue;

    var datesRaw = (row[COL.DATES - 1] || '').toString();
    if (!datesRaw) continue;

    var daysInWindow = datesRaw.split(',')
      .map(function(s) { return new Date(s.trim()); })
      .filter(function(d) { return !isNaN(d) && d >= windowStart && d <= windowEnd; });

    if (daysInWindow.length === 0) continue;

    var email = (row[COL.EMAIL - 1] || '').toString();
    if (!clients[email]) {
      clients[email] = {
        name:       row[COL.FIRST_NAME - 1] + ' ' + row[COL.LAST_NAME - 1],
        firstName:  row[COL.FIRST_NAME - 1],
        email:      email,
        phone:      row[COL.PHONE - 1],
        numDogs:    parseInt(row[COL.NUM_DOGS - 1]) || 1,
        dogs:       row[COL.DOGS - 1],
        bookingIds: [],
        days:       [],
      };
    }
    clients[email].bookingIds.push(row[COL.BOOKING_ID - 1]);
    daysInWindow.forEach(function(d) { clients[email].days.push(d); });
  }

  var generated = 0;
  for (var key in clients) {
    try {
      clients[key].days.sort(function(a, b) { return a - b; });
      generateDaycareInvoiceForApproval(clients[key], friday, rates, cal);
      generated++;
      Logger.log('SUCCESS — daycare invoice for: ' + clients[key].name);
    } catch (e) {
      Logger.log('ERROR daycare ' + clients[key].name + ': ' + e.message);
    }
  }
  Logger.log('Daycare done. ' + generated + ' invoice(s) for week ending ' + formatDate(friday));
}

// ── BOARDING INVOICE FOR APPROVAL ────────────────────────────
function generateInvoiceForApproval(row, rates, cal) {
  var booking   = rowToBooking(row);
  var charges   = calculateBoardingCharges(booking, rates, cal);
  var invoiceId = generateInvoiceId();
  var html      = buildHtmlBoardingInvoice(booking, charges, invoiceId);

  logInvoice(invoiceId, booking.id, booking.firstName + ' ' + booking.lastName, booking.service, charges.total);
  saveInvoiceHtml(invoiceId, html);

var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz-zODOKbdFqI_-w5e4qVqBgyPw_-gkno-t4lHnhWYMHwa-JGwtI740hXnrKE8BkfwD/exec';
var sendUrl = SCRIPT_URL + '?action=sendInvoice&invoiceId=' + invoiceId + '&bookingId=' + booking.id;

  var approvalBanner =
    '<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto 16px;">' +
    '<div style="background:#6A9EA5;padding:16px 24px;border-radius:12px;display:flex;justify-content:space-between;align-items:center;">' +
      '<div>' +
        '<div style="font-size:15px;font-weight:600;color:#fff;">&#x1F43E; Invoice Ready for Approval</div>' +
        '<div style="font-size:12px;color:#D6EAEC;margin-top:2px;">Review the invoice below and click Send when ready.</div>' +
      '</div>' +
      '<a href="' + sendUrl + '" style="display:inline-block;background:#27500A;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;white-space:nowrap;margin-left:16px;">Send to Client</a>' +
    '</div></div>';

  GmailApp.sendEmail(
    CONFIG.ADMIN_EMAIL,
    'Approve Invoice \u2014 ' + invoiceId + ' \u2014 ' + booking.firstName + ' ' + booking.lastName,
    'Please view this email in HTML.',
    { htmlBody: approvalBanner + html, name: CONFIG.FROM_NAME }
  );
}

// ── DAYCARE INVOICE FOR APPROVAL ─────────────────────────────
function generateDaycareInvoiceForApproval(client, friday, rates, cal) {
  var charges   = calculateDaycareCharges(client, rates, cal);
  var invoiceId = generateInvoiceId();
  var html      = buildHtmlDaycareInvoice(client, charges, invoiceId, friday);

  logInvoice(invoiceId, client.bookingIds.join(', '), client.name, 'Daycare (weekly)', charges.total);
  saveInvoiceHtml(invoiceId, html);

var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz-zODOKbdFqI_-w5e4qVqBgyPw_-gkno-t4lHnhWYMHwa-JGwtI740hXnrKE8BkfwD/exec';
var sendUrl = SCRIPT_URL + '?action=sendDaycareInvoice&invoiceId=' + invoiceId;

  var approvalBanner =
    '<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto 16px;">' +
    '<div style="background:#6A9EA5;padding:16px 24px;border-radius:12px;display:flex;justify-content:space-between;align-items:center;">' +
      '<div>' +
        '<div style="font-size:15px;font-weight:600;color:#fff;">&#x1F43E; Invoice Ready for Approval</div>' +
        '<div style="font-size:12px;color:#D6EAEC;margin-top:2px;">Review the invoice below and click Send when ready.</div>' +
      '</div>' +
      '<a href="' + sendUrl + '" style="display:inline-block;background:#27500A;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;white-space:nowrap;margin-left:16px;">Send to Client</a>' +
    '</div></div>';

  GmailApp.sendEmail(
    CONFIG.ADMIN_EMAIL,
    'Approve Invoice \u2014 ' + invoiceId + ' \u2014 ' + client.name,
    'Please view this email in HTML.',
    { htmlBody: approvalBanner + html, name: CONFIG.FROM_NAME }
  );
}

// ── SEND BOARDING INVOICE TO CLIENT ──────────────────────────
function sendInvoiceToClient(invoiceId, bookingId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  var data  = sheet.getDataRange().getValues();
  var row   = null;
  for (var i = 1; i < data.length; i++) {
    if (data[i][COL.BOOKING_ID - 1] === bookingId) { row = data[i]; break; }
  }
  if (!row) throw new Error('Booking not found: ' + bookingId);

  var booking = rowToBooking(row);
  var rates   = loadRates();
  var cal     = loadCalendar();
  var charges = calculateBoardingCharges(booking, rates, cal);
  var html    = buildHtmlBoardingInvoice(booking, charges, invoiceId);

  GmailApp.sendEmail(
    booking.email,
    'Your Lucky Puppy Invoice \u2014 ' + invoiceId,
    'Please view this email in an HTML-compatible email client.',
    { htmlBody: html, name: CONFIG.FROM_NAME, replyTo: CONFIG.ADMIN_EMAIL }
  );
  updateInvoiceStatus(invoiceId, CONFIG.INVOICE_STATUS.SENT);
}

// ── SEND DAYCARE INVOICE TO CLIENT ───────────────────────────
function sendDaycareInvoiceToClient(invoiceId) {
  var invSheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.INVOICE_SHEET_NAME);
  var invData    = invSheet.getDataRange().getValues();
  var bookingIds = '';
  for (var i = 1; i < invData.length; i++) {
    if (invData[i][INV_COL.INVOICE_ID - 1] === invoiceId) {
      bookingIds = (invData[i][INV_COL.BOOKING_ID - 1] || '').toString();
      break;
    }
  }
  if (!bookingIds) throw new Error('Invoice not found: ' + invoiceId);

  var firstId = bookingIds.split(',')[0].trim();
  var email   = getEmailForBookingId(firstId);
  if (!email) throw new Error('Client email not found for booking ' + firstId);

  var html = loadInvoiceHtml(invoiceId);
  GmailApp.sendEmail(
    email,
    'Your Lucky Puppy Daycare Invoice \u2014 ' + invoiceId,
    'Please view this email in an HTML-compatible email client.',
    { htmlBody: html, name: CONFIG.FROM_NAME, replyTo: CONFIG.ADMIN_EMAIL }
  );
  updateInvoiceStatus(invoiceId, CONFIG.INVOICE_STATUS.SENT);
}

function getEmailForBookingId(bookingId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][COL.BOOKING_ID - 1] === bookingId) return data[i][COL.EMAIL - 1];
  }
  return '';
}

// ── INVOICES SHEET ───────────────────────────────────────────
function logInvoice(invoiceId, bookingIdOrIds, clientName, service, total) {
  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.INVOICE_SHEET_NAME);
  var today   = new Date();
  var dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + CONFIG.PAYMENT_DUE_DAYS);
  sheet.appendRow([invoiceId, bookingIdOrIds, clientName, service, '', total, today, dueDate, CONFIG.INVOICE_STATUS.UNSENT, '']);
}

function updateInvoiceStatus(invoiceId, newStatus) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.INVOICE_SHEET_NAME);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][INV_COL.INVOICE_ID - 1] === invoiceId) {
      sheet.getRange(i + 1, INV_COL.STATUS).setValue(newStatus);
      if (newStatus === CONFIG.INVOICE_STATUS.PAID) {
        sheet.getRange(i + 1, INV_COL.PAID_DATE).setValue(new Date());
      }
      break;
    }
  }
}

function markOverdueInvoices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.INVOICE_SHEET_NAME);
  var data  = sheet.getDataRange().getValues();
  var today = new Date();
  for (var i = 1; i < data.length; i++) {
    var status  = data[i][INV_COL.STATUS - 1];
    var dueDate = new Date(data[i][INV_COL.DUE_DATE - 1]);
    if (status === CONFIG.INVOICE_STATUS.SENT && dueDate < today) {
      sheet.getRange(i + 1, INV_COL.STATUS).setValue(CONFIG.INVOICE_STATUS.OVERDUE);
    }
  }
}

function generateInvoiceId() {
  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.INVOICE_SHEET_NAME);
  var data    = sheet.getDataRange().getValues();
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var count   = 0;
  for (var i = 1; i < data.length; i++) {
    var id = data[i][INV_COL.INVOICE_ID - 1];
    if (id && id.toString().indexOf('LPINV-' + dateStr) === 0) count++;
  }
  return 'LPINV-' + dateStr + '-' + ('00' + (count + 1)).slice(-3);
}

// ── DRIVE ────────────────────────────────────────────────────
function saveInvoiceHtml(invoiceId, html) {
  DriveApp.getFolderById(CONFIG.INVOICE_FOLDER_ID)
    .createFile(invoiceId + '_invoice.html', html, MimeType.HTML);
}

function loadInvoiceHtml(invoiceId) {
  var folder = DriveApp.getFolderById(CONFIG.INVOICE_FOLDER_ID);
  var files  = folder.getFilesByName(invoiceId + '_invoice.html');
  if (!files.hasNext()) throw new Error('Saved invoice HTML not found for ' + invoiceId);
  return files.next().getBlob().getDataAsString();
}

// ── BOOKING OBJECT FROM ROW ──────────────────────────────────
function rowToBooking(row) {
  return {
    id:        row[COL.BOOKING_ID - 1],
    service:   row[COL.SERVICE - 1],
    firstName: row[COL.FIRST_NAME - 1],
    lastName:  row[COL.LAST_NAME - 1],
    phone:     row[COL.PHONE - 1],
    email:     row[COL.EMAIL - 1],
    numDogs:   parseInt(row[COL.NUM_DOGS - 1]) || 1,
    dogs:      row[COL.DOGS - 1],
    startDate: new Date(row[COL.START_DATE - 1]),
    endDate:   new Date(row[COL.END_DATE - 1]),
    notes:     row[COL.NOTES - 1] || '',
  };
}

// ── HTML BUILDERS ─────────────────────────────────────────────
function lineItem(name, note, amount, border, muted, amtColor) {
  var amtStyle  = muted ? 'font-size:13px;color:#C4BAB0;' : 'font-size:15px;font-weight:600;color:' + (amtColor || '#1A3A3E') + ';white-space:nowrap;';
  var borderCss = border ? 'border-bottom:1px dashed #D6EAEC;' : '';
  return '<tr>' +
    '<td style="padding:9px 0;' + borderCss + 'font-size:14px;color:#1A3A3E;">' + name +
      (note ? '<div style="font-size:11px;color:#7AAAB0;margin-top:2px;">' + note + '</div>' : '') + '</td>' +
    '<td style="padding:9px 0;' + borderCss + 'text-align:right;' + amtStyle + '">' + amount + '</td>' +
  '</tr>';
}

function nightHeader(label, dayType) {
  var badge = dayType === 'Holiday'
    ? '<span style="background:#FEF0EC;color:#A0522D;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;margin-left:8px;">HOLIDAY</span>'
    : dayType === 'Weekend'
    ? '<span style="background:#EAF0FB;color:#1A4A8A;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;margin-left:8px;">WEEKEND</span>'
    : '';
  return '<tr><td colspan="2" style="padding:10px 0 4px;font-size:12px;font-weight:600;color:#6A9EA5;border-top:1px solid #D6EAEC;text-transform:uppercase;letter-spacing:0.5px;">' +
    label + badge + '</td></tr>';
}

function invField(label, value, last) {
  var b = last ? '' : 'border-bottom:1px dashed #D6EAEC;';
  return '<tr><td style="font-size:12px;color:#7AAAB0;padding:7px 0;' + b + '">' + label +
    '</td><td style="font-size:14px;font-weight:600;color:#1A3A3E;text-align:right;padding:7px 0;' + b + '">' + value + '</td></tr>';
}

function groupNightLines(nightLines) {
  var groups  = [];
  var current = null;
  nightLines.forEach(function(night) {
    if (current && current.dayType === night.dayType) {
      current.nights.push(night);
    } else {
      current = { dayType: night.dayType, nights: [night] };
      groups.push(current);
    }
  });
  return groups;
}

function buildHtmlBoardingInvoice(booking, charges, invoiceId) {
  var clientName = booking.firstName + ' ' + booking.lastName;
  var lineRows   = '';
  var groups     = groupNightLines(charges.nightLines);

  groups.forEach(function(group, gIdx) {
    var isLastGroup = (gIdx === groups.length - 1);
    var nightCount  = group.nights.length;
    var firstDate   = group.nights[0].date;
    var endDate     = isLastGroup ? booking.endDate : groups[gIdx + 1].nights[0].date;
    var dateRange   = formatShort(firstDate) + '\u2013' + formatShort(endDate);
    var label       = dateRange + ' (' + nightCount + ' night' + (nightCount > 1 ? 's' : '') + ')';

    lineRows += nightHeader(label, group.dayType);

    var numDogs = group.nights[0].dogLines.length;
    for (var d = 0; d < numDogs; d++) {
      var dog          = group.nights[0].dogLines[d];
      var ratePerNight = dog.rate;
      var groupTotal   = ratePerNight * nightCount;
      var isLastDog    = (d === numDogs - 1);

      lineRows += lineItem(
        dog.dogName,
        dog.rateLabel + ' \u00d7 ' + nightCount + ' night' + (nightCount > 1 ? 's' : '') + ' \u00d7 $' + ratePerNight.toFixed(2),
        '$' + groupTotal.toFixed(2),
        isLastDog && !isLastGroup,
        false,
        group.dayType === 'Holiday' ? '#A0522D' : '#1A3A3E'
      );
    }
  });

  var stayRows =
    invField('Service',  booking.service) +
    invField('Check-in', formatDate(booking.startDate)) +
    invField('Checkout', formatDate(booking.endDate)) +
    invField('Nights',   String(charges.nights)) +
    (booking.transport ? invField('Transport', booking.transport) : '') + 
    invField('Dogs',     String(booking.numDogs), true);

  return invoiceShell(invoiceId, clientName, booking.dogs, booking.phone, booking.email, 'Stay details', stayRows, lineRows, charges.total);
}

function buildHtmlDaycareInvoice(client, charges, invoiceId, friday) {
  var lineRows = '';

  charges.dayLines.forEach(function(day, idx) {
    var isLast    = (idx === charges.dayLines.length - 1);
    var dayTotal  = day.total;
    var rateLabel = day.dogLines[0].rateLabel;
    var noteStr   = rateLabel + (client.numDogs > 1 ? ' \u00d7 ' + client.numDogs + ' dogs' : '');

    lineRows += lineItem(
      formatWeekday(day.date) + ' \u2014 ' + client.dogs,
      noteStr,
      '$' + dayTotal.toFixed(2),
      !isLast,
      false,
      day.dayType === 'Holiday' ? '#A0522D' : '#1A3A3E'
    );
  });

  var windowStart = new Date(friday);
  windowStart.setDate(friday.getDate() - 6);
  var stayRows =
    invField('Service',       'Daycare (weekly)') +
    invField('Week of',       formatShort(windowStart) + ' \u2013 ' + formatShort(friday)) +
    invField('Days attended', String(charges.dayLines.length)) +
    invField('Dogs',          String(client.numDogs), true);

  return invoiceShell(invoiceId, client.name, client.dogs, client.phone, client.email, 'Daycare details', stayRows, lineRows, charges.total);
}

function invoiceShell(invoiceId, clientName, dogList, phone, email, detailsTitle, detailRows, lineRows, total) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
  '<style>' +
  'body{margin:0;padding:12px;background:#f0f0f0;font-family:Arial,sans-serif;}' +
  '.wrap{max-width:620px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1.5px solid #B0CDD1;}' +
  '.two-col{display:table;width:100%;border-bottom:1.5px solid #D6EAEC;}' +
  '.col{display:table-cell;width:50%;padding:20px 24px;vertical-align:top;}' +
  '.col-left{border-right:1.5px solid #D6EAEC;}' +
  '@media only screen and (max-width:480px){' +
  'body{padding:0!important;}.wrap{border-radius:0!important;border-left:none!important;border-right:none!important;}' +
  '.two-col{display:block!important;}.col{display:block!important;width:100%!important;box-sizing:border-box;border-right:none!important;border-bottom:1px solid #D6EAEC;}' +
  '.hdr-left{display:block!important;width:100%!important;}.hdr-right{display:block!important;width:100%!important;text-align:left!important;}' +
  '.id-box{display:block!important;text-align:left!important;margin-top:8px;}' +
  '.footer-left{display:block!important;width:100%!important;}.footer-right{display:block!important;width:100%!important;text-align:left!important;}}' +
  '</style></head><body><div class="wrap">' +

  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#6A9EA5;"><tr>' +
    '<td class="hdr-left" style="padding:26px 24px 22px;vertical-align:top;">' +
      '<div style="font-size:26px;font-weight:600;color:#fff;">&#x1F43E; Lucky Puppy</div>' +
      '<div style="font-size:13px;color:#D6EAEC;margin-top:4px;">Dog Daycare &amp; Boarding &middot; Nyack, NY</div>' +
      '<div style="font-size:15px;color:#fff;margin-top:4px;opacity:0.85;">&ldquo;We are Pack.&rdquo;</div></td>' +
    '<td class="hdr-right" style="padding:26px 24px 22px;text-align:right;vertical-align:top;">' +
      '<div style="font-size:22px;color:#fff;opacity:0.9;">Invoice</div>' +
      '<div class="id-box" style="background:rgba(255,255,255,0.15);border-radius:10px;border:1px solid rgba(255,255,255,0.3);padding:10px 14px;margin-top:6px;display:inline-block;">' +
        '<div style="font-size:10px;font-weight:600;color:#D6EAEC;text-transform:uppercase;letter-spacing:0.8px;">Invoice #</div>' +
        '<div style="font-size:14px;color:#fff;margin-top:2px;">' + invoiceId + '</div>' +
        '<div style="font-size:10px;font-weight:600;color:#D6EAEC;text-transform:uppercase;letter-spacing:0.8px;margin-top:6px;">Date</div>' +
        '<div style="font-size:13px;color:#fff;margin-top:2px;">' + formatDate(new Date()) + '</div></div></td>' +
  '</tr></table>' +
  '<div style="height:5px;background:#27500A;"></div>' +

  '<div class="two-col">' +
    '<div class="col col-left">' +
      '<div style="background:#D6EAEC;color:#2A6870;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding:4px 12px;border-radius:20px;display:inline-block;margin-bottom:14px;">&#x1F436; Client details</div>' +
      '<table width="100%" cellpadding="0" cellspacing="0">' +
        invField('Client name', clientName) + invField('Dog(s)', dogList) + invField('Phone', phone) +
        '<tr><td style="font-size:12px;color:#7AAAB0;padding:7px 0;">Email</td>' +
        '<td style="font-size:12px;font-weight:600;color:#1A3A3E;text-align:right;padding:7px 0;">' + email + '</td></tr>' +
      '</table></div>' +
    '<div class="col">' +
      '<div style="background:#EAF3DE;color:#27500A;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding:4px 12px;border-radius:20px;display:inline-block;margin-bottom:14px;">&#x1F4C5; ' + detailsTitle + '</div>' +
      '<table width="100%" cellpadding="0" cellspacing="0">' + detailRows + '</table></div>' +
  '</div>' +

  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#6A9EA5;"><tr>' +
    '<td style="padding:10px 24px;font-size:13px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;color:#fff;">&#x1F43E; Services &amp; charges</td>' +
    '<td style="padding:10px 24px;font-size:13px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;color:#fff;text-align:right;">Amount</td>' +
  '</tr></table>' +
  '<div style="padding:0 24px;"><table width="100%" cellpadding="0" cellspacing="0">' + lineRows + '</table></div>' +

  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#6A9EA5;"><tr>' +
    '<td style="padding:14px 24px;font-size:18px;color:#D6EAEC;">Total due &#x1F43E;</td>' +
    '<td style="padding:14px 24px;font-size:28px;font-weight:600;color:#fff;text-align:right;">$' + total.toFixed(2) + '</td>' +
  '</tr></table>' +

  '<div style="padding:18px 24px;border-top:1.5px solid #D6EAEC;">' +
    '<div style="background:#EAF3DE;color:#27500A;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding:4px 12px;border-radius:20px;display:inline-block;margin-bottom:14px;">&#x1F4DD; Payment &amp; notes</div>' +
    '<p style="font-size:13px;color:#7AAAB0;line-height:1.65;font-style:italic;margin:0;">Please send payment via Zelle to luckypuppynyack@gmail.com. Include invoice # in memo. Questions? luckypuppynyack@gmail.com</p>' +
  '</div>' +

  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#6A9EA5;"><tr>' +
    '<td class="footer-left" style="padding:14px 24px;font-size:15px;color:#fff;">Thank you for trusting us with your pup! &#x1F436;</td>' +
    '<td class="footer-right" style="padding:14px 24px;text-align:right;font-size:11px;color:#D6EAEC;">luckypuppynyack@gmail.com &middot; luckypuppynyack.com &middot; Nyack, NY</td>' +
  '</tr></table>' +
  '</div></body></html>';
}

// ── TRIGGERS ─────────────────────────────────────────────────
function createInvoiceTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    var fn = t.getHandlerFunction();
    if (fn === 'runInvoicesForToday' || fn === 'markOverdueInvoices' || fn === 'runDaycareInvoicesForWeek') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runInvoicesForToday').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('markOverdueInvoices').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('runDaycareInvoicesForWeek').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(8).create();
  Logger.log('Triggers set: boarding 8am daily, daycare 8am Fridays, overdue 9am daily.');
}

// ── TEST FUNCTIONS ───────────────────────────────────────────
function testInvoiceForBooking() {
  var TEST_BOOKING_ID = 'LP-20260809-306'; // ← change to your booking ID

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  var data  = sheet.getDataRange().getValues();
  var rates = loadRates();
  var cal   = loadCalendar();
  var row   = null;

  for (var i = 1; i < data.length; i++) {
    if (data[i][COL.BOOKING_ID - 1] === TEST_BOOKING_ID) { row = data[i]; break; }
  }
  if (!row) { Logger.log('Booking not found: ' + TEST_BOOKING_ID); return; }

  generateInvoiceForApproval(row, rates, cal);
  Logger.log('Test boarding invoice generated for: ' + TEST_BOOKING_ID);
}

function testDaycareInvoice() {
  var TEST_BOOKING_ID  = 'LP-20260809-838'; // ← change to your daycare booking ID
  var TEST_WEEK_ENDING = '2026-07-25';       // ← Friday of the week to bill

  var friday      = new Date(TEST_WEEK_ENDING);
  var windowStart = new Date(friday);
  windowStart.setDate(friday.getDate() - 6);
  windowStart.setHours(0, 0, 0, 0);
  var windowEnd = new Date(friday);
  windowEnd.setHours(23, 59, 59, 999);

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  var data  = sheet.getDataRange().getValues();
  var rates = loadRates();
  var cal   = loadCalendar();
  var row   = null;

  for (var i = 1; i < data.length; i++) {
    if (data[i][COL.BOOKING_ID - 1] === TEST_BOOKING_ID) { row = data[i]; break; }
  }
  if (!row) { Logger.log('Booking not found: ' + TEST_BOOKING_ID); return; }

  var datesRaw     = (row[COL.DATES - 1] || '').toString();
  var daysInWindow = datesRaw.split(',')
    .map(function(s) { return new Date(s.trim()); })
    .filter(function(d) { return !isNaN(d) && d >= windowStart && d <= windowEnd; });

  if (daysInWindow.length === 0) {
    Logger.log('No daycare days found in window for ' + TEST_BOOKING_ID);
    return;
  }

  var client = {
    name:       row[COL.FIRST_NAME - 1] + ' ' + row[COL.LAST_NAME - 1],
    firstName:  row[COL.FIRST_NAME - 1],
    email:      row[COL.EMAIL - 1],
    phone:      row[COL.PHONE - 1],
    numDogs:    parseInt(row[COL.NUM_DOGS - 1]) || 1,
    dogs:       row[COL.DOGS - 1],
    bookingIds: [TEST_BOOKING_ID],
    days:       daysInWindow.sort(function(a, b) { return a - b; }),
  };

  generateDaycareInvoiceForApproval(client, friday, rates, cal);
  Logger.log('Test daycare invoice generated for: ' + client.name);
}

// ── HELPERS ──────────────────────────────────────────────────
function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}
function daysBetween(start, end) {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}
function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMMM d, yyyy');
}
function formatShort(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMM d');
}
function formatWeekday(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'EEE, MMM d');
}