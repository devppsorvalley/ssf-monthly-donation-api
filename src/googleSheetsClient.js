const axios = require('axios');
const crypto = require('crypto');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_SHEET_RANGE = 'Donations!A:O';

let cachedToken = null;

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_SHEETS_ID
    && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    && process.env.GOOGLE_PRIVATE_KEY
  );
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getPrivateKey() {
  return process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.accessToken;
  }

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const claim = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const unsignedToken = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsignedToken)
    .sign(getPrivateKey(), 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const assertion = `${unsignedToken}.${signature}`;
  const response = await axios.post(
    GOOGLE_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  cachedToken = {
    accessToken: response.data.access_token,
    expiresAt: now + Number(response.data.expires_in || 3600),
  };

  return cachedToken.accessToken;
}

function getNoteValue(notes, key) {
  return notes && notes[key] ? notes[key] : '';
}

function buildDonationRow({ subscription, paymentId }) {
  const notes = subscription.notes || {};
  const amountPaise = Number(getNoteValue(notes, 'donation_amount')) || '';
  const amountRupees = amountPaise ? amountPaise / 100 : '';
  const createdAt = subscription.created_at
    ? new Date(subscription.created_at * 1000).toISOString()
    : '';

  return [
    new Date().toISOString(),
    subscription.id || '',
    paymentId || '',
    subscription.customer_id || getNoteValue(notes, 'razorpay_customer_id'),
    subscription.status || '',
    subscription.plan_id || '',
    getNoteValue(notes, 'donor_name'),
    getNoteValue(notes, 'donor_email'),
    getNoteValue(notes, 'donor_contact'),
    getNoteValue(notes, 'donor_pan'),
    amountPaise,
    amountRupees,
    process.env.SUBSCRIPTION_CURRENCY || 'INR',
    subscription.total_count || '',
    createdAt,
  ];
}

async function appendDonationToSheet({ subscription, paymentId }) {
  if (!isConfigured()) {
    console.warn('Google Sheets sync skipped: GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, or GOOGLE_PRIVATE_KEY is not configured.');
    return { skipped: true };
  }

  const accessToken = await getAccessToken();
  const spreadsheetId = encodeURIComponent(process.env.GOOGLE_SHEETS_ID);
  const range = encodeURIComponent(process.env.GOOGLE_SHEETS_RANGE || DEFAULT_SHEET_RANGE);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await axios.post(
    url,
    {
      values: [buildDonationRow({ subscription, paymentId })],
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    skipped: false,
    updates: response.data.updates,
  };
}

module.exports = {
  appendDonationToSheet,
};
