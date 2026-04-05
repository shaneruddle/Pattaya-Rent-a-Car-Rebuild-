
export interface FetchOptions extends RequestInit {
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Enhanced fetch that automatically handles the AI Studio warmup page by retrying.
 */
export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const { maxRetries = 3, retryDelay = 5000, ...fetchOptions } = options;
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retrying fetch to ${url} (Attempt ${attempt}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }

      const response = await fetch(url, fetchOptions);
      
      // Clone the response to check its content without consuming it
      const clonedResponse = response.clone();
      const text = await clonedResponse.text();

      // Check if it's the warmup page
      if (text.includes('Starting Server...') || text.includes('Please wait while your application starts')) {
        console.warn(`Received warmup page from ${url}. Server is still starting.`);
        if (attempt < maxRetries) continue;
        throw new Error('The server is currently restarting. Please wait a few seconds and try again.');
      }

      return response;
    } catch (error: any) {
      lastError = error;
      console.error(`Fetch error on attempt ${attempt}:`, error);
      
      // If it's a network error, we might want to retry
      if (attempt < maxRetries && (error.name === 'TypeError' || error.message.includes('restarting'))) {
        continue;
      }
      
      throw error;
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries} attempts`);
}
