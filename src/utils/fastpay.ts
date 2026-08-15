import crypto from 'crypto';

export interface FastPayConfig {
  apiKey?: string;
  merchantId?: string;
  baseUrl?: string;
  webhookSecret?: string;
  timeout?: number;
}

export interface CreateCheckoutParams {
  orderId: string | number;
  amount: number | string;
  currency?: string;
  returnUrl: string;
  cancelUrl?: string;
  customerName?: string;
  customerPhone?: string;
}

export interface CreateCheckoutResult {
  success: boolean;
  sessionId: string;
  checkoutUrl: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  expiresAt?: string;
}

export interface VerifyPaymentParams {
  transactionId: string;
  sessionId: string;
  provider?: string;
}

export interface VerifyPaymentResult {
  success: boolean;
  status: string;
  sessionId: string;
  transactionId: string;
  amount: number;
  provider: string;
}

export interface GetPaymentStatusParams {
  sessionId: string;
}

export interface PaymentStatusResult {
  success: boolean;
  sessionId: string;
  orderId: string;
  status: string;
  amount: number;
  currency: string;
  transactionId?: string;
  provider?: string;
  expiresAt?: string;
  raw?: any;
}

export interface FastPayApiError extends Error {
  status?: number;
  code?: string;
}

export class FastPay {
  public apiKey: string;
  public merchantId: string;
  public baseUrl: string;
  public webhookSecret: string;
  public timeout: number;

  constructor(config: FastPayConfig = {}) {
    this.apiKey = config.apiKey || (typeof process !== 'undefined' ? process.env.FASTPAY_API_KEY : '') || '';
    this.merchantId = config.merchantId || (typeof process !== 'undefined' ? process.env.FASTPAY_MERCHANT_ID : '') || '';
    const rawBaseUrl = config.baseUrl || (typeof process !== 'undefined' ? process.env.FASTPAY_API_URL : '') || '';
    this.webhookSecret = config.webhookSecret || (typeof process !== 'undefined' ? process.env.FASTPAY_WEBHOOK_SECRET : '') || '';
    this.timeout = config.timeout || 10000;

    if (!this.apiKey) throw new Error('FastPay SDK Error: API key is required.');
    if (!this.merchantId) throw new Error('FastPay SDK Error: Merchant ID is required.');
    if (!rawBaseUrl) throw new Error('FastPay SDK Error: API base URL is required.');

    this.baseUrl = rawBaseUrl.trim().replace(/\/+$/, '');
  }

  public async _request(endpoint: string, method: string = 'GET', data: any = null): Promise<any> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const resText = await response.text();
    let json: any;
    try {
      json = JSON.parse(resText);
    } catch (_) {
      json = { message: resText };
    }
    if (!response.ok) {
      const err: FastPayApiError = new Error(json.message || 'FastPay API Request Failed');
      err.status = response.status;
      err.code = json.code || 'API_ERROR';
      throw err;
    }
    return json.data || json;
  }

  // 1. Create Hosted Checkout Session
  public async createCheckout(params: CreateCheckoutParams): Promise<CreateCheckoutResult> {
    if (!params.orderId) throw new Error('FastPay SDK Error: orderId is required.');
    if (!params.amount || Number(params.amount) <= 0) throw new Error('FastPay SDK Error: valid positive amount is required.');
    if (!params.returnUrl || !/^https?:\/\//i.test(params.returnUrl)) throw new Error('FastPay SDK Error: valid returnUrl (HTTP/HTTPS) is required.');

    const res = await this._request('/checkout/sessions', 'POST', {
      orderId: String(params.orderId).trim(),
      amount: Number(params.amount),
      currency: (params.currency || 'BDT').toUpperCase(),
      returnUrl: params.returnUrl.trim(),
      cancelUrl: params.cancelUrl ? params.cancelUrl.trim() : '',
      customerName: params.customerName || '',
      customerPhone: params.customerPhone || '',
    });
    return {
      success: true,
      sessionId: res.sessionId,
      checkoutUrl: res.checkoutUrl,
      orderId: res.orderId,
      amount: res.amount,
      currency: res.currency,
      status: res.status,
      expiresAt: res.expiresAt,
    };
  }

  // 2. Programmatically Verify Payment
  public async verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    if (!params.transactionId) throw new Error('FastPay SDK Error: transactionId is required.');
    if (!params.sessionId) throw new Error('FastPay SDK Error: sessionId is required.');

    const res = await this._request(`/checkout/sessions/${params.sessionId}/verify-payment`, 'POST', {
      trxId: params.transactionId,
      transactionId: params.transactionId,
      sessionId: params.sessionId,
      provider: params.provider,
    });
    const session = res.data?.session || res.session || res.data || res;
    const payment = res.data?.payment || res.payment || {};
    const trxId =
      payment.transactionId ||
      payment.trxId ||
      session.transactionId ||
      session.trxId ||
      params.transactionId;
    const provider =
      payment.provider ||
      payment.gateway ||
      session.provider ||
      session.gateway ||
      params.provider ||
      'FastPay';

    return {
      success: true,
      status: session.status || payment.status || 'VERIFIED',
      sessionId: session.sessionId || params.sessionId,
      transactionId: trxId,
      amount: Number(payment.amount || session.amount || 0),
      provider,
    };
  }

  // 3. Query Payment Status
  public async getPaymentStatus(params: GetPaymentStatusParams | string): Promise<PaymentStatusResult> {
    const sessionId = typeof params === 'string' ? params : params?.sessionId;
    if (!sessionId) throw new Error('FastPay SDK Error: sessionId is required.');
    const res = await this._request(`/checkout/sessions/${sessionId}`, 'GET');
    const session = res.data?.session || res.session || res.data || res;
    const payment = res.data?.payment || res.payment || session.payment || {};
    const trxId =
      session.transactionId ||
      session.trxId ||
      payment.transactionId ||
      payment.trxId ||
      '';
    const provider =
      session.provider ||
      session.gateway ||
      payment.provider ||
      payment.gateway ||
      'FastPay';

    return {
      success: true,
      sessionId: session.sessionId || sessionId,
      orderId: session.orderId,
      status: session.status || 'PENDING',
      amount: Number(session.amount || payment.amount || 0),
      currency: session.currency || 'BDT',
      transactionId: trxId,
      provider,
      expiresAt: session.expiresAt,
      raw: session,
    };
  }

  // 4. Verify Webhook Signature (Buffer, String, Object)
  public static verifyWebhookSignature(
    payload: Buffer | string | Record<string, any>,
    signatureHeader: string | undefined | null,
    secret: string,
    toleranceInSeconds: number = 300
  ): boolean {
    if (!secret) throw new Error('FastPay SDK Error: FASTPAY_WEBHOOK_SECRET is required for webhook verification.');
    if (!signatureHeader || typeof signatureHeader !== 'string') return false;

    let payloadString = '';
    if (Buffer.isBuffer(payload)) payloadString = payload.toString('utf8');
    else if (typeof payload === 'string') payloadString = payload;
    else if (payload && typeof payload === 'object') payloadString = JSON.stringify(payload);
    else return false;

    const parts: Record<string, string> = Object.fromEntries(
      signatureHeader.split(',').map((p) => {
        const idx = p.indexOf('=');
        return idx !== -1 ? [p.substring(0, idx).trim(), p.substring(idx + 1).trim()] : [];
      })
    );

    if (!parts.t || !parts.v1 || !/^[0-9a-fA-F]{64}$/.test(parts.v1)) return false;

    const timestampNum = parseInt(parts.t, 10);
    if (isNaN(timestampNum)) return false;
    if (toleranceInSeconds && Math.abs(Math.floor(Date.now() / 1000) - timestampNum) > toleranceInSeconds) return false;

    const expectedSig = crypto.createHmac('sha256', secret).update(`${parts.t}.${payloadString}`).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(parts.v1, 'hex'), Buffer.from(expectedSig, 'hex'));
    } catch (_) {
      return false;
    }
  }
}

export default FastPay;
