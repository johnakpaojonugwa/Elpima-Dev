import { Resend } from "resend";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

// Initialize Resend client if key is configured
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Base helper to send an email or fallback to structured logging when API key is not present.
 */
async function sendEmail({ to, subject, html, text }) {
  if (!resend) {
    logger.info("Transactional email simulated (RESEND_API_KEY not configured)", {
      to,
      subject,
      provider: "mock/log",
    });
    return { success: true, id: "simulated-email-id" };
  }

  try {
    const response = await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
      text,
    });

    if (response.error) {
      logger.warn("Resend email delivery failed", {
        to,
        subject,
        error: response.error,
      });
      return { success: false, error: response.error };
    }

    logger.info("Transactional email sent successfully", {
      to,
      subject,
      emailId: response.data?.id,
    });

    return { success: true, id: response.data?.id };
  } catch (err) {
    logger.error("Unexpected error in email dispatch", {
      to,
      subject,
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}

/**
 * Send welcome email to newly provisioned organization administrator.
 */
export async function sendWelcomeEmail({ to, organizationName, contactName }) {
  const subject = `Welcome to Elpima B2B Procurement — ${organizationName}`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
      <h2 style="color: #0b5394;">Welcome to Elpima Surgicals, ${contactName || organizationName}!</h2>
      <p>Your organization <strong>${organizationName}</strong> has been registered on the Elpima B2B Medical & Surgical Procurement Platform.</p>
      <p>You can now browse surgical consumables, upload compliance certifications, request quotations, and track order fulfillment.</p>
      <p>If you have any questions, our support team is available 24/7.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <small style="color: #888;">Elpima Surgicals Limited — Medical Supplies & Equipment Procurement</small>
    </div>
  `;
  const text = `Welcome to Elpima B2B Procurement, ${organizationName}! Your account is active.`;

  return sendEmail({ to, subject, html, text });
}

/**
 * Alert a vendor that a hospital has submitted a new RFQ (Price Quotation Request).
 */
export async function sendNewQuoteAlert({ to, vendorName, hospitalName, quoteId, itemsCount, totalAmount, currency }) {
  const subject = `New RFQ Received from ${hospitalName} — Quote #${quoteId.slice(0, 8)}`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
      <h3 style="color: #0b5394;">New RFQ Request</h3>
      <p>Dear ${vendorName},</p>
      <p><strong>${hospitalName}</strong> has submitted a new Price Quotation Request containing <strong>${itemsCount} item(s)</strong> valued at approximately <strong>${currency} ${Number(totalAmount).toLocaleString()}</strong>.</p>
      <p>Please log in to your Elpima Vendor Portal to review the items and submit your quote.</p>
      <p><strong>Quote ID:</strong> <code>${quoteId}</code></p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <small style="color: #888;">Elpima Surgicals Limited</small>
    </div>
  `;
  const text = `New RFQ from ${hospitalName}: Quote ID ${quoteId} with ${itemsCount} items.`;

  return sendEmail({ to, subject, html, text });
}

/**
 * Alert a hospital that the vendor has responded with formal pricing (status = SENT).
 */
export async function sendQuotePricingReadyAlert({ to, hospitalName, vendorName, quoteId, totalAmount, currency }) {
  const subject = `Quotation Ready: ${vendorName} — Quote #${quoteId.slice(0, 8)}`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
      <h3 style="color: #0b5394;">Quotation Pricing Submitted</h3>
      <p>Dear ${hospitalName},</p>
      <p><strong>${vendorName}</strong> has reviewed your RFQ and submitted official pricing for Quote #<code>${quoteId.slice(0, 8)}</code>.</p>
      <p><strong>Total Amount:</strong> ${currency} ${Number(totalAmount).toLocaleString()}</p>
      <p>Log in to review the quotation line items and approve or decline the purchase.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <small style="color: #888;">Elpima Surgicals Limited</small>
    </div>
  `;
  const text = `Quote #${quoteId} pricing is ready from ${vendorName}: Total ${currency} ${totalAmount}.`;

  return sendEmail({ to, subject, html, text });
}

/**
 * Alert vendor that hospital has accepted quote and an Order has been generated.
 */
export async function sendOrderConfirmedAlert({ to, vendorName, hospitalName, orderId, totalAmount, currency }) {
  const subject = `Purchase Order Created #${orderId.slice(0, 8)} — ${hospitalName}`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
      <h3 style="color: #274e13;">Purchase Order Confirmed!</h3>
      <p>Dear ${vendorName},</p>
      <p><strong>${hospitalName}</strong> has accepted your quotation. Purchase Order #<code>${orderId.slice(0, 8)}</code> has been officially generated.</p>
      <p><strong>Order Value:</strong> ${currency} ${Number(totalAmount).toLocaleString()}</p>
      <p>Please log in to confirm the order and begin shipment fulfillment.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <small style="color: #888;">Elpima Surgicals Limited</small>
    </div>
  `;
  const text = `Purchase Order #${orderId} confirmed by ${hospitalName} for ${currency} ${totalAmount}.`;

  return sendEmail({ to, subject, html, text });
}

/**
 * Alert hospital of compliance review outcome.
 */
export async function sendLicenseReviewAlert({ to, hospitalName, status, rejectionReason }) {
  const isApproved = status === "APPROVED";
  const subject = `Compliance License ${isApproved ? "Approved" : "Requires Attention"} — Elpima Medical Verification`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
      <h3 style="color: ${isApproved ? "#274e13" : "#990000"};">Medical Compliance Status: ${status}</h3>
      <p>Dear ${hospitalName},</p>
      ${
        isApproved
          ? "<p>Your medical compliance verification license has been approved by the platform administration team. Your hospital verification badge is now active.</p>"
          : `<p>Your submitted compliance document was not approved for the following reason:</p><blockquote>${rejectionReason || "Documentation did not meet verification criteria."}</blockquote><p>Please re-upload a valid license document.</p>`
      }
      <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
      <small style="color: #888;">Elpima Surgicals Compliance Office</small>
    </div>
  `;
  const text = `License review status: ${status}. ${rejectionReason ? `Reason: ${rejectionReason}` : ""}`;

  return sendEmail({ to, subject, html, text });
}
