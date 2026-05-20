import https from "https";

export default async function handler(req, res) {

    // =========================
    // CORS (GitHub Pages safe)
    // =========================
    const origin = req.headers.origin || "*";

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {

        // =========================
        // PARSE BODY SAFELY
        // =========================
        let body = req.body;

        if (typeof body === "string") {
            try {
                body = JSON.parse(body);
            } catch (e) {
                return res.status(400).json({
                    error: "Invalid JSON body"
                });
            }
        }

        const { phone, amount, accountRef } = body || {};

        if (!phone || !amount) {
            return res.status(400).json({
                error: "Phone and amount required"
            });
        }

        // =========================
        // FORMAT PHONE NUMBER
        // =========================
        let formattedPhone = phone
            .toString()
            .replace(/\s+/g, "")
            .replace("+", "");

        if (formattedPhone.startsWith("0")) {
            formattedPhone = "254" + formattedPhone.substring(1);
        }

        // Support standard 9-digit formats starting with 7 or 1 (e.g. 712345678 or 112345678)
        if (formattedPhone.length === 9 && (formattedPhone.startsWith("7") || formattedPhone.startsWith("1"))) {
            formattedPhone = "254" + formattedPhone;
        }

        if (!formattedPhone.startsWith("254") || formattedPhone.length !== 12) {
            return res.status(400).json({
                error: "Invalid Kenyan phone number format. Expected 2547XXXXXXXX or 2541XXXXXXXX"
            });
        }

        // =========================
        // ENV VARIABLES
        // =========================
        const consumerKey = process.env.CONSUMER_KEY;
        const consumerSecret = process.env.CONSUMER_SECRET;
        const shortcode = process.env.SHORTCODE;
        const passkey = process.env.PASSKEY;
        const isProduction = process.env.MPESA_ENV === "production";

        const mpesaHost = isProduction ? "api.safaricom.co.ke" : "sandbox.safaricom.co.ke";

        const callbackURL =
            process.env.CALLBACK_URL ||
            `https://${process.env.VERCEL_URL}/api/callback`;

        if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
            return res.status(500).json({
                error: "Missing MPESA environment variables"
            });
        }

        // =========================
        // GET ACCESS TOKEN (SAFE)
        // =========================
        const auth = Buffer.from(
            `${consumerKey}:${consumerSecret}`
        ).toString("base64");

        const accessToken = await new Promise((resolve, reject) => {

            const options = {
                hostname: mpesaHost,
                path: "/oauth/v1/generate?grant_type=client_credentials",
                method: "GET",
                headers: {
                    Authorization: `Basic ${auth}`,
                    Accept: "application/json",
                    "User-Agent": "Mozilla/5.0",
                    Connection: "close"
                },
                timeout: 15000
            };

            const reqToken = https.request(options, (tokenRes) => {
                let data = "";
                tokenRes.on("data", chunk => data += chunk);
                tokenRes.on("end", () => {
                    console.log("TOKEN STATUS:", tokenRes.statusCode);
                    if (!data) return reject(new Error("Empty token response"));

                    try {
                        const parsed = JSON.parse(data);
                        if (!parsed.access_token) return reject(new Error("No access_token returned"));
                        resolve(parsed.access_token);
                    } catch (err) {
                        reject(new Error("Token JSON error: " + data));
                    }
                });
            });

            reqToken.on("error", reject);
            reqToken.on("timeout", () => {
                reqToken.destroy();
                reject(new Error("Token request timeout"));
            });
            reqToken.end();
        });

        // =========================
        // TIMESTAMP (Strict EAT / UTC+3 Alignment)
        // =========================
        const eatDate = new Date(new Date().getTime() + (3 * 60 * 60 * 1000));
        const timestamp = 
            eatDate.getUTCFullYear() +
            String(eatDate.getUTCMonth() + 1).padStart(2, "0") +
            String(eatDate.getUTCDate()).padStart(2, "0") +
            String(eatDate.getUTCHours()).padStart(2, "0") +
            String(eatDate.getUTCMinutes()).padStart(2, "0") +
            String(eatDate.getUTCSeconds()).padStart(2, "0");

        // =========================
        // PASSWORD
        // =========================
        const password = Buffer.from(
            shortcode + passkey + timestamp
        ).toString("base64");

        // =========================
        // STK PAYLOAD
        // =========================
        const payload = JSON.stringify({
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: isProduction ? "CustomerPayBillOnline" : "CustomerPayBillOnline", 
            Amount: Math.round(Number(amount)),
            PartyA: formattedPhone,
            PartyB: shortcode,
            PhoneNumber: formattedPhone,
            CallBackURL: callbackURL,
            AccountReference: (accountRef || "PAYMENT").trim().substring(0, 12),
            TransactionDesc: "STK Push Payment"
        });

        console.log("STK PAYLOAD:", payload);

        // =========================
        // STK PUSH REQUEST
        // =========================
        const stkResponse = await new Promise((resolve, reject) => {

            const options = {
                hostname: mpesaHost,
                path: "/mpesa/stkpush/v1/processrequest",
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload),
                    Connection: "close"
                },
                timeout: 15000
            };

            const stkReq = https.request(options, (stkRes) => {
                let data = "";
                stkRes.on("data", chunk => data += chunk);
                stkRes.on("end", () => {
                    console.log("STK STATUS:", stkRes.statusCode);
                    console.log("STK RAW:", data);

                    if (!data) return reject(new Error("Empty STK response"));

                    try {
                        const parsed = JSON.parse(data);
                        resolve({
                            statusCode: stkRes.statusCode,
                            response: parsed
                        });
                    } catch (err) {
                        reject(new Error("STK JSON error: " + data));
                    }
                });
            });

            stkReq.on("error", reject);
            stkReq.on("timeout", () => {
                stkReq.destroy();
                reject(new Error("STK request timeout"));
            });

            stkReq.write(payload);
            stkReq.end();
        });

        return res.status(200).json(stkResponse);

    } catch (error) {
        console.error("FULL ERROR:", error);
        return res.status(500).json({
            success: false,
            error: "STK Push Failed",
            message: error.message
        });
    }
}
