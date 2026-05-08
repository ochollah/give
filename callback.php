<?php
header("Content-Type: application/json");
$stkCallbackResponse = file_get_contents('php://input');
$logFile = "stkPushPaymentResponse.json";
file_put_contents($logFile, $stkCallbackResponse);

$data = json_decode($stkCallbackResponse);

$merchantRequestID = $data->Body->stkCallback->MerchantRequestID;
$checkoutRequestID = $data->Body->stkCallback->CheckoutRequestID;
$resultCode = $data->Body->stkCallback->ResultCode;

if ($resultCode == 0) {
    $amount = $data->Body->stkCallback->CallbackMetadata->Item[0]->Value;
    $mpesaReceiptNumber = $data->Body->stkCallback->CallbackMetadata->Item[1]->Value;
    $phoneNumber = $data->Body->stkCallback->CallbackMetadata->Item[4]->Value;

    // DATABASE CONNECTION
    $conn = new mysqli("localhost", "db_user", "db_pass", "faithpay_db");
    
    $stmt = $conn->prepare("INSERT INTO transactions (MerchantRequestID, CheckoutRequestID, ResultCode, Amount, MpesaReceiptNumber, PhoneNumber, Status) VALUES (?, ?, ?, ?, ?, ?, 'SUCCESS')");
    $stmt->bind_param("ssisss", $merchantRequestID, $checkoutRequestID, $resultCode, $amount, $mpesaReceiptNumber, $phoneNumber);
    $stmt->execute();
}
?>
