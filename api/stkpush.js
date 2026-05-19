import https from 'https';

export default async function handler(req, res) {

    // =========================================
    // CORS
    // =========================================
    const origin = req.headers.origin || '*';

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {

        // =========================================
        // BODY PARSING
        // =========================================
        let body = req.body;

        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch (e) {
                return res.status(400).json({
                    error: 'Malformed JSON body'
                });
            }
        }

        const {
            phone,
            amount,
            accountRef
        } = body || {};

        if (!phone || !amount) {
            return res.status(400).json({
                error: 'Phone and amount are required'
            });
        }

        // =========================================
        // PHONE FORMAT
        // =========================================
        let formattedPhone = phone
            .toString()
            .trim()
            .replace(/\s+/g, '')
            .replace('+', '');

        // 0712345678 => 254712345678
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.substring(1);
        }

        // 712345678 => 254712345678
        if (formattedPhone.startsWith('7')) {
            formattedPhone = '254' + formattedPhone;
        }

        if (!formattedPhone.startsWith('254')) {
            return res.status(400).json({
                error: 'Invalid Kenyan phone number format'
            });
        }

        // =========================================
        // ENVIRONMENT VARIABLES
        // =========================================
        const consumerKey =
            process.env.CONSUMER_KEY;

        const consumerSecret =
            process.env.CONSUMER_SECRET;

        const shortcode =
            process.env.SHORTCODE || '174379';

        const passkey =
            process.env.PASSKEY;

        const callbackURL =
            process.env.CALLBACK_URL ||
            `https://${process.env.VERCEL_URL}/api/callback`;

        if (
            !consumerKey ||
            !consumerSecret ||
            !passkey
        ) {
            return res.status(500).json({
                error: 'Missing MPESA environment variables'
            });
        }

        // =========================================
        // GENERATE TOKEN
        // =========================================
        const auth = Buffer.from(
            `${consumerKey}:${consumerSecret}`
        ).toString('base64');

        const accessToken = await new Promise((resolve, reject) => {

            const tokenReq = https.request({

                hostname: 'sandbox.safaricom.co.ke',
                path: '/oauth/v1/generate?grant_type=client_credentials',
                method: 'GET',

                headers: {
                    Authorization: `Basic ${auth}`,
                    Accept: 'application/json'
                }

            }, (tokenRes) => {

                let data = '';

                tokenRes.on('data', (chunk) => {
                    data += chunk;
                });

                tokenRes.on('end', () => {

                    console.log('TOKEN RAW RESPONSE:', data);

                    try {

                        if (!data || data.trim() === '') {
                            return reject(
                                new Error('Empty token response from Safaricom')
                            );
                        }

                        const result = JSON.parse(data);

                        if (!result.access_token) {
                            return reject(
                                new Error(`Access token missing: ${data}`)
                            );
                        }

                        resolve(result.access_token);

                    } catch (err) {

                        reject(
                            new Error(`Token JSON parse failed: ${data}`)
                        );

                    }

                });

            });

            tokenReq.on('error', (err) => {
                reject(
                    new Error(`Token request failed: ${err.message}`)
                );
            });

            tokenReq.end();

        });

        // =========================================
        // TIMESTAMP
        // =========================================
        const date = new Date();

        const timestamp =
            date.getFullYear().toString() +
            String(date.getMonth() + 1).padStart(2, '0') +
            String(date.getDate()).padStart(2, '0') +
            String(date.getHours()).padStart(2, '0') +
            String(date.getMinutes()).padStart(2, '0') +
            String(date.getSeconds()).padStart(2, '0');

        // =========================================
        // PASSWORD
        // =========================================
        const password = Buffer.from(
            shortcode + passkey + timestamp
        ).toString('base64');

        // =========================================
        // STK PAYLOAD
        // =========================================
        const stkPayload = JSON.stringify({

            BusinessShortCode: shortcode,

            Password: password,

            Timestamp: timestamp,

            TransactionType: 'CustomerPayBillOnline',

            Amount: Math.round(Number(amount)),

            PartyA: formattedPhone,

            PartyB: shortcode,

            PhoneNumber: formattedPhone,

            CallBackURL: callbackURL,

            AccountReference: (
                accountRef || 'FaithPay'
            ).substring(0, 12),

            TransactionDesc: 'Portal Payment'

        });

        console.log('STK PAYLOAD:', stkPayload);

        // =========================================
        // STK PUSH REQUEST
        // =========================================
        const stkResponse = await new Promise((resolve, reject) => {

            const stkReq = https.request({

                hostname: 'sandbox.safaricom.co.ke',

                path: '/mpesa/stkpush/v1/processrequest',

                method: 'POST',

                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(stkPayload)
                }

            }, (stkRes) => {

                let data = '';

                stkRes.on('data', (chunk) => {
                    data += chunk;
                });

                stkRes.on('end', () => {

                    console.log('STK RAW RESPONSE:', data);

                    try {

                        if (!data || data.trim() === '') {
                            return reject(
                                new Error('Empty STK response')
                            );
                        }

                        let result;

                        try {
                            result = JSON.parse(data);
                        } catch (e) {
                            return reject(
                                new Error(`Invalid STK JSON: ${data}`)
                            );
                        }

                        resolve({
                            httpCode: stkRes.statusCode,
                            response: result
                        });

                    } catch (err) {

                        reject(
                            new Error(`STK processing failed: ${err.message}`)
                        );

                    }

                });

            });

            stkReq.on('error', (err) => {

                reject(
                    new Error(`STK request failed: ${err.message}`)
                );

            });

            stkReq.write(stkPayload);

            stkReq.end();

        });

        // =========================================
        // SUCCESS RESPONSE
        // =========================================
        return res.status(200).json(stkResponse);

    } catch (error) {

        console.error('FULL ERROR:', error);

        return res.status(500).json({
            success: false,
            error: 'STK Push Failed',
            message: error.message
        });

    }

}
