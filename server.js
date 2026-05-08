const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
// Add this above your other routes
app.get('/', (req, res) => {
    res.status(200).send('FaithPay Engine is Live. Listening for M-Pesa Triggers.');
});

app.use(express.json());
app.use(cors());

// M-Pesa Credentials (Set these in Render Environment Variables)
const consumerKey = process.env.MPESA_CONSUMER_KEY;
const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
const shortCode = process.env.MPESA_PAYBILL_OR_TILL;
const passkey = process.env.MPESA_PASSKEY;
const hqTill = process.env.HQ_ORGANIZATION_TILL; // The Main Org Till

// Generate Daraja Access Token
const getAccessToken = async () => {
    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const res = await axios.get("https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
        headers: { Authorization: `Basic ${auth}` }
    });
    return res.data.access_token;
};

// ENDPOINT 1: MEMBER TO CHURCH (STK PUSH)
app.post('/api/stkpush', async (req, res) => {
    const { phone, amount, churchTill, accountRef } = req.body;
    try {
        const token = await getAccessToken();
        const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
        const password = Buffer.from(`${churchTill}${passkey}${timestamp}`).toString('base64');

        const response = await axios.post(
            "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
            {
                BusinessShortCode: churchTill,
                Password: password,
                Timestamp: timestamp,
                TransactionType: "CustomerBuyGoodsOnline",
                Amount: amount,
                PartyA: phone,
                PartyB: churchTill,
                PhoneNumber: phone,
                CallBackURL: "https://give-bzn3.onrender.com/api/callback",
                AccountReference: accountRef,
                TransactionDesc: "Tithes and Offering"
            },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        res.status(200).json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.response.data });
    }
});

// ENDPOINT 2: CHURCH TO HQ (B2B REMITTANCE)
app.post('/api/remit', async (req, res) => {
    const { amount, churchShortCode } = req.body;
    try {
        const token = await getAccessToken();
        const response = await axios.post(
            "https://sandbox.safaricom.co.ke/mpesa/b2b/v1/paymentrequest",
            {
                Initiator: "FaithPay_Admin",
                SecurityCredential: "ENCRYPTED_CREDENTIAL",
                CommandID: "BusinessPayBill",
                SenderIdentifierType: "4",
                RecieverIdentifierType: "4",
                Amount: amount,
                PartyA: churchShortCode,
                PartyB: hqTill,
                AccountReference: "10_PERCENT_REMIT",
                Remarks: "Weekly Church Remittance",
                QueueTimeOutURL: "https://give-bzn3.onrender.com/api/timeout",
                ResultURL: "https://give-bzn3.onrender.com/api/result"
            },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        res.status(200).json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.response.data });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FaithPay OS Engine running on port ${PORT}`));
