import DOMPurify from 'dompurify';

/**
 * Sanitizes HTML content while allowing basic tags for email styling.
 */
export const sanitizeEmailHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'a', 'b', 'br', 'strong', 'i', 'em', 'u', 'p', 'div', 'span', 
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
      'ul', 'ol', 'li', 'table', 'tbody', 'tr', 'td', 'th', 'thead',
      'img', 'hr', 'q', 'blockquote'
    ],
    ALLOWED_ATTR: [
      'href', 'style', 'src', 'alt', 'width', 'height', 'target', 
      'cellpadding', 'cellspacing', 'border', 'align', 'valign',
      'class', 'rel'
    ]
  });
};

/**
 * Replaces double newlines with <br/><br/> for better HTML rendering of plain-text-ish content.
 * If the content already contains common HTML tags, we assume it's already formatted.
 */
export const formatNewlines = (text: string): string => {
  if (!text) return '';
  if (/<(p|br|div|span|h[1-6]|ul|li)/i.test(text)) {
    return text;
  }
  return text.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>');
};

/**
 * Inlines styles for better email client compatibility.
 * Specifically adds margins to <p> tags.
 */
export const prepareHtmlForEmail = (html: string): string => {
  if (!html) return '';
  
  // Style for paragraphs
  const pStyle = 'margin-bottom: 4px; min-height: 1.2em;';
  
  // Match <p> tags and add/merge style
  let styledHtml = html.replace(/<p([^>]*?)>/g, (match, attrs) => {
    // Skip spacing for signature-related classes
    if (attrs.includes('signature')) {
      if (attrs.includes('style=')) {
        return match.replace(/style\s*=\s*["']/, 'style="margin-bottom: 4px; line-height: 1.2; ');
      }
      return `<p style="margin-bottom: 4px; line-height: 1.2;" ${attrs.trim()}>`;
    }

    // If it's just <p>
    if (!attrs.trim()) {
      return `<p style="${pStyle}">`;
    }
    
    // If it already has a style attribute
    if (attrs.includes('style=')) {
      // Avoid adding duplicate styles if we already processed it (e.g. during preview)
      if (attrs.includes('margin-bottom: 4px')) {
        return match;
      }
      return match.replace(/style\s*=\s*["']/, `style="${pStyle} `);
    }
    
    // If it has other attributes but no style
    return `<p style="${pStyle}" ${attrs.trim()}>`;
  });
  
  // Special case for empty paragraphs created by editors (space holding paragraphs)
  // Matching <p style="..."><br></p> or variations
  styledHtml = styledHtml.replace(/<p([^>]*?)>\s*<br\s*\/?>\s*<\/p>/g, (match, attrs) => {
    return `<p ${attrs}>&nbsp;</p>`;
  });
  
  return styledHtml;
};

/**
 * Generates an HTML table grid for photos for email client compatibility.
 */
export const generatePhotoGrid = (photoUrls: string[]): string => {
  if (!photoUrls || photoUrls.length === 0) return '';

  const columns = 2;
  const rows = Math.ceil(photoUrls.length / columns);
  let html = `
    <div style="margin-top: 24px; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; background-color: #f9fafb; font-family: sans-serif;">
      <div style="padding: 12px 16px; background-color: #1a1a1a; color: white; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.1em;">
        Vehicle Condition Record (Car Inspection)
      </div>
      <table role="presentation" cellspacing="0" cellpadding="8" border="0" width="100%" style="background-color: #f9fafb;">
  `;

  for (let i = 0; i < rows; i++) {
    html += '<tr>';
    for (let j = 0; j < columns; j++) {
      const index = i * columns + j;
      const url = photoUrls[index];
      
      html += `<td width="50%" align="center" valign="top" style="padding: 8px;">`;
      if (url) {
        html += `
          <div style="background-color: white; border: 1px solid #eee; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <img src="${url}" alt="Inspection Photo ${index + 1}" width="240" style="display: block; width: 100%; height: auto; outline: none; border: none; text-decoration: none;" />
          </div>
        `;
      } else {
        html += '&nbsp;';
      }
      html += '</td>';
    }
    html += '</tr>';
  }

  html += `
      </table>
      <div style="padding: 12px; text-align: center; border-top: 1px solid #eee;">
        <p style="margin: 0; font-size: 10px; color: #6b7280; font-style: italic;">
          Photos are captured digitally at vehicle pickup for transparency.
        </p>
      </div>
    </div>
  `;

  return html;
};

/**
 * Process email template with placeholders
 */
export const processTemplate = (template: string, placeholders: Record<string, any>): string => {
  let processed = template;
  Object.entries(placeholders).forEach(([key, value]) => {
    // Escape the key for regex
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // If photos key and value is array, generate grid
    if (key === '{{photos}}' && Array.isArray(value)) {
      processed = processed.replace(new RegExp(escapedKey, 'g'), generatePhotoGrid(value));
    } else {
      processed = processed.replace(new RegExp(escapedKey, 'g'), value || '');
    }
  });
  return processed;
};

/**
 * Default templates for fallback if Firestore templates are missing
 */
const DEFAULT_TEMPLATES: Record<string, { subject: string, body: string }> = {
  'booking_enquiry': {
    name: 'Booking Enquiry Confirmation',
    subject: 'Thank you for your enquiry',
    body: '<p>Dear {{customer_name}},</p><p>Thank you for your enquiry for a <strong>{{vehicle_model}}</strong>.</p><p><strong>Rental Period:</strong> {{return_date}}<br><strong>Total Price:</strong> {{total_price}} THB</p><p>We have received your request and will get back to you as soon as possible.</p><p>Best regards,</p>',
  } as any,
  'customer_auto_enquiry_response': {
    name: 'Booking Enquiry - Customer Confirmation',
    subject: 'Thank you for your enquiry – {{vehicle_model}}',
    body: '<p>Dear {{customer_name}},</p><p>Thank you for your enquiry about the <strong>{{vehicle_model}}</strong>. We have received your request and will be in touch shortly.</p><p><strong>Pickup:</strong> {{pickup_date}} at {{pickup_time}}<br><strong>Return:</strong> {{return_date}} at {{return_time}}<br><strong>Total Price:</strong> {{total_price}} THB</p><p>If you have any questions, please feel free to contact us.</p><p>Best regards,<br>Pattaya Rent a Car</p>',
  } as any,
  'website_enquiry': {
    name: 'Website Enquiry Confirmation',
    subject: 'We have received your message',
    body: '<p>Dear {{customer_name}},</p><p>Thank you for contacting us through our website.</p><p>We have received your message and our team will get back to you shortly.</p><p>Best regards,</p>',
  } as any,
  'booking_confirmed': {
    name: 'Booking Confirmation',
    subject: 'Booking Confirmation - {{vehicle_model}}',
    body: '<p>Dear {{customer_name}},</p><p>Your booking for <strong>{{vehicle_model}}</strong> ({{plate_number}}) has been confirmed.</p><p><strong>Return Date:</strong> {{return_date}}<br><strong>Total Price:</strong> {{total_price}} THB</p><p>For your peace of mind, we have recorded the condition of the vehicle at the time of rental. Please see the photos below:</p>{{photos}}<p>Thank you for choosing us.</p>',
  } as any
};

/**
 * Fetches and sends a templated email
 */
/**
 * Sends a templated email by delegating template read + render to the server (admin SDK).
 * The server reads email_templates/<templateId> via firebase-admin (bypasses Firestore rules),
 * substitutes placeholders, formats HTML, and sends.
 *
 * On server error (missing template, Firestore error, send failure) the server returns 500
 * with console.error. Client logs [TEMPLATE EMAIL FAILED] loudly and returns false.
 * Callers check the return value: false → set emailSuccess = false → warning toast fires.
 */
export const sendTemplatedEmail = async (
  templateId: string,
  to: string,
  placeholders: Record<string, any>,
  replyTo?: string,
  bookingId?: string
) => {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        templateId,
        placeholders,
        replyTo,
        skipFinalToOverride: true,
        bookingId,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error(`[TEMPLATE EMAIL FAILED] templateId="${templateId}" status=${response.status}:`, errBody);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`[TEMPLATE EMAIL FAILED] templateId="${templateId}" (network/fetch error):`, error);
    return false;
  }
};

/**
 * Converts HTML to plain text, preserving paragraphs and breaks.
 */
export const htmlToPlainText = (html: string): string => {
  if (!html) return '';
  
  // 1. Replace block elements with double newlines
  let text = html.replace(/<p[^>]*?>/gi, '\n\n');
  text = text.replace(/<div[^>]*?>/gi, '\n');
  
  // 2. Replace line breaks with single newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  
  // 3. Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // 4. Decode HTML entities
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' '
  };
  
  text = text.replace(/&[a-z0-9#]+;/gi, (match) => entities[match] || match);
  
  // 5. Clean up extra newlines
  return text.trim().replace(/\n{3,}/g, '\n\n');
};
