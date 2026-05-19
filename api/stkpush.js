import https from 'https';

export default async function handler(req, res) {

    // =========================
    // CORS
    // =========================
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

        // =========================
        // BODY PARSING
        // =========================
        let body = req.body;

        if (typeof body === 'string') {
            body = JSON.parse(body);
        }

        const { phone, amount, accountRef } = body;

        if (!phone || !amount) {
            return res.status(400).json({
                error: 'Phone and amount are required'
            });
        }

        // =========================
        // FORMAT PHONE
        // Converts:
        // 0712345678 -> 254712345678
        // +254712345678 -> 254712345678
        // =========================
        let formattedPhone = phone
            .replace(/\s+/g, '')
            .replace('+', '');

        if (formattedPhone.startsWith('0')) {
            formattedPhone = '254' + formattedPhone.substring(1);
        }

        if (!formattedPhone.startsWith('254')) {
            return res.status(400).json({
                error: 'Invalid Kenyan phone number'
            });
        }

        // =========================
        // ENV VARIABLES
        // =========================
        const consumerKey =
            process.env.MPESA_CONSUMER_KEY;

        const consumerSecret =
            process.env.MPESA_CONSUMER_SECRET;

        const shortcode =
            process.env.MPESA_SHORTCODE || '174379';

        const passkey =
            process.env.MPESA_PASSKEY;

        if (!consumerKey || !consumerSecret || !passkey) {
            return res.status(500).json({
                error: 'Missing MPESA environment variables'
            });
        }

        // =========================
        // GET ACCESS TOKEN
        // =========================
        const auth = Buffer.from(
            `${consumerKey}:${consumerSecret}`
        ).toString('base64');

        const accessToken = await new Promise((resolve, reject) => {

            const tokenReq = https.request({
                hostname: 'sandbox.safaricom.co.ke',
                path: '/oauth/v1/generate?grant_type=client_credentials',
                method: 'GET',
                headers: {
                    Authorization: `Basic ${auth}`
                }

            }, (tokenRes) => {

                let data = '';

                tokenRes.on('data', chunk => {
                    data += chunk;
                });

                tokenRes.on('end', () => {

                    try {

                        const result = JSON.parse(data);

                        if (!result.access_token) {
                            return reject(result);
                        }

                        resolve(result.access_token);

                    } catch (err) {
                        reject(err);
                    }

                });

            });

            tokenReq.on('error', reject);
            tokenReq.end();

        });

        // =========================
        // TIMESTAMP
        // =========================
        const date = new Date();

        const timestamp =
            date.getFullYear().toString() +
            String(date.getMonth() + 1).padStart(2, '0') +
            String(date.getDate()).padStart(2, '0') +
            String(date.getHours()).padStart(2, '0') +
            String(date.getMinutes()).padStart(2, '0') +
            String(date.getSeconds()).padStart(2, '0');

        // =========================
        // PASSWORD
        // =========================
        const password = Buffer.from(
            shortcode + passkey + timestamp
        ).toString('base64');

        // =========================
        // CALLBACK URL
        // =========================
        const callbackURL =
            process.env.CALLBACK_URL ||
            `https://${process.env.VERCEL_URL}/api/callback`;

        // =========================
        // STK PAYLOAD
        // =========================
        const payload = JSON.stringify({
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: Number(amount),
            PartyA: formattedPhone,
            PartyB: shortcode,
            PhoneNumber: formattedPhone,
            CallBackURL: callbackURL,
            AccountReference: accountRef || 'FaithPay',
            TransactionDesc: 'Payment'
        });

        // =========================
        // STK REQUEST
        // =========================
        const stkResponse = await new Promise((resolve, reject) => {

            const stkReq = https.request({

                hostname: 'sandbox.safaricom.co.ke',
                path: '/mpesa/stkpush/v1/processrequest',
                method: 'POST',

                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }

            }, (stkRes) => {

                let data = '';

                stkRes.on('data', chunk => {
                    data += chunk;
                });

                stkRes.on('end', () => {

                    try {

                        const result = JSON.parse(data);

                        resolve({
                            statusCode: stkRes.statusCode,
                            body: result
                        });

                    } catch (err) {
                        reject(err);
                    }

                });

            });

            stkReq.on('error', reject);

            stkReq.write(payload);
            stkReq.end();

        });

        // =========================
        // RETURN RESPONSE
        // =========================
        return res.status(200).json(stkResponse);

    } catch (error) {

        return res.status(500).json({
            error: 'STK Push Failed',
            message: error.message
        });

    }

}
