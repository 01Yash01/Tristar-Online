# Order Status Checker Setup Guide

This guide walks you through setting up the **Google Sheet**, **Google Apps Script**, and connecting it to your Shopify storefront page for the 2-field Order Status tool.

---

## 1. Google Sheet Setup

1. Go to [Google Sheets](https://sheets.new) and create a new spreadsheet.
2. Name the spreadsheet: **Tristar Order Status** (or any name you prefer).
3. In **Row 1**, add the following headers:
   - Column A: `Order Number`
   - Column B: `Email Address`
   - Column C: `Status Message` (Optional: used to display custom status like "Shipped" or "Processing")
4. Enter your valid orders below Row 1, for example:
   - Row 2, Col A: `12345`
   - Row 2, Col B: `test@example.com`
   - Row 2, Col C: `Your order has shipped!`

---

## 2. Google Apps Script Setup

1. In your Google Sheet, click **Extensions** &rarr; **Apps Script**.
2. Delete any default code in `Code.gs` and paste the following script:

```javascript
function doGet(e) {
  try {
    var order = (e && e.parameter && e.parameter.order) ? e.parameter.order : '';
    var email = (e && e.parameter && e.parameter.email) ? e.parameter.email : '';
    
    order = order.toString().trim().toUpperCase();
    email = email.toString().trim().toLowerCase();

    if (!order || !email) {
      return respondJson({
        found: false,
        message: 'Missing Order Number or Email Address.'
      });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = sheet.getDataRange().getValues();

    var found = false;
    var customMessage = '';

    // Search rows (skipping header in row 0)
    for (var i = 1; i < data.length; i++) {
      var cellOrder = data[i][0] ? data[i][0].toString().trim().toUpperCase() : '';
      var cellEmail = data[i][1] ? data[i][1].toString().trim().toLowerCase() : '';
      
      if (cellOrder === order && cellEmail === email) {
        found = true;
        // Optionally get custom status from Column C
        customMessage = data[i][2] ? data[i][2].toString().trim() : 'Your order is currently being processed.';
        break;
      }
    }

    return respondJson({
      found: found,
      order: order,
      status: found ? customMessage : '',
      message: found ? 'Thank you for shopping with us.' : 'Order not found matching that number and email.'
    });

  } catch (err) {
    return respondJson({
      found: false,
      error: err.toString(),
      message: 'Error verifying order status.'
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
   - **Description:** `Order Status Checker v1`
   - **Execute as:** `Me (your email)`
   - **Who has access:** `Anyone` *(Important: Must be "Anyone" so storefront visitors can query it)*
4. Click **Deploy**.
5. If prompted, click **Authorize access**, select your Google account, and grant permissions.
6. Copy the **Web app URL** (it looks like: `https://script.google.com/macros/s/.../exec`).

---

## 4. Shopify Theme & Page Setup

### Step A: Create the Page in Shopify Admin
1. In your Shopify Admin, go to **Online Store** &rarr; **Pages**.
2. Click **Add page**.
3. Title: **Check Order Status** (URL will automatically be `/pages/check-order-status` or `/pages/order-status`).
4. On the right sidebar, under **Theme template**, select **order-status**.
5. Click **Save**.

### Step B: Connect the Apps Script URL
1. In Shopify Admin, go to **Online Store** &rarr; **Themes**.
2. Click **Customize** on your theme.
3. In the top page selector dropdown, select **Pages** &rarr; **order-status**.
4. In the left panel, click on the **Order Status Checker** section.
5. In the **Apps Script Web App URL** field, paste your copied Web app URL.
6. Click **Save**.

---

## 5. Testing

1. Open your new page in your browser.
2. Enter your test order and email &rarr; click **Check Status** &rarr; displays your success message.
3. Enter an unknown order &rarr; displays **Order Not Found**.
