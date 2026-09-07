# Invoice Availability Checker Setup Guide

This guide walks you through setting up the **Google Sheet**, **Google Apps Script**, and connecting it to your Shopify storefront page.

---

## 1. Google Sheet Setup

1. Go to [Google Sheets](https://sheets.new) and create a new spreadsheet.
2. Name the spreadsheet: **Tristar Invoices** (or any name you prefer).
3. In **Column A** (Row 1), add the header: `Invoice Number`.
4. Enter your valid invoice numbers below Row 1 (one per row), for example:
   - Row 2: `INV-10001`
   - Row 3: `INV-10002`
   - Row 4: `INV-10003`
   - Row 5: `INV-10004`

---

## 2. Google Apps Script Setup

1. In your Google Sheet, click **Extensions** &rarr; **Apps Script**.
2. Delete any default code in `Code.gs` and paste the following script:

```javascript
function doGet(e) {
  try {
    var invoice = (e && e.parameter && e.parameter.invoice) ? e.parameter.invoice : '';
    invoice = invoice.toString().trim().toUpperCase();

    if (!invoice) {
      return respondJson({
        found: false,
        message: 'No invoice number provided.'
      });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = sheet.getDataRange().getValues();

    var found = false;

    // Search Column A (starting from row 2 to skip header)
    for (var i = 1; i < data.length; i++) {
      var cellVal = data[i][0] ? data[i][0].toString().trim().toUpperCase() : '';
      if (cellVal === invoice) {
        found = true;
        break;
      }
    }

    return respondJson({
      found: found,
      invoice: invoice,
      message: found ? 'Invoice is verified and available.' : 'Invoice not found in our records.'
    });

  } catch (err) {
    return respondJson({
      found: false,
      error: err.toString(),
      message: 'Error verifying invoice.'
    });
  }
}

function respondJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. Click the **Save** icon (disk icon).

---

## 3. Deploy as Web App

1. In the top-right corner of the Apps Script editor, click **Deploy** &rarr; **New deployment**.
2. Click the gear icon (**Select type**) &rarr; select **Web app**.
3. Fill in the deployment details:
   - **Description:** `Invoice Checker v1`
   - **Execute as:** `Me (your email)`
   - **Who has access:** `Anyone` *(Important: Must be "Anyone" so Shopify storefront visitors can query it)*
4. Click **Deploy**.
5. If prompted, click **Authorize access**, select your Google account, and grant permissions.
6. Copy the **Web app URL** (it looks like: `https://script.google.com/macros/s/.../exec`).

---

## 4. Shopify Theme & Page Setup

### Step A: Create the Page in Shopify Admin
1. In your Shopify Admin, go to **Online Store** &rarr; **Pages**.
2. Click **Add page**.
3. Title: **Check Invoice** (URL will automatically be `/pages/check-invoice`).
4. On the right sidebar, under **Theme template**, select **check-invoice**.
5. Click **Save**.

### Step B: Connect the Google Apps Script URL
1. In Shopify Admin, go to **Online Store** &rarr; **Themes**.
2. Click **Customize** on your theme.
3. In the top page selector dropdown, select **Pages** &rarr; **check-invoice**.
4. In the left panel, click on the **Invoice Checker** section.
5. In the **Google Apps Script Web App URL** field, paste your copied Web app URL.
6. Click **Save**.

---

## 5. Testing

1. Open `https://your-store.myshopify.com/pages/check-invoice` in your browser.
2. Enter `INV-10001` &rarr; click **Check Invoice** &rarr; displays **Invoice Available**.
3. Enter an unknown invoice like `INV-99999` &rarr; displays **Invoice Not Available**.
