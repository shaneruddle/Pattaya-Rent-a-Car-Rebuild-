
export interface FetchOptions extends RequestInit {
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Enhanced fetch that automatically handles the AI Studio warmup page by retrying.
 */
export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const { maxRetries = 200, retryDelay = 5000, ...fetchOptions } = options;
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

      // Check if it's the warmup page or service initializing
      if (response.status === 503 ||
          text.includes('Starting Server...') || 
          text.includes('Please wait while your application starts') ||
          text.includes('Your application is being prepared') ||
          text.includes('The server is currently restarting')) {
        console.warn(`Received warmup page or 503 from ${url}. Server is still starting or initializing.`);
        if (attempt < maxRetries) continue;
        throw new Error('The server is currently initializing. Please wait a few seconds and try again.');
      }

      return response;
    } catch (error: any) {
      lastError = error;
      
      // If it's a network error or a warmup page, we might want to retry
      if (attempt < maxRetries && (
        error.name === 'TypeError' || 
        error.message.includes('restarting') || 
        error.message.includes('Failed to fetch')
      )) {
        console.warn(`Fetch error on attempt ${attempt}:`, error.message);
        continue;
      }
      
      console.error(`Fetch error on final attempt ${attempt}:`, error);
      throw error;
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries} attempts`);
}
