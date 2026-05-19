import https from 'https';

export default async function handler(req, res) {
    // 1. Production CORS handling
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

    // 2. Body payload parsing
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
        // Read keys dynamically, falling back to Safaricom's baseline test parameters
        const consumerKey = (process.env.CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY || "cM4Z9Mc76vFOnZ967vFOnZ967vFOnZ96").trim();
        const secretKey = (process.env.CONSUMER_SECRET || process.env.MPESA_SECRET_KEY || "vFOnZ967vFOnZ967").trim();
        const shortcode = (process.env.SHORTCODES || process.env.SHORTCODE || process.env.MPESA_SHORTCODE || "174379").trim(); 
        const passkey = (process.env.MPESA_PASSKEY || process.env.PASSKEY || "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919").trim();

        // Check if a live custom token is manually provided to bypass Safaricom's authentication completely
        let access_token = process.env.MANUAL_DARADA_TOKEN || null;

        if (!access_token) {
            const liveCredentials = Buffer.from(`${consumerKey}:${secretKey}`).toString('base64');

            // 3. Low-level HTTPS execution block for Token Request
            access_token = await new Promise((resolve, reject) => {
                const options = {
                    hostname: 'sandbox.safaricom.co.ke',
                    path: '/oauth/v1/generate?grant_type=client_credentials',
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${liveCredentials}`,
                        'Accept': 'application/json'
                    }
                };

                const reqToken = https.request(options, (resToken) => {
                    let data = '';
                    resToken.on('data', (chunk) => { data += chunk; });
                    resToken.on('end', () => {
                        if (resToken.statusCode !== 200) {
                            reject(new Error(`Safaricom Gateway Rejected Credentials with Status ${resToken.statusCode}. Raw Response: ${data}`));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.access_token) {
                                resolve(parsed.access_token);
                            } else {
                                reject(new Error("Valid payload received but access_token property was absent."));
                            }
                        } catch (e) {
                            reject(new Error(`Failed to parse gateway payload: ${data}`));
                        }
                    });
                });

                reqToken.on('error', (err) => { reject(err); });
                reqToken.end();
            }).catch(err => {
                return { _failed: true, message: err.message };
            });
        }

        // Handle strict credential rejection errors gracefully
        if (access_token._failed) {
            return res.status(400).json({ 
                error: 'Daraja OAuth Failed', 
                status: 400,
                details: access_token.message,
                remedy: 'This happens when the public keys are blocked or expired on Safaricom. Create your own free developer account at developer.safaricom.co.ke, create an app, and add your own unique CONSUMER_KEY and CONSUMER_SECRET to your Vercel project settings.'
            });
        }

        // 4. Timestamp Generation (YYYYMMDDHHMMSS)
        const date = new Date();
        const t = (n) => String(n).padStart(2, '0');
        const timestamp = `${date.getFullYear()}${t(date.getMonth() + 1)}${t(date.getDate())}${t(date.getHours())}${t(date.getMinutes())}${t(date.getSeconds())}`;
        
        const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

        // 5. Structure payload for Customer Paybill Online push sequence
        const stkPayload = JSON.stringify({
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
        });

        // 6. Execute STK Push Request
        const stkResult = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'sandbox.safaricom.co.ke',
                path: '/mpesa/stkpush/v1/processrequest',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(stkPayload)
                }
            };

            const reqStk = https.request(options, (resStk) => {
                let data = '';
                resStk.on('data', (chunk) => { data += chunk; });
                resStk.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`STK parse error: ${data}`));
                    }
                });
            });

            reqStk.on('error', (err) => { reject(err); });
            reqStk.write(stkPayload);
            reqStk.end();
        });

        return res.status(200).json(stkResult);

    } catch (error) {
        return res.status(500).json({ error: 'Internal Gateway Exception', message: error.message });
    }
}
