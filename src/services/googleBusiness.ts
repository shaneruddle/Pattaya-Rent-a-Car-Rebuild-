import axios from 'axios';

// Note: In a production environment, you would use OAuth2 for the Google Business Profile API.
// For the purpose of this implementation as requested, we are using the provided API key structure.
// You should ensure the API Key has the necessary permissions.

export interface GoogleReview {
  name: string;
  reviewId: string;
  reviewer: {
    displayName: string;
    profilePhotoUrl?: string;
  };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}

export const fetchGoogleReviews = async (locationId: string): Promise<GoogleReview[]> => {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }

  if (!locationId) {
    throw new Error('MISSING_LOCATION_ID');
  }

  try {
    // The Google Business Profile API endpoint for reviews
    // Note: This endpoint usually requires OAuth2 Bearer token.
    // We are simulating the structure to connect to the requested fields.
    const response = await axios.get(`https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/${locationId}/reviews`, {
      params: {
        key: apiKey
      }
    });

    return response.data.reviews || [];
  } catch (error) {
    console.error('Error fetching Google Reviews:', error);
    throw error;
  }
};
