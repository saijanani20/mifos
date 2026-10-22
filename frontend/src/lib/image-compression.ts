/**
 * Client-side Image Compression Utility
 * Prevents HTTP 413 (Payload/Request Entity Too Large) errors by scaling high-resolution 
 * camera photos and file uploads down to optimized web dimensions and quality.
 */

export async function compressImage(
  input: string | File | Blob | null | undefined,
  maxWidth = 1200,
  maxHeight = 900,
  quality = 0.8
): Promise<string> {
  if (!input) return '';

  return new Promise((resolve) => {
    const processDataUrl = (dataUrl: string) => {
      // If image is already lightweight (< 60 KB), return as-is
      if (dataUrl.length < 80_000) {
        resolve(dataUrl);
        return;
      }

      if (typeof window === 'undefined') {
        resolve(dataUrl);
        return;
      }

      const img = new Image();
      img.onload = () => {
        let width = img.width || 800;
        let height = img.height || 600;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        // Fill background with white to avoid transparent JPEG artifacts
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed);
      };

      img.onerror = () => {
        resolve(dataUrl);
      };

      img.src = dataUrl;
    };

    if (typeof input === 'string') {
      processDataUrl(input);
    } else if (typeof Blob !== 'undefined' && input && input instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (result) {
          processDataUrl(result);
        } else {
          resolve('');
        }
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(input);
    } else {
      resolve('');
    }
  });
}
