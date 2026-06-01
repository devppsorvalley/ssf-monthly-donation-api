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
  - Donor-visible field validation is handled in the WordPress form.
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

- `POST /api/subscriptions/change`
  - Finds the donor's latest matching subscription by email or phone and pauses, resumes, or cancels it.
  - Cancels are scheduled for the end of the current billing cycle by default.
  - This is a public self-service endpoint; add OTP/email verification if stronger donor authentication is required.
  - Body example:
    ```json
    {
      "email": "asha@example.com",
      "action": "cancel"
    }
    ```
  - Supported actions:
    ```text
    pause, resume, cancel
    ```
  - Response:
    ```json
    {
      "success": true,
      "action": "cancel",
      "subscriptionId": "sub_XXXXXXX",
      "status": "active",
      "customerId": "cust_XXXXXXX",
      "message": "Subscription cancellation has been scheduled for the end of the current billing cycle."
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

The form validates donor inputs in the browser, submits directly to `/api/subscriptions/create`, opens Razorpay Checkout with the returned `subscriptionId`, verifies the successful authorization via `/api/subscriptions/verify`, and redirects the donor to `/donationresult/` with a success or failure message.

### Sample WordPress Elementor Form Code
```html
<style>
  .ssf-field-error {
    display: none;
    margin-top: 6px;
    padding: 8px 10px;
    border-left: 4px solid #dc3545;
    border-radius: 4px;
    background: #f8d7da;
    color: #721c24;
    font-size: 13px;
    font-weight: 600;
  }

  .ssf-input-error {
    border-color: #dc3545 !important;
    background: #fff8f8;
  }
</style>

<div id="messageBox" style="margin-bottom: 20px; padding: 12px; border-radius: 4px; display: none; font-weight: bold; text-align: center; border-left: 4px solid;"></div>

<form id="donationForm" novalidate style="max-width: 500px; margin: 20px auto;">
  <div style="margin-bottom: 15px;">
    <label for="name" style="display: block; margin-bottom: 5px; font-weight: bold;">Name *</label>
    <input type="text" id="name" name="name" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
    <div id="nameError" class="ssf-field-error"></div>
  </div>

  <div style="margin-bottom: 15px;">
    <label for="email" style="display: block; margin-bottom: 5px; font-weight: bold;">Email *</label>
    <input type="email" id="email" name="email" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
    <div id="emailError" class="ssf-field-error"></div>
  </div>

  <div style="margin-bottom: 15px;">
    <label for="contact" style="display: block; margin-bottom: 5px; font-weight: bold;">Phone *</label>
    <input type="tel" id="contact" name="contact" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
    <div id="contactError" class="ssf-field-error"></div>
  </div>

  <div style="margin-bottom: 15px;">
    <label for="pan" style="display: block; margin-bottom: 5px; font-weight: bold;">PAN *</label>
    <input type="text" id="pan" name="pan" placeholder="ABCDE1234F" maxlength="10" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
    <div id="panError" class="ssf-field-error"></div>
  </div>

  <div style="margin-bottom: 15px;">
    <label for="amount" style="display: block; margin-bottom: 5px; font-weight: bold;">Monthly Donation Amount (₹) *</label>
    <input type="number" id="amount" name="amount" min="100" step="1" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
    <div id="amountError" class="ssf-field-error"></div>
  </div>

  <button id="donationSubmitButton" type="submit" style="width: 100%; padding: 12px; background-color: #eca30c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold;">
    Start Monthly Donation
  </button>
  <p style="margin-top: 12px; color: #333; font-size: 14px;">Razorpay Checkout will open securely to complete the subscription.</p>
  <p style="margin-top: 12px; color: #333; font-size: 14px;">You can pause, resume, and cancel your subscription at anytime by clicking <a href="https://seemantsewafoundation.org/pause-resume-or-cancel-monthly-subscription">here</a>.</p>
</form>

<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  const API_BASE_URL = 'https://ssf-monthly-donation-api.onrender.com';
  const DONATION_RESULT_PAGE_URL = window.location.origin + '/donationresult/';

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

  function setFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    const errorBox = document.getElementById(fieldId + 'Error');
    field.classList.add('ssf-input-error');
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  function clearFieldError(fieldId) {
    const field = document.getElementById(fieldId);
    const errorBox = document.getElementById(fieldId + 'Error');
    field.classList.remove('ssf-input-error');
    errorBox.textContent = '';
    errorBox.style.display = 'none';
  }

  function clearAllFieldErrors() {
    ['name', 'email', 'contact', 'pan', 'amount'].forEach(clearFieldError);
    document.getElementById('messageBox').style.display = 'none';
  }

  function validateDonationForm() {
    clearAllFieldErrors();

    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const contact = document.getElementById('contact').value.trim();
    const pan = document.getElementById('pan').value.trim().toUpperCase();
    const amountValue = document.getElementById('amount').value.trim();
    const amount = Number(amountValue);
    let isValid = true;

    if (!name) {
      setFieldError('name', 'Please enter your full name.');
      isValid = false;
    } else if (name.length > 100) {
      setFieldError('name', 'Name must be 100 characters or fewer.');
      isValid = false;
    }

    if (!email) {
      setFieldError('email', 'Please enter your email address.');
      isValid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError('email', 'Please enter a valid email address.');
      isValid = false;
    }

    if (!contact) {
      setFieldError('contact', 'Please enter your phone number.');
      isValid = false;
    } else if (!/^\+?[0-9]{7,15}$/.test(contact)) {
      setFieldError('contact', 'Please enter a valid phone number using digits only.');
      isValid = false;
    }

    if (!pan) {
      setFieldError('pan', 'Please enter your PAN.');
      isValid = false;
    } else if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      setFieldError('pan', 'Please enter a valid PAN, for example ABCDE1234F.');
      isValid = false;
    }

    if (!amountValue) {
      setFieldError('amount', 'Please enter a monthly donation amount.');
      isValid = false;
    } else if (!Number.isInteger(amount) || amount < 100) {
      setFieldError('amount', 'Please enter a whole amount of ₹100 or more.');
      isValid = false;
    }

    return isValid;
  }

  function redirectToDonationResult(status, message, type) {
    sessionStorage.setItem('donationResult', JSON.stringify({
      status,
      message,
      type,
    }));
    window.location.href = DONATION_RESULT_PAGE_URL;
  }

  document.getElementById('donationForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validateDonationForm()) {
      showDonationMessage('✗ Please correct the highlighted fields.', 'error');
      return;
    }

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

      let checkoutCompleted = false;
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
            if (checkoutCompleted) {
              return;
            }
            setSubmitState(false);
            redirectToDonationResult('failure', 'Payment was cancelled before completion.', 'monthly');
          },
        },
        handler: async function(paymentResponse) {
          checkoutCompleted = true;
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

            document.getElementById('donationForm').reset();
            redirectToDonationResult('success', 'Thank you! Your monthly donation subscription has been created successfully.', 'monthly');
          } catch (verifyError) {
            redirectToDonationResult('failure', verifyError.message, 'monthly');
          }
        },
      });

      razorpay.on('payment.failed', function(response) {
        checkoutCompleted = true;
        const description = response.error && response.error.description
          ? response.error.description
          : 'Payment failed or was cancelled.';
        redirectToDonationResult('failure', description, 'monthly');
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

## Donation result page
Create a WordPress page with slug `donationresult`, add an Elementor `HTML` widget, and paste this block.

Monthly subscription code above writes the result into `sessionStorage` before redirecting here. One-time donation code can use the same approach, or redirect to this page with query parameters such as:

```text
/donationresult/?status=success&type=one-time&message=Thank%20you%20for%20your%20donation
/donationresult/?status=failure&type=one-time&message=Payment%20failed
```

```html
<div id="donationResultBox" style="max-width: 560px; margin: 30px auto; padding: 24px; border-radius: 6px; text-align: center; border-left: 5px solid; display: none;">
  <h2 id="donationResultTitle" style="margin: 0 0 12px; font-size: 24px;"></h2>
  <p id="donationResultMessage" style="margin: 0 0 18px; font-size: 16px;"></p>
  <a id="donationRetryLink" href="/donate/" style="display: none; padding: 11px 18px; background: #eca30c; color: #fff; text-decoration: none; border-radius: 4px; font-weight: bold;">Retry Donation</a>
</div>

<script>
  const DONATION_PAGE_URL = '/donate/';

  function getDonationResult() {
    const storedResult = sessionStorage.getItem('donationResult');
    if (storedResult) {
      sessionStorage.removeItem('donationResult');
      try {
        return JSON.parse(storedResult);
      } catch (error) {
        return null;
      }
    }

    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    if (!status) {
      return null;
    }

    return {
      status,
      type: params.get('type') || 'donation',
      message: params.get('message') || '',
    };
  }

  window.addEventListener('load', function() {
    const result = getDonationResult();
    const box = document.getElementById('donationResultBox');
    const title = document.getElementById('donationResultTitle');
    const message = document.getElementById('donationResultMessage');
    const retryLink = document.getElementById('donationRetryLink');

    if (!result) {
      title.textContent = 'Donation Status';
      message.textContent = 'No recent donation result was found.';
      box.style.backgroundColor = '#fff3cd';
      box.style.color = '#664d03';
      box.style.borderLeftColor = '#ffc107';
      retryLink.style.display = 'inline-block';
      box.style.display = 'block';
      return;
    }

    if (result.status === 'success') {
      title.textContent = 'Donation Successful';
      message.textContent = result.message || 'Thank you. Your donation was completed successfully.';
      box.style.backgroundColor = '#d4edda';
      box.style.color = '#155724';
      box.style.borderLeftColor = '#28a745';
      retryLink.style.display = 'none';
    } else {
      title.textContent = 'Donation Failed';
      message.textContent = result.message || 'The donation could not be completed. Please try again.';
      box.style.backgroundColor = '#f8d7da';
      box.style.color = '#721c24';
      box.style.borderLeftColor = '#dc3545';
      retryLink.href = DONATION_PAGE_URL;
      retryLink.style.display = 'inline-block';
    }

    box.style.display = 'block';
  });
</script>
```

## Change subscription page
Create a WordPress page with slug `changesubscription`, add an Elementor `HTML` widget, and paste this block.

```html
<div id="subscriptionChangeMessage" style="margin-bottom: 20px; padding: 12px; border-radius: 4px; display: none; font-weight: bold; text-align: center; border-left: 4px solid;"></div>

<form id="subscriptionChangeForm" style="max-width: 500px; margin: 20px auto;">
  <div style="margin-bottom: 15px;">
    <label for="changeEmail" style="display: block; margin-bottom: 5px; font-weight: bold;">Email</label>
    <input type="email" id="changeEmail" name="email" placeholder="you@example.com" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
  </div>

  <div style="margin-bottom: 15px;">
    <label for="changePhone" style="display: block; margin-bottom: 5px; font-weight: bold;">Phone</label>
    <input type="tel" id="changePhone" name="phone" placeholder="9123456780" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
  </div>

  <div style="margin-bottom: 15px;">
    <label for="changeAction" style="display: block; margin-bottom: 5px; font-weight: bold;">Action *</label>
    <select id="changeAction" name="action" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      <option value="">Select an action</option>
      <option value="pause">Pause subscription</option>
      <option value="resume">Resume subscription</option>
      <option value="cancel">Cancel at end of current billing cycle</option>
    </select>
  </div>

  <button id="subscriptionChangeButton" type="submit" style="width: 100%; padding: 12px; background-color: #eca30c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold;">
    Submit Request
  </button>

  <p style="margin-top: 12px; color: #333; font-size: 14px;">Enter either the email or phone number used when starting the monthly donation.</p>
</form>

<script>
  const CHANGE_API_BASE_URL = 'https://ssf-monthly-donation-api.onrender.com';

  function showSubscriptionChangeMessage(message, type) {
    const messageBox = document.getElementById('subscriptionChangeMessage');
    messageBox.textContent = message;
    messageBox.style.backgroundColor = type === 'error' ? '#f8d7da' : '#d4edda';
    messageBox.style.color = type === 'error' ? '#721c24' : '#155724';
    messageBox.style.borderLeftColor = type === 'error' ? '#dc3545' : '#28a745';
    messageBox.style.display = 'block';
  }

  function setSubscriptionChangeState(isSubmitting) {
    const button = document.getElementById('subscriptionChangeButton');
    button.disabled = isSubmitting;
    button.textContent = isSubmitting ? 'Submitting...' : 'Submit Request';
  }

  document.getElementById('subscriptionChangeForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const email = document.getElementById('changeEmail').value.trim().toLowerCase();
    const phone = document.getElementById('changePhone').value.trim();
    const action = document.getElementById('changeAction').value;

    if (!email && !phone) {
      showSubscriptionChangeMessage('✗ Please enter either email or phone.', 'error');
      return;
    }

    setSubscriptionChangeState(true);

    try {
      const response = await fetch(CHANGE_API_BASE_URL + '/api/subscriptions/change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          phone,
          action,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to update subscription.');
      }

      showSubscriptionChangeMessage('✓ ' + data.message, 'success');
      document.getElementById('subscriptionChangeForm').reset();
    } catch (error) {
      showSubscriptionChangeMessage('✗ Error: ' + error.message, 'error');
    } finally {
      setSubscriptionChangeState(false);
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
