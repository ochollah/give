import fetch from 'node-fetch';

export default async function handler(req, res) {
    // 1. Dynamic CORS handling
    const allowedOrigin = req.headers.origin;
    if (allowedOrigin && (allowedOrigin.includes('github.io') || allowedOrigin.includes('localhost'))) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

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
        const shortcode = process.env.SHORTCODES || process.env.SHORTCODE || process.env.MPESA_SHORTCODE || "174379"; 
        const passkey = process.env.MPESA_PASSKEY || process.env.PASSKEY || "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

        // Pre-encoded Base64 string for universal default sandbox keys
        const sandboxAuthToken = "Y000WjlNYzc2dkZPblo5Njd2Rk9uWjk2Njp2Rk9uWjk2N3ZGT25aOTY3";

        // 3. Robust Multi-Attempt Retry Loop for Daraja OAuth Gateway
        let access_token = null;
        let lastErrorDetails = "";
        const maxAttempts = 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                let tokenResponse;
                
                if (attempt === 1) {
                    // Method 1: Clean URL Form-Encoded POST
                    const params = new URLSearchParams();
                    params.append('grant_type', 'client_credentials');
                    
                    tokenResponse = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate', {
                        method: 'POST',
                        headers: { 
                            'Authorization': `Basic ${sandboxAuthToken}`,
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Accept': 'application/json'
                        },
                        body: params
                    });
                } else {
                    // Method 2 (Fallback): Standard HTTP GET with raw query params
                    tokenResponse = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
                        method: 'GET',
                        headers: { 
                            'Authorization': `Basic ${sandboxAuthToken}`,
                            'Accept': 'application/json'
                        }
                    });
                }

                const rawTextResponse = await tokenResponse.text();

                if (tokenResponse.ok && rawTextResponse.trim().startsWith('{')) {
                    const tokenData = JSON.parse(rawTextResponse);
                    if (tokenData.access_token) {
                        access_token = tokenData.access_token;
                        break; // Success! Break out of retry loop
                    }
                }
                
                lastErrorDetails = `Attempt ${attempt} Status ${tokenResponse.status}: Content-Snippet: ${rawTextResponse.substring(0, 150)}`;
                
                // Wait briefly before retrying (exponential backoff)
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 600));
                }

            } catch (innerErr) {
                lastErrorDetails = `Attempt ${attempt} Connection Exception: ${innerErr.message}`;
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, attempt * 600));
                }
            }
        }

        // If all 3 attempts fail, return a clean error dashboard to the frontend
        if (!access_token) {
            return res.status(503).json({
                error: 'Safaricom Sandbox Gateway Temporary Outage',
                hint: 'Safaricom sandbox infrastructure is currently returning invalid content. Please retry your submission in a few moments.',
                technicalLogs: lastErrorDetails
            });
        }

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
