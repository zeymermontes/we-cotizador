import { useState, useEffect } from 'react';

interface Props {
  src: string;
  alt: string;
  className?: string;
  onLoad?: () => void;
}

export default function BlurredImage({ src, alt, className = '', onLoad }: Props) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Check if image is already cached
    const img = new Image();
    img.src = src;
    if (img.complete) {
      setIsLoaded(true);
    }
  }, [src]);

  const handleLoad = () => {
    setIsLoaded(true);
    if (onLoad) onLoad();
  };

  return (
    <div className={`image-placeholder ${className}`}>
      <img
        src={src}
        alt={alt}
        className={`blurred-image ${isLoaded ? 'loaded' : ''} ${className}`}
        onLoad={handleLoad}
        loading="lazy"
      />
    </div>
  );
}
