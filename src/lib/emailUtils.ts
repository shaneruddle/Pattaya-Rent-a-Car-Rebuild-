import DOMPurify from 'dompurify';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

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
 * Fetches and sends a templated email
 */
export const sendTemplatedEmail = async (
  templateId: string, 
  to: string, 
  placeholders: Record<string, any>,
  replyTo?: string
) => {
  try {
    const templateDoc = await getDoc(doc(db, 'email_templates', templateId));
    if (!templateDoc.exists()) {
      throw new Error(`Template ${templateId} not found`);
    }

    const template = templateDoc.data();
    const subject = processTemplate(template.subject, placeholders);
    const bodyWithPlaceholders = processTemplate(template.body, placeholders);
    
    // In many emails, users just type "hello\n\nworld", so we format newlines
    // but if they put <a> or other tags, we keep them.
    // We sanitize to ensure safety and inline styles for compatibility.
    const htmlBody = prepareHtmlForEmail(sanitizeEmailHtml(formatNewlines(bodyWithPlaceholders)));

    // Wrap in a basic container if needed, or just send
    const finalHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.4; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${htmlBody}
      </div>
    `;

    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        subject,
        html: finalHtml,
        replyTo: replyTo || 'info@pattayarentacar.com'
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.details || error.error || 'Failed to send email');
    }

    return true;
  } catch (error) {
    console.error(`Error sending template email [${templateId}]:`, error);
    throw error;
  }
};
