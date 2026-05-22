# SSF Donation Subscription API

A simple Node.js + Express backend for Razorpay subscription donations, plus a reusable donation page that can be shared with donors.

## Architecture
WordPress Site

↓

Button click

↓

Hosted Node subscription API

↓

Razorpay Subscription API

↓

Redirect donor to Razorpay checkout

## Features
- Create a Razorpay subscription plan
- Create Razorpay subscription links for recurring donations
- Reusable subscription page for multiple donors
- Supports donor-entered custom subscription amount
- Works with WordPress by linking to the hosted subscription page

## Setup
1. Copy `.env.example` to `.env`:

   ```bash
   cp .env.example .env
   ```

2. Fill in your Razorpay credentials:

   ```env
   RAZORPAY_KEY_ID=your_key_id
   RAZORPAY_KEY_SECRET=your_key_secret
   RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
   ADMIN_TOKEN=your_long_random_admin_secret
   ```

3. Optionally set a reusable plan ID after creating a plan once:

   ```env
   RAZORPAY_PLAN_ID=plan_XXXXXXX
   ```

4. Install dependencies:

   ```bash
   npm install
   ```

5. Start the server:

   ```bash
   npm start
   ```

6. Open the subscription page:

   ```text
   http://localhost:4000/
   ```

## API Endpoints

- `POST /api/subscriptions/plan`
  - Creates a Razorpay subscription plan.
  - Admin-only: requires `x-admin-token` to match `ADMIN_TOKEN`.
  - Body example:
    ```json
    {
      "planName": "SSF Monthly Donation",
      "amount": 10000,
      "currency": "INR",
      "interval": "monthly",
      "intervalCount": 1,
      "totalCount": 12,
      "description": "SSF monthly donation plan"
    }
    ```

- `GET /api/subscriptions/config`
  - Returns current plan ID and shared subscription metadata.

- `POST /api/subscriptions/create`
  - Creates a Razorpay subscription for the configured or matching plan.
  - Creates or reuses a Razorpay customer and links that customer to the subscription.
  - Sends donor phone/email to Razorpay as `notify_info` and stores donor details in subscription notes.
  - Validates donor name, email, phone, PAN, donation amount, quantity, and billing cycles on the server.
  - `amount` must be an integer in paise between `MIN_DONATION_AMOUNT` and `MAX_DONATION_AMOUNT`.
  - `quantity` must be `1`; `totalCount` must be between `1` and `MAX_SUBSCRIPTION_TOTAL_COUNT`.
  - Body example:
    ```json
    {
      "planId": "plan_XXXXXXX",
      "customer": {
        "name": "Asha Singh",
        "email": "asha@example.com",
        "contact": "9123456780",
        "pan": "ABCDE1234F"
      },
      "amount": 10000,
      "quantity": 1
    }
    ```
  - Response:
    ```json
    {
      "success": true,
      "subscriptionId": "sub_XXXXXXX",
      "checkoutUrl": "https://rzp.io/...",
      "razorpayKeyId": "rzp_live_XXXXXXX",
      "customerId": "cust_XXXXXXX"
    }
    ```

- `POST /api/subscriptions/verify`
  - Verifies the Razorpay Checkout subscription payment signature after authorization.
  - Fetches the subscription and returns the linked `customerId` once Razorpay has created it.
  - Body example:
    ```json
    {
      "subscriptionId": "sub_XXXXXXX",
      "razorpay_payment_id": "pay_XXXXXXX",
      "razorpay_subscription_id": "sub_XXXXXXX",
      "razorpay_signature": "signature_from_checkout"
    }
    ```
  - Response:
    ```json
    {
      "success": true,
      "subscriptionId": "sub_XXXXXXX",
      "paymentId": "pay_XXXXXXX",
      "customerId": "cust_XXXXXXX",
      "status": "active",
      "sheetSync": {
        "skipped": false
      }
    }
    ```

- `POST /api/subscriptions/payment-page`
  - Attempts to create a reusable Razorpay payment page link for subscription donations.
  - Admin-only: requires `x-admin-token` to match `ADMIN_TOKEN`.
  - Body example:
    ```json
    {
      "title": "SSF Monthly Donation",
      "description": "Support SSF with a recurring donation",
      "amount": 10000,
      "currency": "INR",
      "interval": "monthly",
      "intervalCount": 1,
      "totalCount": 12
    }
    ```

## How to use with WordPress
- Use the WordPress donate form to submit directly to the backend API.
- The subscription UI now runs inside WordPress as a custom HTML block.

## Notes
- This project is designed to support a reusable subscription flow for multiple donors via your WordPress page.
- Donors can enter their own amount on the WordPress form, and the backend will create a matching Razorpay subscription plan if needed.
- Successful subscription authorizations can be appended to Google Sheets when the Google service-account env vars are configured.
- If you want to use Razorpay Payment Pages directly, the admin-only `/api/subscriptions/payment-page` endpoint can create a Razorpay payment page link.
- For a real deployment, set up HTTPS and webhook handling for subscription events.

## Google Sheets sync
The `/api/subscriptions/verify` endpoint can append successful subscription authorizations to a Google Sheet.

1. Create a Google Cloud service account and enable the Google Sheets API for that project.
2. Create or choose a Google Sheet and add a tab named `Donations`.
3. Share the Sheet with the service account email as an editor.
4. Add this header row to `Donations!A:O`:
   ```text
   Recorded At | Subscription ID | Payment ID | Customer ID | Status | Plan ID | Name | Email | Phone | PAN | Amount Paise | Amount INR | Currency | Total Count | Razorpay Created At
   ```
5. Add these environment variables in Render:
   ```env
   GOOGLE_SHEETS_ID=your_google_sheet_id
   GOOGLE_SHEETS_RANGE=Donations!A:O
   GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nyour_private_key\n-----END PRIVATE KEY-----\n"
   ```

The Sheet ID is the long ID in the Google Sheet URL. Keep the private key quoted in Render and preserve `\n` line breaks.

## Elementor integration
To embed the subscription form into your existing donate page with Elementor:

1. Use an `HTML` widget on your Elementor page.
2. Paste the custom form + JS block (below) into the widget.
3. Replace `https://ssf-monthly-donation-api.onrender.com` with your actual API server URL.
4. Save the page and test the form.

The form submits directly to `/api/subscriptions/create`, opens Razorpay Checkout with the returned `subscriptionId`, verifies the successful authorization via `/api/subscriptions/verify`, and redirects the donor back to the donate page with a success or failure message.

### Sample WordPress Elementor Form Code
```html
<div id="messageBox" style="margin-bottom: 20px; padding: 12px; border-radius: 4px; display: none; font-weight: bold; text-align: center; border-left: 4px solid;">
</div>

<form id="donationForm" style="max-width: 500px; margin: 20px auto;">
  <div style="margin-bottom: 15px;">
    <label for="name" style="display: block; margin-bottom: 5px; font-weight: bold;">Name *</label>
    <input type="text" id="name" name="name" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
  </div>

  <div style="margin-bottom: 15px;">
    <label for="email" style="display: block; margin-bottom: 5px; font-weight: bold;">Email *</label>
    <input type="email" id="email" name="email" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
  </div>

  <div style="margin-bottom: 15px;">
    <label for="contact" style="display: block; margin-bottom: 5px; font-weight: bold;">Phone *</label>
    <input type="tel" id="contact" name="contact" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
  </div>

  <div style="margin-bottom: 15px;">
    <label for="pan" style="display: block; margin-bottom: 5px; font-weight: bold;">PAN *</label>
    <input type="text" id="pan" name="pan" placeholder="ABCDE1234F" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
  </div>

  <div style="margin-bottom: 15px;">
    <label for="amount" style="display: block; margin-bottom: 5px; font-weight: bold;">Monthly Donation Amount (₹) *</label>
    <input type="number" id="amount" name="amount" min="100" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
  </div>

  <button id="donationSubmitButton" type="submit" style="width: 100%; padding: 12px; background-color: #eca30c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold;">
    Start Monthly Donation
  </button>
  <p style="margin-top: 12px; color: #333; font-size: 14px;">Razorpay Checkout will open securely to complete the subscription.</p>
</form>

<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  const API_BASE_URL = 'https://ssf-monthly-donation-api.onrender.com';
  const DONATE_PAGE_URL = window.location.origin + window.location.pathname;

  function showDonationMessage(message, type) {
    const messageBox = document.getElementById('messageBox');
    messageBox.textContent = message;
    messageBox.style.backgroundColor = type === 'error' ? '#f8d7da' : '#d4edda';
    messageBox.style.color = type === 'error' ? '#721c24' : '#155724';
    messageBox.style.borderLeftColor = type === 'error' ? '#dc3545' : '#28a745';
    messageBox.style.display = 'block';
  }

  function setSubmitState(isSubmitting) {
    const submitButton = document.getElementById('donationSubmitButton');
    submitButton.disabled = isSubmitting;
    submitButton.textContent = isSubmitting ? 'Processing...' : 'Start Monthly Donation';
  }

  window.addEventListener('load', function() {
    if (sessionStorage.getItem('donationSuccess')) {
      showDonationMessage('✓ Thank you! Your monthly donation subscription has been created successfully.', 'success');
      document.getElementById('donationForm').reset();
      sessionStorage.removeItem('donationSuccess');
    }
    
    if (sessionStorage.getItem('donationError')) {
      const errorMsg = sessionStorage.getItem('donationError');
      showDonationMessage('✗ Error: ' + errorMsg, 'error');
      sessionStorage.removeItem('donationError');
    }
  });

  document.getElementById('donationForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = {
      customer: {
        name: document.getElementById('name').value.trim(),
        email: document.getElementById('email').value.trim().toLowerCase(),
        contact: document.getElementById('contact').value.trim(),
        pan: document.getElementById('pan').value.trim().toUpperCase(),
      },
      amount: Number(document.getElementById('amount').value) * 100,
      quantity: 1,
    };

    setSubmitState(true);

    try {
      const response = await fetch(API_BASE_URL + '/api/subscriptions/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok || !data.success || !data.subscriptionId || !data.razorpayKeyId) {
        throw new Error(data.error || 'Failed to create subscription');
      }

      const razorpay = new Razorpay({
        key: data.razorpayKeyId,
        subscription_id: data.subscriptionId,
        name: 'SSF',
        description: 'Monthly Donation',
        prefill: {
          name: formData.customer.name,
          email: formData.customer.email,
          contact: formData.customer.contact,
        },
        notes: {
          donor_pan: formData.customer.pan,
          donation_amount: String(formData.amount),
        },
        theme: {
          color: '#eca30c',
        },
        modal: {
          ondismiss: function() {
            setSubmitState(false);
            showDonationMessage('✗ Payment was cancelled before completion.', 'error');
          },
        },
        handler: async function(paymentResponse) {
          try {
            const verifyResponse = await fetch(API_BASE_URL + '/api/subscriptions/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                subscriptionId: data.subscriptionId,
                razorpay_payment_id: paymentResponse.razorpay_payment_id,
                razorpay_subscription_id: paymentResponse.razorpay_subscription_id,
                razorpay_signature: paymentResponse.razorpay_signature,
              }),
            });

            const verifyData = await verifyResponse.json();
            if (!verifyResponse.ok || !verifyData.success) {
              throw new Error(verifyData.error || 'Payment verification failed');
            }

            sessionStorage.setItem('donationSuccess', 'true');
            window.location.href = DONATE_PAGE_URL;
          } catch (verifyError) {
            sessionStorage.setItem('donationError', verifyError.message);
            window.location.href = DONATE_PAGE_URL;
          }
        },
      });

      razorpay.on('payment.failed', function(response) {
        const description = response.error && response.error.description
          ? response.error.description
          : 'Payment failed or was cancelled.';
        sessionStorage.setItem('donationError', description);
        window.location.href = DONATE_PAGE_URL;
      });

      razorpay.open();
    } catch (error) {
      console.error('Form submission error:', error);
      showDonationMessage('✗ Error: ' + error.message, 'error');
      setSubmitState(false);
    }
  });
</script>
```

## Render deployment
Render.com supports automatic deployment from GitHub with free HTTPS.

1. Sign up at https://render.com and connect your GitHub account.
2. Create a new Web Service and choose "Deploy from GitHub".
3. Select the `devppsorvalley/ssf-monthly-donation-api` repository.
4. Choose the `main` branch and set it to auto-deploy on each push.
5. Render will detect Node.js from `package.json`.
6. Add the following environment variables in Render project settings:
   - `RAZORPAY_KEY_ID` - Your Razorpay API key ID
   - `RAZORPAY_KEY_SECRET` - Your Razorpay API key secret
   - `RAZORPAY_WEBHOOK_SECRET` - Webhook secret from Razorpay dashboard
   - `ADMIN_TOKEN` - Secret token for protecting admin endpoints
   - `SUBSCRIPTION_AMOUNT` - Default donation amount in paise (e.g., 10000 = ₹100)
   - `SUBSCRIPTION_CURRENCY` - Currency code (default: INR)
   - `SUBSCRIPTION_INTERVAL` - Billing interval (default: monthly)
   - `SUBSCRIPTION_INTERVAL_COUNT` - Number of intervals (default: 1)
   - `MIN_DONATION_AMOUNT` - Minimum accepted donation amount in paise (default: 10000)
   - `MAX_DONATION_AMOUNT` - Maximum accepted donation amount in paise (default: 10000000)
   - `MAX_SUBSCRIPTION_TOTAL_COUNT` - Maximum billing cycles accepted from public requests (default: 120)
   - Optional: `GOOGLE_SHEETS_ID` - Google Sheet ID for donation sync
   - Optional: `GOOGLE_SHEETS_RANGE` - Sheet range for appending rows (default: `Donations!A:O`)
   - Optional: `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Google service account email shared on the Sheet
   - Optional: `GOOGLE_PRIVATE_KEY` - Google service account private key
   - Optional: `RAZORPAY_PLAN_ID` - Reuse an existing Razorpay plan ID
7. If Render asks for a start command, use:
   ```bash
   npm start
   ```
8. After deployment, Render will provide a public HTTPS URL (e.g., `https://ssf-monthly-donation-api.onrender.com`).
9. Use this URL in your WordPress form as the API endpoint.
10. Register the webhook URL in Razorpay dashboard as `https://ssf-monthly-donation-api.onrender.com/api/subscriptions/webhook`.

Render automatically enables SSL for your app URL, so your hosted API is served securely.

## Razorpay webhook setup
1. Configure `RAZORPAY_WEBHOOK_SECRET` in your `.env` file.
2. The webhook endpoint `/api/subscriptions/webhook` is automatically configured to:
   - Verify the `x-razorpay-signature` header using HMAC-SHA256
   - Use the raw request body for signature validation (via middleware in `server.js`)
   - Log subscription events for audit purposes
3. In the Razorpay dashboard, register the webhook URL with your secret:
   - Webhook URL: `https://ssf-monthly-donation-api.onrender.com/api/subscriptions/webhook`
   - Webhook Secret: Your `RAZORPAY_WEBHOOK_SECRET` value
4. Subscribe to these events at minimum:
   - `subscription.activated`
   - `subscription.charged`
   - `subscription.payment.failed`
   - `subscription.cancelled`

The webhook route validates the Razorpay signature and logs subscription success/failure events to your server logs.
