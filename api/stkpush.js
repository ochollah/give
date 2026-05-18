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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

    // Handle pre-flight browser requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 2. Safe incoming body parsing
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
    
    const formattedPhone = phone.replace(/^0/, '254').replace(/^\+/, '').trim();

    try {
        // Fallback variables pulled directly from environment configurations
        const consumerKey = process.env.CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY || "cM4Z9Mc76vFOnZ967vFOnZ967vFOnZ96";
        const secretKey = process.env.CONSUMER_SECRET || process.env.MPESA_SECRET_KEY || "vFOnZ967vFOnZ967";
        const shortcode = process.env.SHORTCODES || process.env.SHORTCODE || process.env.MPESA_SHORTCODE || "174379"; 
        const passkey = process.env.MPESA_PASSKEY || process.env.PASSKEY || "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

        // 3. Dynamic Real-Time Generation of Authentication Header Token
        // This avoids hardcoding expired static strings that generate 403 blocks
        const liveCredentials = Buffer.from(`${consumerKey.trim()}:${secretKey.trim()}`).toString('base64');

        // Execute traditional HTTP GET request sequence containing the query signature
        const tokenResponse = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
            method: 'GET',
            headers: { 
                'Authorization': `Basic ${liveCredentials}`,
                'Accept': 'application/json'
            }
        });

        const rawTextResponse = await tokenResponse.text();

        if (!tokenResponse.ok) {
            return res.status(500).json({ 
                error: 'Daraja OAuth Gateway Rejection', 
                status: tokenResponse.status,
                details: rawTextResponse 
            });
        }

        let tokenData;
        try {
            tokenData = JSON.parse(rawTextResponse);
        } catch (parseError) {
            return res.status(500).json({
                error: 'Safaricom Sandbox Returned Non-JSON Content',
                status: tokenResponse.status,
                details: rawTextResponse.substring(0, 200)
            });
        }

        const access_token = tokenData.access_token;

        // 4. Time synchronization metrics formatted into: YYYYMMDDHHMMSS
        const date = new Date();
        const t = (n) => String(n).padStart(2, '0');
        const timestamp = `${date.getFullYear()}${t(date.getMonth() + 1)}${t(date.getDate())}${t(date.getHours())}${t(date.getMinutes())}${t(date.getSeconds())}`;
        
        const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

        // 5. Structure payload for Customer Paybill Online push sequence
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
