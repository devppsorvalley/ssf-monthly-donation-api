const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const getRazorpayClient = require('../razorpayClient');
const router = express.Router();

const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
  RAZORPAY_PLAN_ID,
  SUBSCRIPTION_AMOUNT,
  SUBSCRIPTION_CURRENCY,
  SUBSCRIPTION_INTERVAL,
  SUBSCRIPTION_INTERVAL_COUNT,
  SUBSCRIPTION_TOTAL_COUNT,
  SUBSCRIPTION_DESCRIPTION,
} = process.env;

async function findExistingPlan(razorpay, amount, currency, interval, intervalCount) {
  const response = await razorpay.plans.all({ count: 100, skip: 0 });
  const plans = Array.isArray(response.items) ? response.items : response;

  if (!Array.isArray(plans)) {
    return null;
  }

  return plans.find((plan) => {
    const item = plan.item || {};
    return Number(item.amount) === Number(amount)
      && String(item.currency || '').toUpperCase() === String(currency || '').toUpperCase()
      && String(plan.period || '').toLowerCase() === String(interval || '').toLowerCase()
      && Number(plan.interval) === Number(intervalCount);
  }) || null;
}

async function getPlanIdForAmount({ requestedAmount, planId, defaultAmount, currency, interval, intervalCount, totalCount, customer }) {
  const razorpay = getRazorpayClient();

  if (planId && Number(requestedAmount) === Number(defaultAmount)) {
    try {
      const plan = await razorpay.plans.fetch(planId);
      const item = plan.item || {};
      if (
        Number(item.amount) === Number(requestedAmount) &&
        String(item.currency || '').toUpperCase() === String(currency || '').toUpperCase() &&
        String(plan.period || '').toLowerCase() === String(interval || '').toLowerCase() &&
        Number(plan.interval) === Number(intervalCount)
      ) {
        return planId;
      }
    } catch (err) {
      console.warn('Configured planId is invalid or missing, creating/finding a matching plan', err.message);
    }
  }

  const existingPlan = await findExistingPlan(razorpay, requestedAmount, currency, interval, intervalCount);
  if (existingPlan) {
    return existingPlan.id;
  }

  const plan = await razorpay.plans.create({
    period: interval,
    interval: intervalCount,
    item: {
      name: 'SSF Donation',
      amount: requestedAmount,
      currency,
      description: SUBSCRIPTION_DESCRIPTION || 'SSF monthly donation plan',
    },
    notes: {
      donor_pan: customer.pan,
      donor_email: customer.email,
    },
    total_count: totalCount,
  });

  return plan.id;
}

// Create a reusable plan for subscriptions.
// Use this once, then save the returned plan_id in RAZORPAY_PLAN_ID.
router.post('/plan', async (req, res, next) => {
  try {
    const {
      planName = 'SSF Monthly Donation 500',
      amount = Number(SUBSCRIPTION_AMOUNT) || 500,
      currency = SUBSCRIPTION_CURRENCY || 'INR',
      interval = SUBSCRIPTION_INTERVAL || 'monthly',
      intervalCount = Number(SUBSCRIPTION_INTERVAL_COUNT) || 1,
      totalCount = Number(SUBSCRIPTION_TOTAL_COUNT) || 24,
      description = SUBSCRIPTION_DESCRIPTION || 'SSF monthly donation plan 500',
      notes = {},
    } = req.body;

    const razorpay = getRazorpayClient();
    const plan = await razorpay.plans.create({
      period: interval,
      interval: intervalCount,
      item: {
        name: planName,
        amount,
        currency,
        description,
      },
      notes,
      total_count: totalCount,
    });

    res.json({ plan });
  } catch (error) {
    next(error);
  }
});

// Create (or return existing) reusable configuration details.
router.get('/config', (req, res) => {
  res.json({
    planId: RAZORPAY_PLAN_ID || null,
    amount: Number(SUBSCRIPTION_AMOUNT) || 10000,
    currency: SUBSCRIPTION_CURRENCY || 'INR',
    interval: SUBSCRIPTION_INTERVAL || 'monthly',
    intervalCount: Number(SUBSCRIPTION_INTERVAL_COUNT) || 1,
    totalCount: Number(SUBSCRIPTION_TOTAL_COUNT) || 12,
    description: SUBSCRIPTION_DESCRIPTION || 'SSF monthly donation plan',
    razorpayKeyId: RAZORPAY_KEY_ID,
  });
});

// Create a customer and subscription using a saved plan.
router.post('/create', async (req, res, next) => {
  try {
    const { customer, planId, amount, totalCount, quantity = 1 } = req.body;

    if (!customer || !customer.name || !customer.email || !customer.contact || !customer.pan) {
      return res.status(400).json({
        error: 'Customer data is required: name, PAN, email, contact.',
      });
    }

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        error: 'Amount is required and must be greater than zero.',
      });
    }

    const razorpay = getRazorpayClient();
    const customerRecord = await razorpay.customers.create({
      ...customer,
      notes: {
        pan: customer.pan,
        donation_amount: String(amount),
      },
      fail_existing: '0',
    });

    const requestedAmount = Number(amount);
    const defaultAmount = Number(SUBSCRIPTION_AMOUNT) || requestedAmount;
    const effectivePlanId = await getPlanIdForAmount({
      requestedAmount,
      planId,
      defaultAmount,
      currency: SUBSCRIPTION_CURRENCY || 'INR',
      interval: SUBSCRIPTION_INTERVAL || 'monthly',
      intervalCount: Number(SUBSCRIPTION_INTERVAL_COUNT) || 1,
      totalCount: totalCount || Number(SUBSCRIPTION_TOTAL_COUNT) || 12,
      customer,
    });

    const subscription = await razorpay.subscriptions.create({
      plan_id: effectivePlanId,
      customer_notify: 1,
      total_count: totalCount || Number(SUBSCRIPTION_TOTAL_COUNT) || 12,
      quantity,
      customer_id: customerRecord.id,
      notes: {
        donor_name: customer.name,
        donor_pan: customer.pan,
        donation_amount: String(amount),
      },
      start_at: Math.floor(Date.now() / 1000) + 300,
    });

    res.json({
      subscriptionId: subscription.id,
      customerId: customerRecord.id,
      subscription,
      razorpayKeyId: RAZORPAY_KEY_ID,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/webhook', async (req, res, next) => {
  try {
    if (!RAZORPAY_WEBHOOK_SECRET) {
      return res.status(500).json({ error: 'Webhook secret is not configured.' });
    }

    const signature = req.headers['x-razorpay-signature'];
    const payload = req.rawBody || JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    if (!signature || signature !== expected) {
      console.warn('Invalid Razorpay webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body.event;
    console.log('Razorpay webhook event received:', event);
    console.log('Payload:', JSON.stringify(req.body.payload));

    switch (event) {
      case 'subscription.activated':
        console.log('Subscription activated.');
        break;
      case 'subscription.charged':
        console.log('Subscription payment successful.');
        break;
      case 'subscription.charged.expired':
        console.log('Subscription charge expired.');
        break;
      case 'subscription.payment.failed':
        console.log('Subscription payment failed.');
        break;
      case 'subscription.cancelled':
        console.log('Subscription cancelled.');
        break;
      default:
        console.log('Unhandled Razorpay event:', event);
    }

    res.json({ status: 'ok', event });
  } catch (error) {
    next(error);
  }
});

// Create a reusable Razorpay payment page link for a subscription plan.
router.post('/payment-page', async (req, res, next) => {
  try {
    const {
      title = 'SSF Monthly Donation',
      description = SUBSCRIPTION_DESCRIPTION || 'Support SSF with a recurring donation',
      amount = Number(SUBSCRIPTION_AMOUNT) || 10000,
      currency = SUBSCRIPTION_CURRENCY || 'INR',
      interval = SUBSCRIPTION_INTERVAL || 'monthly',
      intervalCount = Number(SUBSCRIPTION_INTERVAL_COUNT) || 1,
      totalCount = Number(SUBSCRIPTION_TOTAL_COUNT) || 12,
    } = req.body;

    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    const response = await axios.post(
      'https://api.razorpay.com/v1/payment_pages',
      {
        type: 'link',
        title,
        description,
        amount,
        currency,
        recurring: {
          interval,
          interval_count: intervalCount,
          total_count: totalCount,
          customer_notify: 1,
        },
      },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json({ paymentPage: response.data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
