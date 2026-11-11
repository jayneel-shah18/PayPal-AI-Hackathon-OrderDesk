/**
 * Step 1 of the build plan: prove the PayPal sandbox round trip before any UI.
 * Creates one hard-coded invoice, sends it, fetches it, checks the QR endpoint,
 * then waits until you pay it as the sandbox buyer and PayPal reports it PAID.
 *
 *   npm run paypal:roundtrip -- buyer@personal.example.com
 *
 * Needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox) in .env.local.
 */
import './env';
import { callPayPalTool, extractQrPng, getInvoice, getToolkit, invoiceIdFrom } from '../src/lib/paypal';

async function main() {
  const buyer = process.argv[2] || process.env.PAYPAL_BUYER_EMAIL;
  if (!buyer) throw new Error('Pass the sandbox PERSONAL account email: npm run paypal:roundtrip -- buyer@example.com');

  const client = getToolkit().client;
  console.log('Base URL      ', client.getBaseUrl());
  await client.getAccessToken();
  console.log('Access token   ok');

  const created = await callPayPalTool('create_invoice', {
    currency_code: 'USD',
    reference: 'orderdesk-roundtrip',
    note: 'OrderDesk sandbox round-trip test',
    invoicer_business_name: 'OrderDesk Supply Co.',
    ...(process.env.PAYPAL_INVOICER_EMAIL ? { invoicer_email_address: process.env.PAYPAL_INVOICER_EMAIL } : {}),
    primary_recipients: [{ billing_info: { business_name: 'Main St Cafe', email_address: buyer } }],
    items: [
      { name: 'Paper hot cup 12 oz (sleeve of 50) (HBR-CUP-12)', quantity: '40', unit_amount: { currency_code: 'USD', value: '4.50' } },
      { name: 'Coffee filters 12-cup basket (box of 250) (HBR-FLT-12)', quantity: '5', unit_amount: { currency_code: 'USD', value: '6.50' } },
    ],
  });
  const id = invoiceIdFrom(created);
  if (!id) throw new Error(`No invoice ID in create_invoice response: ${JSON.stringify(created)}`);
  console.log('create_invoice ', id);

  await callPayPalTool('send_invoice', { invoice_id: id });
  console.log('send_invoice   ok');

  const invoice = await getInvoice(id);
  console.log('get_invoice    ', invoice);
  if (invoice.totalCents !== 21250) throw new Error(`Expected a $212.50 invoice, PayPal says ${invoice.totalCents}`);

  const qr = extractQrPng(await callPayPalTool('generate_invoice_qr_code', { invoice_id: id, width: 300, height: 300 }));
  console.log('QR code        ', qr ? `ok (${qr.length} base64 chars, POST)` : 'NO IMAGE RETURNED');

  console.log(`\nPay it now as the sandbox buyer (personal account): ${invoice.recipientViewUrl}`);
  if (process.argv.includes('--no-wait')) return;
  console.log('Waiting for PayPal to report it paid (up to 10 minutes, Ctrl+C to stop)...');
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { status } = await getInvoice(id);
    if (status === 'PAID' || status === 'MARKED_AS_PAID') {
      console.log(`\nPAID. The sandbox round trip works end to end (invoice ${id}).`);
      return;
    }
    if (status === 'CANCELLED') throw new Error('Invoice was cancelled.');
    process.stdout.write('.');
  }
  throw new Error('Timed out waiting for payment.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
