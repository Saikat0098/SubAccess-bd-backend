import crypto from 'crypto';

export interface FastPayConfig {
  apiKey?: string;
  merchantId?: string;
  brandId?: string;
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
  brandId?: string;
}

export interface CreateCheckoutResult {
  success: boolean;
  sessionId: string;
  checkoutUrl: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  brandId?: string;
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
  brandId?: string;
  expiresAt?: string;
  raw?: any;
}

export interface FastPayApiError extends Error {
  status?: number;
  code?: string;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  reason?: string;
  hasTimestamp: boolean;
  timestampWithinTolerance: boolean;
  timestampRaw?: string;
  signaturePresent: boolean;
  secretsCount: number;
}

export class FastPay {
  public apiKey: string;
  public merchantId: string;
  public brandId: string;
  public baseUrl: string;
  public webhookSecret: string;
  public timeout: number;

  constructor(config: FastPayConfig = {}) {
    this.apiKey = config.apiKey || (typeof process !== 'undefined' ? process.env.FASTPAY_API_KEY : '') || '';
    this.merchantId = config.merchantId || (typeof process !== 'undefined' ? process.env.FASTPAY_MERCHANT_ID : '') || '';
    this.brandId = config.brandId || (typeof process !== 'undefined' ? process.env.FASTPAY_BRAND_ID : '') || '';
    const rawBaseUrl = config.baseUrl || (typeof process !== 'undefined' ? process.env.FASTPAY_API_URL : '') || '';
    this.webhookSecret = config.webhookSecret || (typeof process !== 'undefined' ? process.env.FASTPAY_WEBHOOK_SECRET : '') || '';
    this.timeout = config.timeout || 10000;

    if (!this.apiKey) throw new Error('FastPay SDK Error: API key is required.');
    if (!rawBaseUrl) throw new Error('FastPay SDK Error: API base URL is required.');

    this.baseUrl = rawBaseUrl.trim().replace(/\/+$/, '');
  }

  public async _request(endpoint: string, method: string = 'GET', data: any = null): Promise<any> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'Authorization': `Bearer ${this.apiKey}`,
    };
    if (this.brandId) {
      headers['X-Brand-Id'] = this.brandId;
    }

    const response = await fetch(url, {
      method,
      headers,
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

    const payload: Record<string, any> = {
      orderId: String(params.orderId).trim(),
      amount: Number(params.amount),
      currency: (params.currency || 'BDT').toUpperCase(),
      returnUrl: params.returnUrl.trim(),
      cancelUrl: params.cancelUrl ? params.cancelUrl.trim() : '',
      customerName: params.customerName || '',
      customerPhone: params.customerPhone || '',
    };
    if (params.brandId || this.brandId) {
      payload.brandId = params.brandId || this.brandId;
    }
    if (this.merchantId) {
      payload.merchantId = this.merchantId;
    }

    const res = await this._request('/checkout/sessions', 'POST', payload);
    return {
      success: true,
      sessionId: res.sessionId,
      checkoutUrl: res.checkoutUrl,
      orderId: res.orderId,
      amount: res.amount,
      currency: res.currency,
      status: res.status,
      brandId: res.brandId || payload.brandId,
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

  // 4. Verify Webhook Signature with diagnostic details
  public static verifyWebhookSignatureWithDetails(
    payload: Buffer | string | Record<string, any>,
    signatureHeader: string | undefined | null,
    secret: string | string[],
    toleranceInSeconds: number = 900
  ): WebhookVerificationResult {
    const rawSecrets = Array.isArray(secret) ? secret.filter(Boolean) : [secret].filter(Boolean);
    if (rawSecrets.length === 0) {
      return {
        isValid: false,
        reason: 'SECRET_NOT_CONFIGURED',
        hasTimestamp: false,
        timestampWithinTolerance: false,
        signaturePresent: Boolean(signatureHeader),
        secretsCount: 0,
      };
    }

    if (!signatureHeader || typeof signatureHeader !== 'string') {
      return {
        isValid: false,
        reason: 'MISSING_SIGNATURE_HEADER',
        hasTimestamp: false,
        timestampWithinTolerance: false,
        signaturePresent: false,
        secretsCount: rawSecrets.length,
      };
    }

    // Expand secret list to handle with and without whsec_ prefixes
    const secretList: string[] = [];
    for (const s of rawSecrets) {
      const trimmed = String(s).trim();
      if (!trimmed) continue;
      if (!secretList.includes(trimmed)) secretList.push(trimmed);
      const withoutPrefix = trimmed.replace(/^whsec_/, '');
      if (withoutPrefix && !secretList.includes(withoutPrefix)) secretList.push(withoutPrefix);
      const withPrefix = `whsec_${withoutPrefix}`;
      if (!secretList.includes(withPrefix)) secretList.push(withPrefix);
    }

    let payloadString = '';
    if (Buffer.isBuffer(payload)) payloadString = payload.toString('utf8');
    else if (typeof payload === 'string') payloadString = payload;
    else if (payload && typeof payload === 'object') payloadString = JSON.stringify(payload);
    else {
      return {
        isValid: false,
        reason: 'INVALID_PAYLOAD_TYPE',
        hasTimestamp: false,
        timestampWithinTolerance: false,
        signaturePresent: true,
        secretsCount: secretList.length,
      };
    }

    const headerTrimmed = signatureHeader.trim();

    // Parse header parts (t=..., v1=... or semicolon/space separated or sha256=... or raw hex)
    let timestampStr = '';
    let signatureHex = '';

    if (headerTrimmed.includes('=')) {
      const parts: Record<string, string> = {};
      const tokens = headerTrimmed.split(/[,;\s]+/).filter(Boolean);
      for (const token of tokens) {
        const idx = token.indexOf('=');
        if (idx !== -1) {
          const key = token.substring(0, idx).trim().toLowerCase();
          const val = token.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
          parts[key] = val;
        }
      }
      timestampStr = parts.t || parts.timestamp || parts.time || parts.ts || '';
      signatureHex =
        parts.v1 ||
        parts.v0 ||
        parts.v2 ||
        parts.sha256 ||
        parts.sig ||
        parts.signature ||
        parts.hmac ||
        parts.s ||
        '';
    } else if (/^[0-9a-fA-F]{64}$/.test(headerTrimmed)) {
      signatureHex = headerTrimmed;
    }

    if (!signatureHex && headerTrimmed.startsWith('sha256=')) {
      signatureHex = headerTrimmed.substring(7).trim();
    }

    // Strip optional sha256= or v1= prefixes inside the extracted signature
    if (signatureHex.startsWith('sha256=')) {
      signatureHex = signatureHex.substring(7).trim();
    }

    if (!signatureHex || !/^[0-9a-fA-F]{64}$/.test(signatureHex)) {
      return {
        isValid: false,
        reason: !signatureHex ? 'SIGNATURE_NOT_FOUND_IN_HEADER' : 'INVALID_SIGNATURE_HEX',
        hasTimestamp: Boolean(timestampStr),
        timestampWithinTolerance: false,
        timestampRaw: timestampStr,
        signaturePresent: true,
        secretsCount: secretList.length,
      };
    }

    // Parse timestamp (supporting unix seconds, unix milliseconds, and ISO-8601 date strings)
    let hasValidTimestamp = false;
    let timestampWithinTolerance = false;

    if (timestampStr) {
      hasValidTimestamp = true;
      let timestampNum = Number(timestampStr);

      if (isNaN(timestampNum)) {
        const parsedDate = Date.parse(timestampStr);
        if (!isNaN(parsedDate)) {
          timestampNum = parsedDate;
        }
      }

      if (!isNaN(timestampNum)) {
        if (timestampNum > 1e11) {
          timestampNum = Math.floor(timestampNum / 1000);
        }
        const nowSec = Math.floor(Date.now() / 1000);
        if (!toleranceInSeconds || Math.abs(nowSec - timestampNum) <= toleranceInSeconds) {
          timestampWithinTolerance = true;
        }
      } else {
        timestampWithinTolerance = true;
      }
    }

    const sigBuffer = Buffer.from(signatureHex.toLowerCase(), 'hex');

    for (const sec of secretList) {
      // 1. Check timestamped HMAC if timestamp was present and within tolerance
      if (hasValidTimestamp && timestampWithinTolerance) {
        const candidatePayloads = [
          `${timestampStr}.${payloadString}`,
          `${timestampStr}:${payloadString}`,
          `${timestampStr}${payloadString}`,
          `t=${timestampStr}.${payloadString}`,
        ];

        for (const candidate of candidatePayloads) {
          const expected = crypto
            .createHmac('sha256', sec)
            .update(candidate)
            .digest('hex');
          try {
            if (crypto.timingSafeEqual(sigBuffer, Buffer.from(expected, 'hex'))) {
              return {
                isValid: true,
                reason: 'VERIFIED',
                hasTimestamp: true,
                timestampWithinTolerance: true,
                timestampRaw: timestampStr,
                signaturePresent: true,
                secretsCount: secretList.length,
              };
            }
          } catch (_) {}
        }
      }

      // 2. Check direct payload HMAC (without timestamp prefix)
      const expectedDirect = crypto
        .createHmac('sha256', sec)
        .update(payloadString)
        .digest('hex');
      try {
        if (crypto.timingSafeEqual(sigBuffer, Buffer.from(expectedDirect, 'hex'))) {
          return {
            isValid: true,
            reason: 'VERIFIED_DIRECT',
            hasTimestamp: hasValidTimestamp,
            timestampWithinTolerance,
            timestampRaw: timestampStr,
            signaturePresent: true,
            secretsCount: secretList.length,
          };
        }
      } catch (_) {}
    }

    const failureReason = hasValidTimestamp && !timestampWithinTolerance ? 'TIMESTAMP_EXPIRED' : 'HMAC_MISMATCH';

    return {
      isValid: false,
      reason: failureReason,
      hasTimestamp: hasValidTimestamp,
      timestampWithinTolerance,
      timestampRaw: timestampStr,
      signaturePresent: true,
      secretsCount: secretList.length,
    };
  }

  // 4. Verify Webhook Signature (Buffer, String, Object)
  public static verifyWebhookSignature(
    payload: Buffer | string | Record<string, any>,
    signatureHeader: string | undefined | null,
    secret: string | string[],
    toleranceInSeconds: number = 900
  ): boolean {
    return FastPay.verifyWebhookSignatureWithDetails(payload, signatureHeader, secret, toleranceInSeconds).isValid;
  }
}

export default FastPay;
