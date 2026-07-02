import { useEffect, useState } from 'react';
import type React from 'react';

export function useInViewport<T extends Element>(
  ref: React.RefObject<T | null>,
  rootMargin = '200px',
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return inView;
}
