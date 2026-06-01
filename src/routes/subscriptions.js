const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const getRazorpayClient = require('../razorpayClient');
const { appendDonationToSheet } = require('../googleSheetsClient');
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

const DEFAULT_MAX_TOTAL_COUNT = 120;
const SUBSCRIPTION_CHANGE_ACTIONS = ['pause', 'resume', 'cancel'];

function getIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeCustomer(customer) {
  if (!customer || typeof customer !== 'object') {
    return null;
  }

  return {
    name: String(customer.name || '').trim(),
    email: String(customer.email || '').trim().toLowerCase(),
    contact: String(customer.contact || '').trim(),
    pan: String(customer.pan || '').trim().toUpperCase(),
  };
}

function validateDonationRequest({ customer, amount, totalCount, quantity }) {
  const normalizedCustomer = normalizeCustomer(customer) || {
    name: '',
    email: '',
    contact: '',
    pan: '',
  };
  const requestedAmount = Number(amount);

  const requestedQuantity = Number(quantity);
  if (!Number.isInteger(requestedQuantity) || requestedQuantity !== 1) {
    return { error: 'Quantity must be 1 for donation subscriptions.' };
  }

  const defaultTotalCount = getIntegerEnv('SUBSCRIPTION_TOTAL_COUNT', 24);
  const maxTotalCount = getIntegerEnv('MAX_SUBSCRIPTION_TOTAL_COUNT', DEFAULT_MAX_TOTAL_COUNT);
  const billingCycles = totalCount === undefined ? defaultTotalCount : Number(totalCount);
  if (!Number.isInteger(billingCycles) || billingCycles < 1 || billingCycles > maxTotalCount) {
    return { error: `Total count must be an integer between 1 and ${maxTotalCount}.` };
  }

  return {
    customer: normalizedCustomer,
    requestedAmount,
    quantity: requestedQuantity,
    billingCycles,
  };
}

function requireAdminToken(req, res) {
  if (!process.env.ADMIN_TOKEN) {
    res.status(503).json({ error: 'Admin token is not configured.' });
    return false;
  }

  const adminToken = req.headers['x-admin-token'];
  if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
    res.status(403).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

function secureCompare(value, expected) {
  const valueBuffer = Buffer.from(String(value || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePhone(contact) {
  return String(contact || '').replace(/\D/g, '');
}

function phoneMatches(left, right) {
  const normalizedLeft = normalizePhone(left);
  const normalizedRight = normalizePhone(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft === normalizedRight
    || (normalizedLeft.length >= 10 && normalizedRight.length >= 10 && normalizedLeft.slice(-10) === normalizedRight.slice(-10));
}

function getItems(response) {
  return Array.isArray(response.items) ? response.items : response;
}

async function fetchAllFromRazorpay(fetchPage, maxItems = 1000) {
  const allItems = [];
  let skip = 0;
  const count = 100;

  while (allItems.length < maxItems) {
    const response = await fetchPage({ count, skip });
    const items = getItems(response);

    if (!Array.isArray(items) || items.length === 0) {
      break;
    }

    allItems.push(...items);
    if (items.length < count) {
      break;
    }

    skip += count;
  }

  return allItems.slice(0, maxItems);
}

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

async function getMatchingCustomerIds(razorpay, { email, contact }) {
  const normalizedEmail = normalizeEmail(email);
  const customers = await fetchAllFromRazorpay((params) => razorpay.customers.all(params), 1000);

  return customers
    .filter((customer) => {
      const emailMatch = normalizedEmail && normalizeEmail(customer.email) === normalizedEmail;
      const phoneMatch = contact && phoneMatches(customer.contact, contact);
      return emailMatch || phoneMatch;
    })
    .map((customer) => customer.id)
    .filter(Boolean);
}

async function findSubscriptionsForDonor(razorpay, { email, contact }) {
  const normalizedEmail = normalizeEmail(email);
  const matchingCustomerIds = await getMatchingCustomerIds(razorpay, { email, contact });
  const subscriptions = await fetchAllFromRazorpay((params) => razorpay.subscriptions.all(params), 1000);

  return subscriptions
    .filter((subscription) => {
      const notes = subscription.notes || {};
      const emailMatch = normalizedEmail && normalizeEmail(notes.donor_email) === normalizedEmail;
      const phoneMatch = contact && phoneMatches(notes.donor_contact, contact);
      const customerMatch = subscription.customer_id && matchingCustomerIds.includes(subscription.customer_id);
      return emailMatch || phoneMatch || customerMatch;
    })
    .sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0));
}

function getEligibleSubscription(subscriptions, action) {
  const statusByAction = {
    pause: ['active'],
    resume: ['paused'],
    cancel: ['active', 'authenticated', 'pending', 'halted'],
  };
  const allowedStatuses = statusByAction[action] || [];

  return subscriptions.find((subscription) => allowedStatuses.includes(subscription.status));
}

async function changeSubscription(razorpay, subscriptionId, action) {
  if (action === 'pause') {
    return razorpay.subscriptions.pause(subscriptionId, { pause_at: 'now' });
  }

  if (action === 'resume') {
    return razorpay.subscriptions.resume(subscriptionId, { resume_at: 'now' });
  }

  return razorpay.subscriptions.cancel(subscriptionId, 1);
}

async function findExistingCustomer(razorpay, customer) {
  const response = await razorpay.customers.all({ count: 100, skip: 0 });
  const customers = Array.isArray(response.items) ? response.items : response;

  if (!Array.isArray(customers)) {
    return null;
  }

  const matchingCustomers = customers.filter((existingCustomer) => {
    const emailMatches = String(existingCustomer.email || '').toLowerCase() === customer.email;
    const contactMatches = String(existingCustomer.contact || '') === customer.contact;
    return emailMatches || contactMatches;
  });

  return matchingCustomers.find((existingCustomer) => {
    const emailMatches = String(existingCustomer.email || '').toLowerCase() === customer.email;
    const contactMatches = String(existingCustomer.contact || '') === customer.contact;
    return emailMatches && contactMatches;
  }) || (matchingCustomers.length === 1 ? matchingCustomers[0] : null);
}

async function createOrFetchCustomer(razorpay, customer, requestedAmount) {
  const payload = {
    ...customer,
    notes: {
      pan: customer.pan,
      donation_amount: String(requestedAmount),
    },
    fail_existing: '0',
  };

  try {
    return await razorpay.customers.create(payload);
  } catch (error) {
    const description = error && error.error && error.error.description;
    if (!description || !description.includes('Customer already exists')) {
      throw error;
    }

    const existingCustomer = await findExistingCustomer(razorpay, customer);
    if (existingCustomer) {
      return existingCustomer;
    }

    throw error;
  }
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
  });

  return plan.id;
}

// Create a reusable plan for subscriptions.
// Use this once, then save the returned plan_id in RAZORPAY_PLAN_ID.
// PROTECTED: This endpoint should only be used by admins during setup.
router.post('/plan', async (req, res, next) => {
  try {
    if (!requireAdminToken(req, res)) {
      return;
    }

    const {
      planName = 'SSF Monthly Donation',
      amount = Number(SUBSCRIPTION_AMOUNT) || 10000,
      currency = SUBSCRIPTION_CURRENCY || 'INR',
      interval = SUBSCRIPTION_INTERVAL || 'monthly',
      intervalCount = Number(SUBSCRIPTION_INTERVAL_COUNT) || 1,
      description = SUBSCRIPTION_DESCRIPTION || 'SSF monthly donation plan',
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

// Create a Razorpay subscription using a saved or matching plan.
router.post('/create', async (req, res, next) => {
  try {
    const { customer, planId, amount, totalCount, quantity = 1 } = req.body;
    const validation = validateDonationRequest({ customer, amount, totalCount, quantity });
    if (validation.error) {
      return res.status(400).json({ error: validation.error });
    }

    const razorpay = getRazorpayClient();
    const requestedAmount = validation.requestedAmount;
    const customerRecord = await createOrFetchCustomer(razorpay, validation.customer, requestedAmount);
    const defaultAmount = Number(SUBSCRIPTION_AMOUNT) || requestedAmount;
    const effectivePlanId = await getPlanIdForAmount({
      requestedAmount,
      planId,
      defaultAmount,
      currency: SUBSCRIPTION_CURRENCY || 'INR',
      interval: SUBSCRIPTION_INTERVAL || 'monthly',
      intervalCount: Number(SUBSCRIPTION_INTERVAL_COUNT) || 1,
      totalCount: validation.billingCycles,
      customer: validation.customer,
    });

    const subscription = await razorpay.subscriptions.create({
      plan_id: effectivePlanId,
      customer_notify: 1,
      quantity: validation.quantity,
      customer_id: customerRecord.id,
      total_count: validation.billingCycles,
      notify_info: {
        notify_phone: validation.customer.contact,
        notify_email: validation.customer.email,
      },
      notes: {
        donor_name: validation.customer.name,
        donor_email: validation.customer.email,
        donor_contact: validation.customer.contact,
        donor_pan: validation.customer.pan,
        donation_amount: String(validation.requestedAmount),
        razorpay_customer_id: customerRecord.id,
      },
    });

    res.json({
      success: true,
      subscriptionId: subscription.id,
      checkoutUrl: subscription.short_url,
      razorpayKeyId: RAZORPAY_KEY_ID,
      customerId: customerRecord.id,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/verify', async (req, res, next) => {
  try {
    const {
      subscriptionId,
      razorpay_payment_id: paymentId,
      razorpay_subscription_id: razorpaySubscriptionId,
      razorpay_signature: signature,
    } = req.body;

    if (!subscriptionId || !paymentId || !razorpaySubscriptionId || !signature) {
      return res.status(400).json({ error: 'Payment verification data is incomplete.' });
    }

    if (subscriptionId !== razorpaySubscriptionId) {
      return res.status(400).json({ error: 'Subscription ID mismatch.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${paymentId}|${subscriptionId}`)
      .digest('hex');

    if (!secureCompare(signature, expectedSignature)) {
      return res.status(400).json({ error: 'Invalid payment signature.' });
    }

    const razorpay = getRazorpayClient();
    const subscription = await razorpay.subscriptions.fetch(subscriptionId);
    let sheetSync = { skipped: true };

    try {
      sheetSync = await appendDonationToSheet({ subscription, paymentId });
    } catch (sheetError) {
      console.error('Google Sheets sync failed:', sheetError.response && sheetError.response.data ? sheetError.response.data : sheetError.message);
      sheetSync = { skipped: false, error: 'Google Sheets sync failed.' };
    }

    res.json({
      success: true,
      subscriptionId,
      paymentId,
      customerId: subscription.customer_id || null,
      status: subscription.status,
      sheetSync,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/change', async (req, res, next) => {
  try {
    const { email, contact, phone, action: requestedAction } = req.body;
    const action = String(requestedAction || '').trim().toLowerCase();
    const lookupEmail = normalizeEmail(email);
    const lookupContact = String(contact || phone || '').trim();

    if (!lookupEmail && !lookupContact) {
      return res.status(400).json({ error: 'Email or phone is required.' });
    }

    if (!SUBSCRIPTION_CHANGE_ACTIONS.includes(action)) {
      return res.status(400).json({ error: 'Action must be one of: pause, resume, cancel.' });
    }

    const razorpay = getRazorpayClient();
    const subscriptions = await findSubscriptionsForDonor(razorpay, {
      email: lookupEmail,
      contact: lookupContact,
    });

    if (subscriptions.length === 0) {
      return res.status(404).json({ error: 'No subscription found for the provided email or phone.' });
    }

    const subscription = getEligibleSubscription(subscriptions, action);
    if (!subscription) {
      const statuses = [...new Set(subscriptions.map((item) => item.status).filter(Boolean))].join(', ');
      return res.status(409).json({
        error: `No subscription is eligible to ${action}. Current matching subscription status: ${statuses || 'unknown'}.`,
      });
    }

    const updatedSubscription = await changeSubscription(razorpay, subscription.id, action);

    res.json({
      success: true,
      action,
      subscriptionId: updatedSubscription.id || subscription.id,
      status: updatedSubscription.status,
      customerId: updatedSubscription.customer_id || subscription.customer_id || null,
      message: action === 'cancel'
        ? 'Subscription cancellation has been scheduled for the end of the current billing cycle.'
        : `Subscription ${action} request completed successfully.`,
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
    if (!requireAdminToken(req, res)) {
      return;
    }

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
