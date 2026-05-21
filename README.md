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
- Create customers and subscriptions for recurring donations
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
  - Creates a Razorpay customer and subscription for the configured plan.
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
      "checkoutUrl": "https://rzp.io/..."
    }
    ```

- `POST /api/subscriptions/payment-page`
  - Attempts to create a reusable Razorpay payment page link for subscription donations.
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
- If you want to use Razorpay Payment Pages directly, the `/api/subscriptions/payment-page` endpoint can create a Razorpay payment page link.
- For a real deployment, set up HTTPS and webhook handling for subscription events.

## Elementor integration
To embed the subscription form into your existing donate page with Elementor:

1. Use an `HTML` widget on your Elementor page.
2. Paste the custom form + JS block (below) into the widget.
3. Replace `https://ssf-monthly-donation-api.onrender.com` with your actual API server URL.
4. Save the page and test the form.

The form submits directly to `/api/subscriptions/create`, receives the checkout URL, and redirects the donor to Razorpay checkout.

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

  <button type="submit" style="width: 100%; padding: 12px; background-color: #eca30c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold;">
    Start Monthly Donation
  </button>
  <p style="margin-top: 12px; color: #333; font-size: 14px;">You will be redirected to Razorpay to complete the subscription securely.</p>
</form>

<script>
  // Show success/failure message on page load if returning from checkout
  window.addEventListener('load', function() {
    const messageBox = document.getElementById('messageBox');
    
    if (sessionStorage.getItem('donationSuccess')) {
      messageBox.textContent = '✓ Thank you! Your subscription has been created successfully.';
      messageBox.style.backgroundColor = '#d4edda';
      messageBox.style.color = '#155724';
      messageBox.style.borderLeftColor = '#28a745';
      messageBox.style.display = 'block';
      document.getElementById('donationForm').reset();
      sessionStorage.removeItem('donationSuccess');
      setTimeout(() => {
        messageBox.style.display = 'none';
      }, 5000);
    }
    
    if (sessionStorage.getItem('donationError')) {
      const errorMsg = sessionStorage.getItem('donationError');
      messageBox.textContent = '✗ Error: ' + errorMsg;
      messageBox.style.backgroundColor = '#f8d7da';
      messageBox.style.color = '#721c24';
      messageBox.style.borderLeftColor = '#dc3545';
      messageBox.style.display = 'block';
      sessionStorage.removeItem('donationError');
      setTimeout(() => {
        messageBox.style.display = 'none';
      }, 5000);
    }
  });

  document.getElementById('donationForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = {
      customer: {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        contact: document.getElementById('contact').value,
        pan: document.getElementById('pan').value || null,
      },
      amount: parseInt(document.getElementById('amount').value) * 100,
      quantity: 1,
    };

    try {
      const response = await fetch('https://ssf-monthly-donation-api.onrender.com/api/subscriptions/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (data.success && data.checkoutUrl) {
        // Store success flag and redirect to Razorpay checkout
        sessionStorage.setItem('donationSuccess', 'true');
        window.location.href = data.checkoutUrl;
      } else {
        const messageBox = document.getElementById('messageBox');
        messageBox.textContent = '✗ Error: ' + (data.error || 'Failed to create subscription');
        messageBox.style.backgroundColor = '#f8d7da';
        messageBox.style.color = '#721c24';
        messageBox.style.borderLeftColor = '#dc3545';
        messageBox.style.display = 'block';
      }
    } catch (error) {
      console.error('Form submission error:', error);
      const messageBox = document.getElementById('messageBox');
      messageBox.textContent = '✗ An error occurred. Please try again.';
      messageBox.style.backgroundColor = '#f8d7da';
      messageBox.style.color = '#721c24';
      messageBox.style.borderLeftColor = '#dc3545';
      messageBox.style.display = 'block';
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
   - `ADMIN_TOKEN` - Secret token for protecting the `/plan` endpoint (optional)
   - `SUBSCRIPTION_AMOUNT` - Default donation amount in paise (e.g., 10000 = ₹100)
   - `SUBSCRIPTION_CURRENCY` - Currency code (default: INR)
   - `SUBSCRIPTION_INTERVAL` - Billing interval (default: monthly)
   - `SUBSCRIPTION_INTERVAL_COUNT` - Number of intervals (default: 1)
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
