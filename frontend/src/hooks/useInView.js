import { useEffect, useRef, useState } from 'react';

/** Tells whether the element behind `ref` is (nearly) on screen. */
export function useInView(rootMargin = '300px') {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true); // very old browser: behave like before
      return undefined;
    }

    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return [ref, inView];
}
