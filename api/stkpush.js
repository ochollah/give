import fetch from 'node-fetch';

export default async function handler(req, res) {
    // 1. Dynamic CORS handling to stop frontend browser blocks
    const allowedOrigin = req.headers.origin;
    if (allowedOrigin && (allowedOrigin.includes('github.io') || allowedOrigin.includes('localhost'))) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle pre-flight browser requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 2. Safe incoming body extraction patch
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            return res.status(400).json({ error: 'Malformed JSON payload body' });
        }
    }

    const { phone, amount, accountRef } = body || {};
    
    if (!phone || !amount) {
        return res.status(400).json({ error: 'Missing phone number or transaction amount configuration' });
    }
    
    // Clean phone layout (Converts 07... or +254... to clean 254...)
    const formattedPhone = phone.replace(/^0/, '254').replace(/^\+/, '').trim();

    try {
        // 3. Authenticate with Daraja using fixed variable names
        const consumerKey = process.env.MPESA_CONSUMER_KEY;
        const secretKey = process.env.MPESA_CONSUMER_SECRET; // Fixed from MPESA_CONSUMER_SECRET
        const shortcode = process.env.SHORTCODES || process.env.MPESA_SHORTCODE || "174379"; 
        const passkey = process.env.MPESA_PASSKEY;

        const credentials = Buffer.from(`${consumerKey}:${secretKey}`).toString('base64');
        
        const tokenResponse = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            method: 'GET',
            headers: { Authorization: `Basic ${credentials}` }
        });

        if (!tokenResponse.ok) {
            const errDump = await tokenResponse.text();
            return res.status(500).json({ error: 'Daraja OAuth Failed', details: errDump });
        }

        const { access_token } = await tokenResponse.json();

        // 4. Time synchronization metrics 
        const date = new Date();
        const t = (n) => String(n).padStart(2, '0');
        const timestamp = `${date.getFullYear()}${t(date.getMonth() + 1)}${t(date.getDate())}${t(date.getHours())}${t(date.getMinutes())}${t(date.getSeconds())}`;
        
        const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

        // 5. Structure payload
        const stkPayload = {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerPayBillOnline",
            Amount: Math.round(amount),
            PartyA: formattedPhone,
            PartyB: shortcode,
            PhoneNumber: formattedPhone,
            CallBackURL: `https://${process.env.VERCEL_URL}/api/callback`,
            AccountReference: accountRef ? accountRef.substring(0, 12) : "FaithPay",
            TransactionDesc: "Portal Contribution"
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
        return res.status(500).json({ error: 'Internal Gateway Exception', message: error.message });
    }
}
