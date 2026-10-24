/**
 * WhatsApp Service for Standard (Personal) WhatsApp Messaging
 *
 * Uses direct universal WhatsApp Click-to-Chat deep links (https://wa.me/<phone>?text=...)
 * rather than the Meta WhatsApp Business Cloud API.
 * This works on any standard/personal WhatsApp app (iOS, Android, WhatsApp Web)
 * without requiring Meta Business verification, template approvals, or per-message fees.
 */

/**
 * Normalizes phone numbers to standard E.164 without leading '+' or spaces.
 * Converts local Nigerian numbers (e.g. "08012345678") to international format ("2348012345678").
 *
 * @param {string} rawPhone
 * @returns {string}
 */
export function normalizePhone(rawPhone) {
  if (!rawPhone) return "";
  let digits = rawPhone.replace(/\D/g, "");

  // If starts with local '0' (e.g. 0803... or 070...), replace with Nigerian code 234
  if (digits.startsWith("0") && digits.length === 11) {
    digits = "234" + digits.slice(1);
  }

  return digits;
}

/**
 * Formats a clean, readable text message for a new RFQ (Price Quotation Request).
 *
 * @param {{
 *   quoteId: string,
 *   hospitalName: string,
 *   vendorName: string,
 *   itemsCount: number,
 *   totalAmount: number|string,
 *   currency?: string,
 *   notes?: string,
 *   items?: Array<{ name: string, quantity: number }>
 * }} data
 * @returns {string}
 */
export function formatRfqWhatsAppMessage({
  quoteId,
  hospitalName,
  vendorName,
  itemsCount,
  totalAmount,
  currency = "NGN",
  notes,
  items = [],
}) {
  let message = `🏥 *Elpima Medical B2B — New RFQ Alert*\n\n`;
  message += `Hello *${vendorName}*,\n`;
  message += `*${hospitalName}* has submitted a new Price Quotation Request.\n\n`;
  message += `📋 *Quote Ref:* #${quoteId.slice(0, 8)}\n`;
  message += `📦 *Items:* ${itemsCount} product(s)\n`;
  message += `💰 *Est. Total:* ${currency} ${Number(totalAmount).toLocaleString()}\n`;

  if (items && items.length > 0) {
    message += `\n*Selected Items:*\n`;
    items.slice(0, 5).forEach((item) => {
      message += `• ${item.quantity}x ${item.name}\n`;
    });
    if (items.length > 5) {
      message += `• ...and ${items.length - 5} more items\n`;
    }
  }

  if (notes) {
    message += `\n📝 *Notes:* "${notes}"\n`;
  }

  message += `\nPlease open your vendor dashboard or reply directly to confirm product availability and pricing.`;

  return message;
}

/**
 * Formats a WhatsApp alert when a hospital accepts a quotation, confirming an order.
 *
 * @param {{
 *   orderId: string,
 *   quoteId: string,
 *   hospitalName: string,
 *   vendorName: string,
 *   totalAmount: number|string,
 *   currency?: string
 * }} data
 * @returns {string}
 */
export function formatOrderConfirmedWhatsAppMessage({
  orderId,
  quoteId,
  hospitalName,
  vendorName,
  totalAmount,
  currency = "NGN",
}) {
  let message = `✅ *Elpima Medical B2B — Purchase Order Confirmed!*\n\n`;
  message += `Hello *${vendorName}*,\n`;
  message += `*${hospitalName}* has approved your quote (#${quoteId.slice(0, 8)})!\n\n`;
  message += `📦 *Purchase Order Ref:* #${orderId.slice(0, 8)}\n`;
  message += `💵 *Confirmed Value:* ${currency} ${Number(totalAmount).toLocaleString()}\n`;
  message += `\nPlease initiate shipment fulfillment. Reply to coordinate delivery details.`;

  return message;
}

/**
 * Generates the official WhatsApp Click-to-Chat URL for standard WhatsApp.
 * Opens regular WhatsApp on mobile, desktop, or web directly into a chat with prefilled message.
 *
 * @param {string} rawPhone - Recipient phone number (personal WhatsApp number)
 * @param {string} message - Unencoded text message content
 * @returns {string} - Universal wa.me URL
 */
export function createWhatsAppChatLink(rawPhone, message) {
  const normalizedPhone = normalizePhone(rawPhone);
  const encodedText = encodeURIComponent(message);

  if (!normalizedPhone) {
    return `https://wa.me/?text=${encodedText}`;
  }

  return `https://wa.me/${normalizedPhone}?text=${encodedText}`;
}
