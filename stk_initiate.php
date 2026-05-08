<?php
// M-PESA DARAJA CREDENTIALS
$consumerKey = 'KthjmyvLyiGA62rNAiLiLEAkhqyK9GBjtbDy5vNWioAG5Rgb'; 
$consumerSecret = 'h6aCG7AKIOMdRp26VFjDDoy8Ai9A01DbOZlYigekzTRlPa21YZhNl65R1MVNFGD0';
$BusinessShortCode = '174379'; // Sandbox Paybill
$Passkey = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
$PartyA = '2547XXXXXXXX'; // Your phone number
$Amount = '1';
$CallBackURL = 'https://your-domain.com/callback.php'; // MUST BE HTTPS

// 1. GET ACCESS TOKEN
$headers = ['Content-Type:application/json; charset=utf8'];
$url = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
$curl = curl_init($url);
curl_setopt($curl, CURLOPT_HTTPHEADER, $headers);
curl_setopt($curl, CURLOPT_RETURNTRANSFER, TRUE);
curl_setopt($curl, CURLOPT_HEADER, FALSE);
curl_setopt($curl, CURLOPT_USERPWD, $consumerKey.':'.$consumerSecret);
$result = json_decode(curl_exec($curl));
$access_token = $result->access_token;

// 2. INITIATE STK PUSH
$Timestamp = date('YmdHis');
$Password = base64_encode($BusinessShortCode.$Passkey.$Timestamp);

$stk_url = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
$stk_header = ['Content-Type:application/json', 'Authorization:Bearer '.$access_token];

$curl_post_data = [
  'BusinessShortCode' => $BusinessShortCode,
  'Password' => $Password,
  'Timestamp' => $Timestamp,
  'TransactionType' => 'CustomerPayBillOnline',
  'Amount' => $Amount,
  'PartyA' => $PartyA,
  'PartyB' => $BusinessShortCode,
  'PhoneNumber' => $PartyA,
  'CallBackURL' => $CallBackURL,
  'AccountReference' => 'FaithPay_Test',
  'TransactionDesc' => 'Church Contribution'
];

$data_string = json_encode($curl_post_data);
$curl = curl_init();
curl_setopt($curl, CURLOPT_URL, $stk_url);
curl_setopt($curl, CURLOPT_HTTPHEADER, $stk_header);
curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
curl_setopt($curl, CURLOPT_POST, true);
curl_setopt($curl, CURLOPT_POSTFIELDS, $data_string);
$echo = curl_exec($curl);
echo $echo; // This shows the CheckoutRequestID
?>
