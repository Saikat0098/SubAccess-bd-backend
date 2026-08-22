import FastPay from '../utils/fastpay.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function runTests() {
  console.log('====================================================');
  console.log('TEST SUITE: FastPay Customer Email Integration');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      console.log(`[PASS] Test ${total}: ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${total}: ${testName}`);
    }
  }

  // 1. FastPay SDK Payload Validation Test (Mocking _request)
  try {
    const fastpay = new FastPay({
      apiKey: 'fp_test_mock_key',
      baseUrl: 'http://localhost:5000/api/v1',
      brandId: 'test_brand_123',
    });

    let capturedPayload: any = null;
    fastpay._request = async (endpoint: string, method: string, data: any) => {
      capturedPayload = data;
      return {
        sessionId: 'cs_mock_12345',
        checkoutUrl: 'http://localhost:5173/checkout/cs_mock_12345',
        orderId: data.orderId,
        amount: data.amount,
        currency: data.currency,
        status: 'PENDING',
        brandId: data.brandId,
      };
    };

    // Test 1: Full payload with customerEmail
    await fastpay.createCheckout({
      orderId: 'SUB-TEST-1001',
      amount: 450,
      customerName: 'Saikat Islam',
      customerPhone: '01325210769',
      customerEmail: '  Customer.Test@Example.COM  ',
      returnUrl: 'http://localhost:5174/user/orders',
    });

    assert(capturedPayload !== null, 'Request sent to endpoint');
    assert(capturedPayload.customerEmail === 'customer.test@example.com', 'customerEmail is trimmed and lowercase');
    assert(capturedPayload.customerName === 'Saikat Islam', 'customerName is preserved');
    assert(capturedPayload.customerPhone === '01325210769', 'customerPhone is preserved');
    assert(capturedPayload.amount === 450, 'amount is preserved');
    assert(capturedPayload.orderId === 'SUB-TEST-1001', 'orderId is preserved');
    assert(capturedPayload.currency === 'BDT', 'currency default to BDT');

    // Test 2: Optional customerEmail (empty/undefined)
    await fastpay.createCheckout({
      orderId: 'SUB-TEST-1002',
      amount: 250,
      customerName: 'No Email User',
      customerPhone: '01700000000',
      returnUrl: 'http://localhost:5174/user/orders',
    });

    assert(capturedPayload.customerEmail === '', 'Missing customerEmail safely defaults to empty string without error');

    // Test 3: Null or undefined customerEmail
    await fastpay.createCheckout({
      orderId: 'SUB-TEST-1003',
      amount: 300,
      customerName: 'Null Email User',
      customerPhone: '01800000000',
      customerEmail: undefined,
      returnUrl: 'http://localhost:5174/user/orders',
    });

    assert(capturedPayload.customerEmail === '', 'Undefined customerEmail safely defaults to empty string');
  } catch (err: any) {
    console.error('Unit test error:', err);
  }

  // 2. Integration / Live End-to-End Test with FastPay Gateway
  console.log('\n--- LIVE FASTPAY END-TO-END INTEGRATION TEST ---');
  try {
    const liveFastpay = new FastPay({
      apiKey: process.env.FASTPAY_API_KEY,
      baseUrl: process.env.FASTPAY_API_URL,
      brandId: process.env.FASTPAY_BRAND_ID,
      merchantId: process.env.FASTPAY_MERCHANT_ID,
      webhookSecret: process.env.FASTPAY_WEBHOOK_SECRET,
    });

    const testOrderId = `SUB-LIVE-TEST-${Date.now()}`;
    const testEmail = 'saikatislam680@gmail.com';

    console.log(`Creating live checkout session for Order: ${testOrderId}, Email: ${testEmail}...`);
    const liveSession = await liveFastpay.createCheckout({
      orderId: testOrderId,
      amount: 10,
      currency: 'BDT',
      customerName: 'Saikat Islam (Automated Test)',
      customerPhone: '01325210769',
      customerEmail: testEmail,
      returnUrl: `${process.env.FRONTEND_URL || 'http://localhost:5174'}/user/orders`,
      cancelUrl: `${process.env.FRONTEND_URL || 'http://localhost:5174'}/checkout`,
    });

    assert(Boolean(liveSession.sessionId), 'FastPay live session created successfully');
    assert(Boolean(liveSession.checkoutUrl), 'FastPay returned valid checkoutUrl');
    console.log(`Session ID: ${liveSession.sessionId}`);
    console.log(`Checkout URL: ${liveSession.checkoutUrl}`);

    // Query session from FastPay to verify customerEmail is persisted
    const fetchedSession = await liveFastpay.getPaymentStatus(liveSession.sessionId);
    assert(fetchedSession.success === true, 'Successfully fetched session status from FastPay');
    const rawSession = fetchedSession.raw || {};
    const sessionEmail = rawSession.customerEmail || rawSession.customer?.email || rawSession.email;
    assert(
      sessionEmail === testEmail.toLowerCase(),
      `FastPay stored customerEmail correctly (Received: ${sessionEmail})`
    );

    console.log(`Live Session Customer Email stored in FastPay: ${sessionEmail}`);
  } catch (err: any) {
    console.error('Live integration test error:', err.message, err.status, err.code);
  }

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed}/${total} assertions passed`);
  console.log('====================================================');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests();
