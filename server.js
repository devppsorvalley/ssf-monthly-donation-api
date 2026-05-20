const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const subscriptionRoutes = require('./src/routes/subscriptions');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
const rawBodySaver = (req, res, buf) => {
  if (buf && buf.length) req.rawBody = buf.toString('utf8');
};
app.use(express.json({ verify: rawBodySaver }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/subscriptions', subscriptionRoutes);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('SSF Subscription API is running. Use the WordPress donate form to submit to /api/subscriptions/create.');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`SSF Subscription API running on http://localhost:${PORT}`);
});
