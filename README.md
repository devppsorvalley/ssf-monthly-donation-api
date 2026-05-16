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
        "contact": "9123456780"
      },
      "totalCount": 12
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
- Use the hosted subscription page URL from this server as the shared donate link.
- Example: `https://your-domain.com/subscription.html`
- From WordPress, link the subscription button to that page.

## Notes
- This project is designed to support a reusable subscription page for multiple donors.
- Donors can enter their own amount on the subscription page, and the backend will create a matching Razorpay subscription plan if needed.
- If you want to use Razorpay Payment Pages directly, the `/api/subscriptions/payment-page` endpoint can create a Razorpay payment page link.
- For a real deployment, set up HTTPS and webhook handling for subscription events.

## Razorpay webhook setup
1. Configure `RAZORPAY_WEBHOOK_SECRET` in your `.env` file.
2. Expose the webhook endpoint from your hosted server:
   - `POST /api/subscriptions/webhook`
3. In the Razorpay dashboard, register the webhook URL and secret.
4. Subscribe to these events at minimum:
   - `subscription.activated`
   - `subscription.charged`
   - `subscription.payment.failed`
   - `subscription.cancelled`

The webhook route validates the `x-razorpay-signature` header and logs subscription success/failure events.
