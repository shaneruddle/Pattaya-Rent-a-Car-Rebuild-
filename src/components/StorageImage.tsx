import React, { useState, useEffect } from 'react';
import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';
import { Loader2, ImageOff } from 'lucide-react';
import { cn } from '../lib/utils';

interface StorageImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  path: string;
  fallback?: string;
}

export const StorageImage: React.FC<StorageImageProps> = ({ path, fallback, className, ...props }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }

    // If it's already a full HTTP URL or data URL, just use it
    if (path.startsWith('http') || path.startsWith('data:')) {
      setUrl(path);
      setLoading(false);
      return;
    }

    const fetchUrl = async () => {
      if (!storage) {
        setError(true);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(false);
        
        // Handle gs:// URLs if provided
        // Example: gs://bucket-name/path/to/image.png -> path/to/image.png
        let storagePath = path;
        if (path.startsWith('gs://')) {
          const parts = path.split('/');
          if (parts.length > 3) {
            storagePath = parts.slice(3).join('/');
          }
        }
          
        const imageRef = ref(storage, storagePath);
        const downloadUrl = await getDownloadURL(imageRef);
        setUrl(downloadUrl);
      } catch (err) {
        console.error('Error fetching image from storage:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchUrl();
  }, [path]);

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center bg-black/5 animate-pulse rounded-2xl", className)}>
        <Loader2 className="animate-spin text-black/20" size={24} />
      </div>
    );
  }

  if (error || !url) {
    if (fallback) {
      return <img src={fallback} className={className} {...props} referrerPolicy="no-referrer" />;
    }
    return (
      <div className={cn("flex items-center justify-center bg-black/5 rounded-2xl", className)}>
        <ImageOff className="text-black/20" size={24} />
      </div>
    );
  }

  return <img src={url} className={className} {...props} referrerPolicy="no-referrer" />;
};
