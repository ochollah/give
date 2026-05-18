import fetch from 'node-fetch';

export default async function handler(req, res) {
    // Enable CORS for GitHub Pages
    res.setHeader('Access-Control-Allow-Origin', 'https://yourusername.github.io');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { phone, amount, accountRef } = req.body;
    
    // Format phone number correctly (Must be 254XXXXXXXXX)
    const formattedPhone = phone.replace(/^0/, '254').replace(/^\+/, '');

    try {
        // 1. Generate Daraja OAuth Access Token
        const credentials = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
        const tokenResponse = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: `Basic ${credentials}` }
        });
        const { access_token } = await tokenResponse.json();

        // 2. Generate Safaricom Password & Timestamp
        const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
        const password = Buffer.from(
            `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`
        ).toString('base64');

        // 3. Request the STK Push
        const stkPayload = {
            BusinessShortCode: process.env.MPESA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: Math.round(amount),
            PartyA: formattedPhone,
            PartyB: process.env.MPESA_SHORTCODE,
            PhoneNumber: formattedPhone,
            CallBackURL: `https://${process.env.VERCEL_URL}/api/callback`,
            AccountReference: accountRef || "OrderPayment",
            TransactionDesc: "API Payment"
        };

        const darajaResponse = await fetch('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(stkPayload)
        });

        const result = await darajaResponse.json();
        return res.status(200).json(result);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
